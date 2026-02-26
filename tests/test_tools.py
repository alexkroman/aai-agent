"""Tests for aai_agent.tools."""

from aai_agent.tools import ask_user


class TestAskUser:
    def test_returns_question(self):
        result = ask_user("What city are you in?")
        assert result == "What city are you in?"

    def test_returns_empty_string(self):
        result = ask_user("")
        assert result == ""
