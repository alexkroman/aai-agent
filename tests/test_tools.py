"""Tests for aai_agent.tools."""

from aai_agent.tools import visit_url_tool


class TestVisitUrlTool:
    def test_creates_tool(self):
        tool = visit_url_tool()
        assert tool.name == "visit_url"
