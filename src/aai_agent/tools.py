"""Re-exported smolagents tools for convenience."""

from smolagents import (
    DuckDuckGoSearchTool,
    PythonInterpreterTool,
    VisitWebpageTool,
    WikipediaSearchTool,
)
from smolagents.tools import Tool

__all__ = [
    "AskUserTool",
    "DuckDuckGoSearchTool",
    "PythonInterpreterTool",
    "VisitWebpageTool",
    "WikipediaSearchTool",
    "resolve_tools",
]


class AskUserTool(Tool):
    """Ask the user a clarifying question via voice.

    Unlike smolagents' built-in UserInputTool (which calls input()),
    this returns the question as the final answer so it gets spoken
    aloud by TTS. The user's reply comes back as the next voice turn.
    """

    name = "ask_user"
    description = (
        "Ask the user a clarifying question. Use this when you need more "
        "information to answer properly. The question will be spoken aloud."
    )
    inputs = {
        "question": {
            "type": "string",
            "description": "The question to ask the user.",
        }
    }
    output_type = "string"

    def forward(self, question: str) -> str:
        return question

TOOL_REGISTRY = {
    "AskUserTool": AskUserTool,
    "DuckDuckGoSearchTool": DuckDuckGoSearchTool,
    "VisitWebpageTool": VisitWebpageTool,
    "WikipediaSearchTool": WikipediaSearchTool,
    "PythonInterpreterTool": PythonInterpreterTool,
}


def resolve_tools(tools: list) -> list:
    """Resolve a mixed list of tool instances and string names into tool instances.

    Strings are looked up in the built-in tool registry. Tool instances are
    passed through unchanged.

    Args:
        tools: List of tool instances or string names (e.g. "DuckDuckGoSearchTool").

    Returns:
        List of instantiated tool objects.
    """
    resolved = []
    for tool in tools:
        if isinstance(tool, str):
            cls = TOOL_REGISTRY.get(tool)
            if cls is None:
                raise ValueError(
                    f"Unknown tool: {tool!r}. "
                    f"Available: {', '.join(TOOL_REGISTRY)}"
                )
            resolved.append(cls())
        else:
            resolved.append(tool)
    return resolved
