"""Unit tests for wab_crewai. No live network — everything mocked with httpx.MockTransport."""
import json
import httpx
import pytest

from wab_crewai import (
    WABLiveTool,
    run_wab_flow,
    system_prompt,
    SYSTEM_PROMPT,
    SYSTEM_PROMPT_VERSION,
)
from wab_crewai import tool as tool_mod


def _install_mock(responder):
    """Replace httpx.Client globally inside the tool module so run_wab_flow uses our mock."""
    transport = httpx.MockTransport(responder)
    orig = tool_mod.httpx.Client

    class _MockedClient(httpx.Client):
        def __init__(self, *args, **kwargs):
            kwargs["transport"] = transport
            super().__init__(*args, **kwargs)

    tool_mod.httpx.Client = _MockedClient
    return lambda: setattr(tool_mod.httpx, "Client", orig)


def test_system_prompt_stable_and_versioned():
    assert SYSTEM_PROMPT_VERSION == "1.0.0"
    assert "Web Agent Bridge (WAB) protocol" in SYSTEM_PROMPT
    assert "verify-live" in SYSTEM_PROMPT
    assert "revoked" in SYSTEM_PROMPT


def test_system_prompt_appends_identity():
    p = system_prompt(agent_name="acme", agent_version="2.0.0")
    assert p.endswith("You are running as: acme/2.0.0.")
    assert p.startswith(SYSTEM_PROMPT)


def test_missing_input_returns_input_stage():
    r = run_wab_flow("", "search")
    assert r.ok is False
    assert r.stage == "input"
    assert r.error == "missing_domain_or_action"


def test_no_wab_returns_discover_stage():
    def responder(req):
        return httpx.Response(404)
    restore = _install_mock(responder)
    try:
        r = run_wab_flow("ghost.example.com", "search_products")
        assert r.ok is False
        assert r.stage == "discover"
        assert r.error == "no_wab_json"
    finally:
        restore()


def test_revoked_domain_blocks_execute():
    """The verify endpoint says revoked=yes — execute MUST NOT be called."""
    called_paths = []

    def responder(req):
        called_paths.append(str(req.url))
        if req.url.path.endswith("wab.json"):
            return httpx.Response(200, json={"actions": [{"name": "search_products"}]})
        if req.url.path.endswith("/api/verify-live"):
            return httpx.Response(200, json={
                "statuses": {
                    "dns_ok": "yes", "bridge_live": "yes",
                    "signature_ok": "yes", "revoked": "yes",
                },
                "revocation": {
                    "id": "rev-1", "type": "revoked", "reason_code": "fraud",
                    "appeal_deadline": "2026-06-01", "status": "final",
                },
            })
        if req.url.path.endswith("/api/execute"):
            return httpx.Response(200, json={"items": []})
        return httpx.Response(404)

    restore = _install_mock(responder)
    try:
        r = run_wab_flow("evil.example.com", "search_products", {"q": "x"})
        assert r.ok is False
        assert r.stage == "revoked"
        assert r.revocation["reason_code"] == "fraud"
        assert not any("/api/execute" in p for p in called_paths), \
            "execute endpoint must NOT be called when revoked=yes"
    finally:
        restore()


def test_happy_path_returns_execute_result():
    def responder(req):
        if req.url.path.endswith("wab.json"):
            return httpx.Response(200, json={"actions": [{"name": "search_products"}]})
        if req.url.path.endswith("/api/verify-live"):
            return httpx.Response(200, json={
                "statuses": {
                    "dns_ok": "yes", "bridge_live": "yes",
                    "signature_ok": "yes", "revoked": "no",
                }
            })
        if req.url.path.endswith("/api/execute"):
            return httpx.Response(200, json={"items": [{"name": "Olive oil", "price": 19.99}]})
        return httpx.Response(404)

    restore = _install_mock(responder)
    try:
        r = run_wab_flow("shop.example.com", "search_products", {"q": "olive oil"})
        assert r.ok is True
        assert r.stage == "execute"
        assert r.result["items"][0]["name"] == "Olive oil"
    finally:
        restore()


def test_plain_tool_factory_shape():
    """When neither crewai nor langchain is installed, fallback object is returned."""
    t = WABLiveTool(prefer="plain")
    assert t.name == "wab_live"
    assert "revocation" in t.description.lower()
    assert t.args_schema.__name__ == "WABLiveToolInput"
    # invoke style
    assert callable(t.invoke)
    assert callable(t.run)
