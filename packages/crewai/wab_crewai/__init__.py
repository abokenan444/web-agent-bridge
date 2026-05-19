"""Web Agent Bridge — CrewAI / LangChain-Python integration.

Public surface:
    WABLiveTool       — pydantic-typed tool with .run() / .invoke().
    run_wab_flow      — bare function (discover -> verify -> execute).
    system_prompt     — canonical WAB agent system prompt v1.0.0.
    SYSTEM_PROMPT     — alias of the canonical text.
    SYSTEM_PROMPT_VERSION
"""
from .system_prompt import SYSTEM_PROMPT, SYSTEM_PROMPT_VERSION, system_prompt
from .tool import WABLiveTool, run_wab_flow, WABLiveToolInput, WABLiveToolResult

__all__ = [
    "WABLiveTool",
    "run_wab_flow",
    "WABLiveToolInput",
    "WABLiveToolResult",
    "system_prompt",
    "SYSTEM_PROMPT",
    "SYSTEM_PROMPT_VERSION",
]

__version__ = "0.1.0"
