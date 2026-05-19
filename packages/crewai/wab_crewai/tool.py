"""WABLiveTool — discover, verify-live (with revocation gate), then execute.

The revocation check is enforced **inside this tool** so an LLM cannot bypass
it by hallucinating a different domain or skipping the verify step. If a site
is revoked or suspended, the tool returns `stage='revoked'` and refuses to
call the execute endpoint — regardless of what the model requested.
"""
from __future__ import annotations

from typing import Any, Optional
import httpx
from pydantic import BaseModel, Field


DEFAULT_REGISTRY = "https://api.webagentbridge.com"
DEFAULT_TIMEOUT = 15.0


class WABLiveToolInput(BaseModel):
    """Schema the LLM sees."""
    domain: str = Field(..., description="The domain to interact with, e.g. 'shop.example.com'.")
    action: str = Field(..., description="The action name as declared in the site's /.well-known/wab.json.")
    params: dict[str, Any] = Field(default_factory=dict, description="Parameters for the action.")


class WABLiveToolResult(BaseModel):
    """Structured result. `stage` indicates where the pipeline stopped."""
    ok: bool
    stage: str  # input | discover | verify | revoked | execute
    domain: Optional[str] = None
    action: Optional[str] = None
    statuses: Optional[dict[str, Any]] = None
    revocation: Optional[dict[str, Any]] = None
    result: Optional[Any] = None
    error: Optional[str] = None
    hint: Optional[str] = None


def _fetch_discovery(client: httpx.Client, domain: str) -> Optional[dict]:
    for path in ("/.well-known/wab.json", "/agent-bridge.json"):
        try:
            r = client.get(f"https://{domain}{path}", timeout=DEFAULT_TIMEOUT)
            if r.status_code == 200:
                return r.json()
        except (httpx.HTTPError, ValueError):
            continue
    return None


def run_wab_flow(
    domain: str,
    action: str,
    params: Optional[dict] = None,
    *,
    registry: str = DEFAULT_REGISTRY,
    timeout: float = DEFAULT_TIMEOUT,
    api_key: Optional[str] = None,
    agent_name: str = "wab-crewai/0.1.0",
) -> WABLiveToolResult:
    """Run the full WAB pipeline. Returns a structured WABLiveToolResult."""
    if not domain or not action:
        return WABLiveToolResult(
            ok=False, stage="input",
            error="missing_domain_or_action",
            hint="Both 'domain' and 'action' are required.",
        )

    headers = {"X-Agent": agent_name}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    with httpx.Client(headers=headers, timeout=timeout) as client:
        # 1. Discovery
        bridge = _fetch_discovery(client, domain)
        if bridge is None:
            return WABLiveToolResult(
                ok=False, stage="discover", domain=domain, action=action,
                error="no_wab_json",
                hint=f"{domain} is not WAB-enabled. Refuse the task or ask the user for a verified alternative.",
            )

        # 2. Verify-live (registry checks signature + revocation)
        try:
            vr = client.post(f"{registry}/api/verify-live", json={"domain": domain})
            verify = vr.json() if vr.status_code == 200 else {}
        except (httpx.HTTPError, ValueError) as e:
            return WABLiveToolResult(
                ok=False, stage="verify", domain=domain, action=action,
                error=f"verify_failed: {e}",
                hint="Could not reach registry verification endpoint.",
            )

        statuses = (verify or {}).get("statuses", {})

        # 3. Revocation gate — non-bypassable
        if statuses.get("revoked") == "yes":
            return WABLiveToolResult(
                ok=False, stage="revoked", domain=domain, action=action,
                statuses=statuses,
                revocation=(verify or {}).get("revocation"),
                error="domain_revoked",
                hint="Refuse to transact. Surface reason_code and appeal_deadline to the user.",
            )

        if statuses.get("bridge_live") != "yes" or statuses.get("signature_ok") != "yes":
            return WABLiveToolResult(
                ok=False, stage="verify", domain=domain, action=action,
                statuses=statuses,
                error="verify_not_passing",
                hint="bridge_live or signature_ok did not return 'yes'. Refuse to transact.",
            )

        # 4. Execute via registry proxy
        try:
            er = client.post(
                f"{registry}/api/execute",
                json={"domain": domain, "action": action, "params": params or {}},
            )
            payload = er.json() if er.headers.get("content-type", "").startswith("application/json") else {"raw": er.text}
        except (httpx.HTTPError, ValueError) as e:
            return WABLiveToolResult(
                ok=False, stage="execute", domain=domain, action=action,
                statuses=statuses,
                error=f"execute_failed: {e}",
            )

        return WABLiveToolResult(
            ok=er.status_code < 400,
            stage="execute",
            domain=domain, action=action,
            statuses=statuses,
            result=payload,
            error=None if er.status_code < 400 else f"http_{er.status_code}",
        )


# ── Tool wrappers ────────────────────────────────────────────────────

def _build_crewai_tool():
    """Subclass crewai_tools.BaseTool if available."""
    try:
        from crewai_tools import BaseTool
    except ImportError:
        return None

    class _CrewWABTool(BaseTool):  # type: ignore[misc]
        name: str = "wab_live"
        description: str = (
            "Discover, verify-live (with revocation check), then execute a "
            "declared WAB action on a third-party domain. Refuses revoked sites."
        )
        args_schema: type[BaseModel] = WABLiveToolInput

        def _run(self, domain: str, action: str, params: dict | None = None) -> dict:
            return run_wab_flow(domain, action, params).model_dump()

    return _CrewWABTool


def _build_langchain_tool():
    """Subclass langchain_core.tools.StructuredTool if available."""
    try:
        from langchain_core.tools import StructuredTool
    except ImportError:
        return None

    def _runner(domain: str, action: str, params: dict | None = None) -> dict:
        return run_wab_flow(domain, action, params).model_dump()

    return StructuredTool.from_function(
        func=_runner,
        name="wab_live",
        description=(
            "Discover, verify-live (with revocation check), then execute a "
            "declared WAB action on a third-party domain. Refuses revoked sites."
        ),
        args_schema=WABLiveToolInput,
    )


class _PlainTool:
    """Fallback object when neither crewai nor langchain is installed."""
    name = "wab_live"
    description = (
        "Discover, verify-live (with revocation check), then execute a "
        "declared WAB action on a third-party domain. Refuses revoked sites."
    )
    args_schema = WABLiveToolInput

    def __init__(self, **kwargs):
        self._opts = kwargs

    def run(self, domain: str, action: str, params: dict | None = None) -> dict:
        return run_wab_flow(domain, action, params, **self._opts).model_dump()

    # langchain-style alias
    def invoke(self, input: dict) -> dict:
        return self.run(input["domain"], input["action"], input.get("params"))


def WABLiveTool(prefer: str = "auto", **kwargs):  # noqa: N802 — public factory
    """Factory.

    Args:
        prefer: 'crewai' | 'langchain' | 'plain' | 'auto'.
        **kwargs: passed to run_wab_flow (registry, timeout, api_key, agent_name).
    """
    if prefer in ("crewai", "auto"):
        Crew = _build_crewai_tool()
        if Crew is not None:
            return Crew()
    if prefer in ("langchain", "auto"):
        lc = _build_langchain_tool()
        if lc is not None:
            return lc
    return _PlainTool(**kwargs)
