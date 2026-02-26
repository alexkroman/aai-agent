"""VoiceAgent — the main entry point for the aai-agent SDK."""

from __future__ import annotations

import asyncio
import logging
import os
import threading
from collections.abc import Callable
from urllib.parse import urlencode

import anyio.to_thread
from smolagents import LiteLLMModel, MultiStepAgent, ToolCallingAgent
from smolagents.agents import (
    ActionStep,
    FinalAnswerPromptTemplate,
    PlanningStep,
    TaskStep,
)
from smolagents.memory import AgentMemory, MemoryStep
from smolagents.tools import Tool

from .stt import AssemblyAISTT
from .tools import AskUserTool, resolve_tools
from .tts import RimeTTS
from .types import (
    FallbackAnswerPrompt,
    STTConfig,
    StreamingToken,
    TTSConfig,
    VoiceResponse,
)

logger = logging.getLogger(__name__)


def _load_dotenv() -> None:
    """Load .env file if python-dotenv is installed. No-op otherwise."""
    try:
        from dotenv import load_dotenv

        load_dotenv()
    except ImportError:
        pass


LLM_GATEWAY_BASE = "https://llm-gateway.assemblyai.com/v1"


class _SafeLiteLLMModel(LiteLLMModel):
    """LiteLLMModel subclass that sanitizes empty text content.

    The LLM Gateway rejects messages with empty text content blocks
    (e.g. when the model returns content="" alongside tool calls).
    This wrapper replaces empty text with a placeholder before sending.
    """

    def _prepare_completion_kwargs(self, messages, **kwargs):  # type: ignore[override]
        completion_kwargs = super()._prepare_completion_kwargs(
            messages=messages, **kwargs
        )
        for msg in completion_kwargs.get("messages", []):
            content = msg.get("content")
            if isinstance(content, str) and not content.strip():
                msg["content"] = "..."
            elif isinstance(content, list):
                for block in content:
                    if (
                        isinstance(block, dict)
                        and block.get("type") == "text"
                        and not (block.get("text") or "").strip()
                    ):
                        block["text"] = "..."
        return completion_kwargs


DEFAULT_MODEL = "claude-haiku-4-5-20251001"

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
    "One to two sentences max. No markdown, no bullet points, no numbered lists, no code. "
    "Sound like a human talking, not a document."
)

DEFAULT_GREETING = "Hey there! I'm a voice assistant. What can I help you with?"

