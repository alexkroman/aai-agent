"""
Example: Voice Assistant Web App

A browser-based voice assistant using the aai-agent SDK.
Demonstrates real-time STT, agent tool-calling, and TTS playback.

Usage:
    pip install aai-agent[examples]
    cd examples/web_assistant
    cp .env.example .env  # fill in your API keys
    python server.py
"""

import uvicorn
from dotenv import load_dotenv

from aai_agent import VoiceAgentManager
from aai_agent.fastapi import create_voice_app
from aai_agent.tools import (
    DuckDuckGoSearchTool,
    VisitWebpageTool,
    WikipediaSearchTool,
    PythonInterpreterTool,
)

load_dotenv()

agent_manager = VoiceAgentManager(
    tools=[
        DuckDuckGoSearchTool(),
        VisitWebpageTool(),
        WikipediaSearchTool(),
        PythonInterpreterTool(),
    ],
)

app = create_voice_app(
    agent_manager=agent_manager,
    cors_origins=["http://localhost:5173", "http://localhost:3000"],
    static_dir="static",
)

if __name__ == "__main__":
    uvicorn.run("server:app", host="localhost", port=8000, reload=True)
