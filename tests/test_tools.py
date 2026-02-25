"""Tests for aai_agent.tools."""

import pytest
from smolagents import DuckDuckGoSearchTool, VisitWebpageTool

from aai_agent.tools import (
    TOOL_REGISTRY,
    AskUserTool,
    resolve_tools,
)


class TestAskUserTool:
    def test_name(self):
        tool = AskUserTool()
        assert tool.name == "ask_user"

    def test_forward_returns_question(self):
        tool = AskUserTool()
        result = tool.forward("What city are you in?")
        assert result == "What city are you in?"

    def test_output_type(self):
        tool = AskUserTool()
        assert tool.output_type == "string"


class TestToolRegistry:
    def test_registry_has_all_tools(self):
        assert "AskUserTool" in TOOL_REGISTRY
        assert "DuckDuckGoSearchTool" in TOOL_REGISTRY
        assert "VisitWebpageTool" in TOOL_REGISTRY
        assert "WikipediaSearchTool" in TOOL_REGISTRY
        assert "PythonInterpreterTool" in TOOL_REGISTRY

    def test_registry_values_are_classes(self):
        for name, cls in TOOL_REGISTRY.items():
            assert callable(cls), f"{name} should be callable"


class TestResolveTools:
    def test_resolve_strings(self):
        tools = resolve_tools(["DuckDuckGoSearchTool", "VisitWebpageTool"])
        assert len(tools) == 2
        assert isinstance(tools[0], DuckDuckGoSearchTool)
        assert isinstance(tools[1], VisitWebpageTool)

    def test_resolve_instances(self):
        instance = DuckDuckGoSearchTool()
        tools = resolve_tools([instance])
        assert len(tools) == 1
        assert tools[0] is instance

    def test_resolve_mixed(self):
        instance = DuckDuckGoSearchTool()
        tools = resolve_tools([instance, "VisitWebpageTool"])
        assert len(tools) == 2
        assert tools[0] is instance
        assert isinstance(tools[1], VisitWebpageTool)

    def test_resolve_empty(self):
        assert resolve_tools([]) == []

    def test_resolve_unknown_raises(self):
        with pytest.raises(ValueError, match="Unknown tool: 'NotARealTool'"):
            resolve_tools(["NotARealTool"])

    def test_resolve_unknown_shows_available(self):
        with pytest.raises(ValueError, match="Available:"):
            resolve_tools(["BadTool"])

    def test_resolve_all_strings(self):
        tools = resolve_tools(list(TOOL_REGISTRY.keys()))
        assert len(tools) == len(TOOL_REGISTRY)