FALLBACK_ANSWER_PROMPT = FallbackAnswerPrompt(
    pre_messages=(
        "An agent tried to answer a user query but got stuck. "
        "You must provide a spoken answer instead. Here is the agent's memory:"
    ),
    post_messages=(
        "Answer the following as if you're speaking to someone in conversation:\n"
        "{{task}}\n\n"
        "Your answer will be read aloud by a text-to-speech system. "
        "Keep it to one or two sentences. Talk like a real person would — "
        "no lists, no formatting, no jargon. Just give them the answer directly."
    ),
)


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
            Defaults to FALLBACK_ANSWER_PROMPT.
        agent_cls: The smolagents agent class to use. Defaults to
            ``ToolCallingAgent``. Can be ``CodeAgent`` or any
            ``MultiStepAgent`` subclass.
        max_tool_threads: Maximum number of concurrent tool execution
            threads. Defaults to 4.
        include_ask_user: Whether to include the built-in ``AskUserTool``
            that lets the agent ask clarifying questions. Defaults to True.
        model_kwargs: Additional keyword arguments passed to
            ``LiteLLMModel`` and forwarded to the LLM provider (e.g.
            ``temperature``, ``top_p``, ``max_tokens``).

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
        tools: list[Tool | str] | None = None,
        instructions: str = DEFAULT_INSTRUCTIONS,
        max_steps: int = 3,
        step_callbacks: list[Callable[[MemoryStep], None]] | None = None,
        tts_config: TTSConfig | None = None,
        stt_config: STTConfig | None = None,
        greeting: str = DEFAULT_GREETING,
        voice_rules: str | None = None,
        fallback_answer_prompt: FallbackAnswerPrompt | None = None,
        stt: AssemblyAISTT | None = None,
        tts: RimeTTS | None = None,
        agent_cls: type[MultiStepAgent] | None = None,
        max_tool_threads: int = 4,
        include_ask_user: bool = True,
        model_kwargs: dict | None = None,
    ):
        _load_dotenv()

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

        if max_steps < 1:
            raise ValueError("max_steps must be at least 1")

        self.stt = stt or AssemblyAISTT(assemblyai_api_key, stt_config)
        self.tts = tts or RimeTTS(rime_api_key, tts_config)

        self._assemblyai_api_key = assemblyai_api_key
        self._model_id = model
        self._tools = resolve_tools(tools) if tools else []
        self._instructions = instructions
        self._greeting = greeting
        self._max_steps = max_steps
        self._step_callbacks = step_callbacks or []
        self._voice_rules = VOICE_RULES if voice_rules is None else voice_rules
        self._fallback_answer_prompt = fallback_answer_prompt or FALLBACK_ANSWER_PROMPT
        self._agent_cls = agent_cls or ToolCallingAgent
        self._max_tool_threads = max_tool_threads
        self._include_ask_user = include_ask_user
        self._model_kwargs = model_kwargs or {}

        self._step_log = threading.local()
        self._agent: MultiStepAgent | None = None
        self._saved_memory_steps: list[TaskStep | ActionStep | PlanningStep] | None = (
            None
        )
        self._current_task: asyncio.Task | None = None

    def _build_agent(self) -> MultiStepAgent:
        """Create the underlying smolagents agent."""
        tools: list[Tool] = []
        if self._include_ask_user:
            tools.append(AskUserTool())
        tools.extend(self._tools)

        model = _SafeLiteLLMModel(
            model_id=f"openai/{self._model_id}",
            api_base=LLM_GATEWAY_BASE,
            api_key=self._assemblyai_api_key,
            flatten_messages_as_text=True,
            **self._model_kwargs,
        )

        # Build kwargs — max_tool_threads is only supported by ToolCallingAgent
        agent_kwargs: dict = {
            "model": model,
            "tools": tools,
            "max_steps": self._max_steps,
            "instructions": self._instructions + self._voice_rules,
            "step_callbacks": [self._on_step, *self._step_callbacks],
        }
        if issubclass(self._agent_cls, ToolCallingAgent):
            agent_kwargs["max_tool_threads"] = self._max_tool_threads

        agent = self._agent_cls(**agent_kwargs)
        agent.prompt_templates["final_answer"] = FinalAnswerPromptTemplate(
            pre_messages=self._fallback_answer_prompt.pre_messages,
            post_messages=self._fallback_answer_prompt.post_messages,
        )
        return agent

    def _invalidate_agent(self) -> None:
        """Mark the agent for rebuild, preserving conversation history."""
        if self._agent is not None:
            try:
                self._saved_memory_steps = list(self._agent.memory.steps)
            except Exception:
                pass
        self._agent = None

    async def _ensure_agent(self) -> MultiStepAgent:
        if self._agent is None:
            self._agent = await anyio.to_thread.run_sync(self._build_agent)
            if self._saved_memory_steps is not None:
                self._agent.memory.steps = self._saved_memory_steps
                self._saved_memory_steps = None
        return self._agent

    def _on_step(self, step: MemoryStep) -> None:
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

    @property
    def greeting(self) -> str:
        """The greeting text spoken when the assistant first connects."""
        return self._greeting

    @property
    def memory(self) -> AgentMemory | None:
        """The agent's conversation memory, or None if the agent hasn't been built yet.

        Returns the underlying smolagents ``AgentMemory`` object which contains
        the full conversation history in ``memory.steps``.
        """
        if self._agent is not None:
            return self._agent.memory
        return None

    async def aclose(self) -> None:
        """Close the underlying STT and TTS HTTP clients."""
        await self.stt.aclose()
        await self.tts.aclose()

    async def __aenter__(self) -> VoiceAgent:
        return self

    async def __aexit__(self, *exc: object) -> None:
        await self.aclose()

    async def reset(self) -> None:
        """Reset the agent's conversation memory.

        Cancels any in-flight task and clears all history so the next
        ``chat()`` call starts a fresh conversation.
        """
        await self.cancel()
        self._saved_memory_steps = None
        self._agent = None

    async def cancel(self) -> None:
        """Cancel any in-flight chat task for this agent."""
        task = self._current_task
        if task is not None and not task.done():
            task.cancel()
            try:
                await task
            except (asyncio.CancelledError, Exception):
                pass
            self._current_task = None

    async def chat(self, message: str, *, reset: bool = False) -> VoiceResponse:
        """Send a text message and get a text response.

        Args:
            message: User's message.
            reset: If True, reset the agent's conversation memory.

        Returns:
            VoiceResponse with text and steps (no audio).
        """
        message = message.strip()
        if not message:
            raise ValueError("message must not be empty")

        # Cancel any in-flight request before starting a new one
        await self.cancel()

        agent = await self._ensure_agent()

        def run():
            self._step_log.steps = []
            try:
                result = agent.run(message, reset=reset)
            except Exception as exc:
                # smolagents raises UnboundLocalError when the agent is
                # interrupted or fails to produce a final_answer.
                # Rebuild the agent to clear corrupted state.
                if isinstance(exc, UnboundLocalError):
                    logger.warning("Agent state corrupted, rebuilding: %s", exc)
                    self._invalidate_agent()
                    steps = list(getattr(self._step_log, "steps", None) or [])
                    self._step_log.steps = None
                    return "Sorry, I got interrupted. Could you say that again?", steps
                raise
            steps = list(self._step_log.steps)
            self._step_log.steps = None
            return str(result), steps

        async def _run_chat():
            return await anyio.to_thread.run_sync(run, abandon_on_cancel=True)

        self._current_task = asyncio.current_task()
        try:
            text, steps = await _run_chat()
        except asyncio.CancelledError:
            logger.info("Chat cancelled (barge-in)")
            # Rebuild agent to clear any partial state, keep history
            self._invalidate_agent()
            raise
        finally:
            self._current_task = None

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

        # If cancelled between chat and TTS, let it propagate
        try:
            response.audio = await self.tts.synthesize(response.text)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.exception("TTS synthesis failed for text: %s", response.text[:100])
            response.error = f"TTS synthesis failed: {exc}"

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
        except Exception as exc:
            logger.exception("TTS synthesis failed for greeting")
            response.error = f"TTS synthesis failed: {exc}"
        return response

    async def create_streaming_token(self) -> StreamingToken:
        """Create an AssemblyAI streaming token and WebSocket URL for browser-side STT.

        Returns:
            StreamingToken with wss_url (ready-to-use WebSocket URL) and sample_rate.
        """
        token = await self.stt.create_token()
        cfg = self.stt.config
        params = urlencode(
            {
                "sample_rate": cfg.sample_rate,
                "speech_model": cfg.speech_model,
                "token": token,
                "format_turns": str(cfg.format_turns).lower(),
                "end_of_turn_confidence_threshold": cfg.end_of_turn_confidence_threshold,
            }
        )
        return StreamingToken(
            wss_url=f"{cfg.wss_base}?{params}",
            sample_rate=cfg.sample_rate,
        )
