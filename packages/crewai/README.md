# web-agent-bridge-crewai

CrewAI / LangChain-Python tool wrapper for **Web Agent Bridge (WAB)** — the
discover → verify-live → execute pipeline that lets an LLM agent transact
safely with any WAB-enabled site, with **non-bypassable revocation enforcement**.

> Mirrors the JS `WABLiveTool` from `web-agent-bridge-langchain`. Same canonical
> system prompt (`SYSTEM_PROMPT_VERSION = "1.0.0"`). Same revocation gate.

## Install

```bash
pip install web-agent-bridge-crewai

# Optional integrations:
pip install "web-agent-bridge-crewai[crewai]"     # CrewAI BaseTool subclass
pip install "web-agent-bridge-crewai[langchain]"  # LangChain StructuredTool
```

## Quick Start (CrewAI)

```python
from crewai import Agent
from wab_crewai import WABLiveTool, system_prompt

shopper = Agent(
    role="Procurement specialist",
    goal="Find and buy products from WAB-verified merchants only.",
    backstory=system_prompt(agent_name="acme-shopper", agent_version="1.0.0"),
    tools=[WABLiveTool()],
)
```

## Quick Start (LangChain Python)

```python
from langchain_openai import ChatOpenAI
from langgraph.prebuilt import create_react_agent
from wab_crewai import WABLiveTool, system_prompt

agent = create_react_agent(
    ChatOpenAI(model="gpt-4o-mini"),
    tools=[WABLiveTool(prefer="langchain")],
    prompt=system_prompt(agent_name="acme-agent"),
)

result = agent.invoke({
    "messages": [("user", "Find olive oil under $25 on tunisia-olive.com.")]
})
```

## Quick Start (Bare Function)

```python
from wab_crewai import run_wab_flow

r = run_wab_flow("shop.example.com", "search_products", {"q": "olive oil"})
print(r.stage, r.ok)
# → execute True   (or "revoked" False if the site is on the revocation list)
```

## Why the revocation gate is enforced inside the tool

A naive agent might:
1. Skip the `/api/verify-live` step entirely, or
2. See `statuses.revoked == "yes"` and call the action anyway because the LLM
   "thinks the user really wants it".

`WABLiveTool` makes both impossible. The verify-live call is **not** an
optional intermediate step the LLM chooses — it happens automatically inside
`run_wab_flow`, and a `revoked` status short-circuits execution without ever
reaching the action endpoint. The LLM can only see the refusal result.

## Result shape

```python
WABLiveToolResult(
    ok: bool,
    stage: "input" | "discover" | "verify" | "revoked" | "execute",
    domain: str | None,
    action: str | None,
    statuses: dict | None,    # from /api/verify-live
    revocation: dict | None,  # populated when stage == "revoked"
    result: Any | None,       # populated when stage == "execute" and ok=True
    error: str | None,
    hint: str | None,         # human-readable next step for the agent
)
```

## License

MIT © Web Agent Bridge
