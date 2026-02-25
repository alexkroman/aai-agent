"""VoiceAgent — the main entry point for the aai-agent SDK."""

from __future__ import annotations

import os
import threading
from typing import Callable
from urllib.parse import urlencode

import anyio.to_thread
from smolagents import LiteLLMModel, ToolCallingAgent
from smolagents.agents import ActionStep, PlanningStep
from smolagents.tools import Tool

from .stt import AssemblyAISTT
from .tts import RimeTTS
from .types import STTConfig, TTSConfig, VoiceResponse

LLM_GATEWAY_BASE = "https://llm-gateway.assemblyai.com/v1"

DEFAULT_MODEL = "claude-sonnet-4-5-20250929"

DEFAULT_INSTRUCTIONS = """\
You are a helpful voice assistant. Your goal is to provide accurate, \
research-backed answers using your available tools.

Voice-First Rules:
- Optimize for natural speech. Avoid jargon unless central to the answer. \
Use short, punchy sentences.
- Never mention "search results," "sources," or "the provided text." \
Speak as if the knowledge is your own.
- No visual formatting. Do not say "bullet point," "bold," or "bracketed one." \
If you need to list items, say "First," "Next," and "Finally."
- Start with the most important information. No introductory filler.
- Be concise. For complex topics, provide a high-level summary.
- Be confident. Avoid hedging phrases like "It seems that" or "I believe."
- If you don't have enough information, say so directly rather than guessing."""

VOICE_RULES = (
    "\n\nCRITICAL: When you call final_answer, your answer will be spoken aloud by a TTS system. "
    "Write your answer exactly as you would say it out loud to a friend. "
    "Two to three sentences max. No markdown, no bullet points, no numbered lists, no code. "
    "Sound like a human talking, not a document."
)

DEFAULT_GREETING = "Hey there! I'm a voice assistant. What can I help you with?"

FALLBACK_ANSWER_PROMPT = {
    "pre_messages": (
        "An agent tried to answer a user query but got stuck. "
        "You must provide a spoken answer instead. Here is the agent's memory:"
    ),
    "post_messages": (
        "Answer the following as if you're speaking to someone in conversation:\n"
        "{{task}}\n\n"
        "Your answer will be read aloud by a text-to-speech system. "
        "Keep it to two or three sentences. Talk like a real person would — "
        "no lists, no formatting, no jargon. Just give them the answer directly."
    ),
}

