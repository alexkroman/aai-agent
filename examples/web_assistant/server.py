"""
Voice Assistant Web App — with web search tools.

Usage:
    cp .env.example .env  # add your API keys
    aai-agent start
"""

from aai_agent.fastapi import create_voice_app

app = create_voice_app(
    tools=[
        "DuckDuckGoSearchTool",
        "VisitWebpageTool",
        "WikipediaSearchTool",
        "PythonInterpreterTool",
    ],
)
