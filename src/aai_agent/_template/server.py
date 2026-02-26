"""
Voice Assistant Web App

Usage:
    cp .env.example .env  # add your API keys
    aai-agent start
"""

from aai_agent import tool
from aai_agent.fastapi import create_voice_app


@tool
def get_weather(city: str) -> str:
    """Get the current weather for a city.

    Args:
        city: The city to get weather for, e.g. "San Francisco".
    """
    return f"The weather in {city} is 72°F and sunny."


app = create_voice_app(
    tools=[get_weather],
)