class VoiceAgent:
    """A voice-first AI agent backed by AssemblyAI STT, Rime TTS, and smolagents.

    API keys are resolved in this order:

    1. Explicit arguments (``assemblyai_api_key`` / ``rime_api_key``).
    2. Environment variables ``ASSEMBLYAI_API_KEY`` / ``RIME_API_KEY``.

    Args:
        assemblyai_api_key: AssemblyAI API key (used for STT and LLM Gateway).
            Falls back to the ``ASSEMBLYAI_API_KEY`` environment variable.
        rime_api_key: Rime API key for TTS. Falls back to the
            ``RIME_API_KEY`` environment variable.
        model: LLM model ID to use via the AssemblyAI LLM Gateway.
        tools: List of tools the agent can use.
        instructions: System prompt / persona instructions. Defaults to
            DEFAULT_INSTRUCTIONS, a voice-optimized assistant prompt.
        max_steps: Maximum agent reasoning steps per query.
        step_callbacks: Functions called after each agent step.
        tts_config: Rime TTS configuration overrides.
        stt_config: AssemblyAI STT configuration overrides.
        greeting: Text spoken when the assistant first connects. Set to
            empty string to disable. Defaults to DEFAULT_GREETING.
        voice_rules: Appended to instructions to guide voice-friendly output.
            Pass an empty string to disable. Defaults to VOICE_RULES.
        fallback_answer_prompt: Template used when the agent gets stuck.
            Dict with "pre_messages" and "post_messages" keys.
            Defaults to FALLBACK_ANSWER_PROMPT.

    Example::

        from aai_agent import VoiceAgent
        from aai_agent.tools import DuckDuckGoSearchTool, VisitWebpageTool

        # Keys are read from ASSEMBLYAI_API_KEY and RIME_API_KEY env vars
        agent = VoiceAgent(
            tools=[DuckDuckGoSearchTool(), VisitWebpageTool()],
        )

        response = await agent.chat("What is AssemblyAI?")
        print(response.text)

        response = await agent.voice_chat("What is AssemblyAI?")
        # response.text + response.audio (WAV bytes)
    """

    def __init__(
        self,
        assemblyai_api_key: str | None = None,
        rime_api_key: str | None = None,
        *,
        model: str = DEFAULT_MODEL,
        tools: list[Tool] | None = None,
        instructions: str = DEFAULT_INSTRUCTIONS,
        max_steps: int = 5,
        step_callbacks: list[Callable] | None = None,
        tts_config: TTSConfig | None = None,
        stt_config: STTConfig | None = None,
        greeting: str = DEFAULT_GREETING,
        voice_rules: str | None = None,
        fallback_answer_prompt: dict[str, str] | None = None,
    ):
        assemblyai_api_key = assemblyai_api_key or os.environ.get("ASSEMBLYAI_API_KEY")
        if not assemblyai_api_key:
            raise ValueError(
                "assemblyai_api_key must be provided or set via the "
                "ASSEMBLYAI_API_KEY environment variable"
            )

        rime_api_key = rime_api_key or os.environ.get("RIME_API_KEY")
        if not rime_api_key:
            raise ValueError(
                "rime_api_key must be provided or set via the "
                "RIME_API_KEY environment variable"
            )

        self.stt = AssemblyAISTT(assemblyai_api_key, stt_config)
        self.tts = RimeTTS(rime_api_key, tts_config)

        self._assemblyai_api_key = assemblyai_api_key
        self._model_id = model
        self._tools = tools or []
        self._instructions = instructions
        self._greeting = greeting
        self._max_steps = max_steps
        self._step_callbacks = step_callbacks or []
        self._voice_rules = VOICE_RULES if voice_rules is None else voice_rules
        self._fallback_answer_prompt = fallback_answer_prompt or FALLBACK_ANSWER_PROMPT

        self._step_log = threading.local()
        self._agent: ToolCallingAgent | None = None

    def _build_agent(self) -> ToolCallingAgent:
        """Create the underlying smolagents ToolCallingAgent."""
        agent = ToolCallingAgent(
            model=LiteLLMModel(
                model_id=f"openai/{self._model_id}",
                api_base=LLM_GATEWAY_BASE,
                api_key=self._assemblyai_api_key,
                compliant_tool_call=True,
                flatten_messages_as_text=True,
            ),
            tools=self._tools,
            max_steps=self._max_steps,
            instructions=self._instructions + self._voice_rules,
            step_callbacks=[self._on_step, *self._step_callbacks],
        )
        agent.prompt_templates["final_answer"] = self._fallback_answer_prompt
        return agent

    async def _ensure_agent(self) -> ToolCallingAgent:
        if self._agent is None:
            self._agent = await anyio.to_thread.run_sync(self._build_agent)
        return self._agent

    def _on_step(self, step):
        """Collect step summaries into thread-local log."""
        log = getattr(self._step_log, "steps", None)
        if log is None:
            return

        if isinstance(step, PlanningStep) and step.plan:
            log.append(f"Planning: {step.plan[:120]}")
        elif isinstance(step, ActionStep) and not step.is_final_answer:
            if step.tool_calls:
                for tc in step.tool_calls:
                    log.append(f"Using {tc.name}")
            elif step.model_output:
                log.append(step.model_output[:100])

    async def chat(self, message: str, *, reset: bool = False) -> VoiceResponse:
        """Send a text message and get a text response.

        Args:
            message: User's message.
            reset: If True, reset the agent's conversation memory.

        Returns:
            VoiceResponse with text and steps (no audio).
        """
        agent = await self._ensure_agent()

        def run():
            self._step_log.steps = []
            result = agent.run(message, reset=reset)
            steps = list(self._step_log.steps)
            self._step_log.steps = None
            return str(result), steps

        text, steps = await anyio.to_thread.run_sync(run)
        return VoiceResponse(text=text, steps=steps)

    async def voice_chat(self, message: str, *, reset: bool = False) -> VoiceResponse:
        """Send a text message and get a response with synthesized audio.

        Args:
            message: User's message.
            reset: If True, reset the agent's conversation memory.

        Returns:
            VoiceResponse with text, WAV audio bytes, and steps.
        """
        response = await self.chat(message, reset=reset)

        try:
            response.audio = await self.tts.synthesize(response.text)
        except Exception:
            pass  # Audio generation is best-effort

        return response

    async def synthesize(self, text: str) -> bytes:
        """Convert text to speech (convenience wrapper around self.tts).

        Args:
            text: Text to convert to speech.

        Returns:
            WAV audio bytes.
        """
        return await self.tts.synthesize(text)

    async def greet(self) -> VoiceResponse:
        """Return the greeting message with synthesized audio.

        Returns:
            VoiceResponse with greeting text and audio. If greeting is
            empty or TTS fails, audio will be None.
        """
        if not self._greeting:
            return VoiceResponse(text="")

        response = VoiceResponse(text=self._greeting)
        try:
            response.audio = await self.tts.synthesize(self._greeting)
        except Exception:
            pass
        return response

    async def create_streaming_token(self) -> dict:
        """Create an AssemblyAI streaming token and WebSocket URL for browser-side STT.

        Returns:
            Dict with wss_url (ready-to-use WebSocket URL) and sample_rate.
        """
        token = await self.stt.create_token()
        cfg = self.stt.config
        params = urlencode({
            "sample_rate": cfg.sample_rate,
            "speech_model": cfg.speech_model,
            "token": token,
            "format_turns": str(cfg.format_turns).lower(),
            "end_of_turn_confidence_threshold": cfg.end_of_turn_confidence_threshold,
        })
        return {
            "wss_url": f"{cfg.wss_base}?{params}",
            "sample_rate": cfg.sample_rate,
        }
