import type { Logger } from "../_utils/logger.ts";
import type { CallLLMOptions } from "./llm.ts";
import type { ChatMessage, LLMResponse, ToolSchema } from "./types.ts";

const FINAL_ANSWER_TOOL = "final_answer";

const MAX_TOOL_ITERATIONS = 3;

export interface TurnContext {
  messages: ChatMessage[];
  toolSchemas: ToolSchema[];
  logger: Logger;
  callLLM(opts: CallLLMOptions): Promise<LLMResponse>;
  executeBuiltinTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<string | null>;
  executeUserTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<string>;
  apiKey: string;
  model: string;
  gatewayBase?: string;
}

export interface TurnResult {
  text: string;
  steps: string[];
}

function truncate(s: string | null | undefined, max = 300): string {
  if (!s) return "(empty)";
  return s.length > max ? s.slice(0, max) + "…" : s;
}

function formatMessages(messages: ChatMessage[]): string[] {
  return messages.map((m) => {
    const role = m.role.toUpperCase();
    if (m.tool_calls?.length) {
      const calls = m.tool_calls.map((tc) =>
        `${tc.function.name}(${truncate(tc.function.arguments, 200)})`
      ).join(", ");
      return `[${role}] tool_calls: ${calls}`;
    }
    if (m.role === "tool") {
      return `[TOOL ${m.tool_call_id}] ${truncate(m.content as string, 200)}`;
    }
    return `[${role}] ${truncate(m.content as string)}`;
  });
}

function logLlmRequest(
  logger: Logger,
  label: string,
  messages: ChatMessage[],
  toolChoice?: string,
  toolCount?: number,
): void {
  logger.info(`── ${label} ──`, {
    toolChoice: toolChoice ?? "auto",
    tools: toolCount ?? 0,
    messageCount: messages.length,
  });
  for (const line of formatMessages(messages)) {
    logger.info(`  ${line}`);
  }
}

function logLlmResponse(
  logger: Logger,
  label: string,
  response: LLMResponse,
): void {
  const choice = response.choices[0];
  const msg = choice?.message;
  if (msg?.tool_calls?.length) {
    const calls = msg.tool_calls.map((tc) =>
      `${tc.function.name}(${truncate(tc.function.arguments, 200)})`
    ).join(", ");
    logger.info(`← ${label}`, {
      finishReason: choice?.finish_reason,
      toolCalls: calls,
    });
  } else {
    logger.info(`← ${label}`, {
      finishReason: choice?.finish_reason,
      content: truncate(msg?.content),
    });
  }
}

function extractFinalAnswer(msg: ChatMessage): string | null {
  const fa = msg.tool_calls?.find(
    (tc) => tc.function.name === FINAL_ANSWER_TOOL,
  );
  if (!fa) return null;
  try {
    const args = JSON.parse(fa.function.arguments) as Record<string, unknown>;
    return (args.answer as string) ?? "";
  } catch {
    return "";
  }
}

export async function executeTurn(
  text: string,
  ctx: TurnContext,
  signal: AbortSignal,
): Promise<TurnResult> {
  const { messages, toolSchemas, logger } = ctx;
  messages.push({ role: "user", content: text });

  const toolChoice = toolSchemas.length > 0 ? "required" as const : undefined;
  const finalAnswerSchema = toolSchemas.find(
    (t) => t.name === FINAL_ANSWER_TOOL,
  );
  const steps: string[] = [];

  function callLLM(
    tools: ToolSchema[],
    choice: CallLLMOptions["toolChoice"],
  ) {
    return ctx.callLLM({
      messages,
      tools,
      toolChoice: choice,
      apiKey: ctx.apiKey,
      model: ctx.model,
      signal,
      gatewayBase: ctx.gatewayBase,
    });
  }

  logLlmRequest(
    logger,
    "LLM call #1",
    messages,
    toolChoice,
    toolSchemas.length,
  );
  let response = await callLLM(toolSchemas, toolChoice);
  logLlmResponse(logger, "LLM response #1", response);

  for (let i = 0; i <= MAX_TOOL_ITERATIONS; i++) {
    const choice = response.choices[0];
    if (!choice) break;
    const msg = choice.message;

    // Check for final_answer — return immediately
    const answer = extractFinalAnswer(msg);
    if (answer !== null) {
      steps.push("Using final_answer");
      messages.push({ role: "assistant", content: answer });
      logger.info("turn complete (final_answer)", {
        responseLength: answer.length,
        steps,
      });
      return { text: answer, steps };
    }

    // No more re-calls — return whatever text we have
    if (i === MAX_TOOL_ITERATIONS) {
      const fallback = msg.content ??
        "Sorry, I couldn't generate a response.";
      messages.push({ role: "assistant", content: fallback });
      return { text: fallback, steps };
    }

    // Execute tool calls
    if (msg.tool_calls?.length) {
      messages.push({
        role: "assistant",
        content: msg.content,
        tool_calls: msg.tool_calls,
      });
      for (const tc of msg.tool_calls) {
        steps.push(`Using ${tc.function.name}`);
      }

      logger.info("executing tools", {
        tools: msg.tool_calls.map((tc) => tc.function.name),
        iteration: i + 1,
      });

      const toolResults = await Promise.allSettled(
        msg.tool_calls.map(async (tc) => {
          let args: Record<string, unknown>;
          try {
            args = JSON.parse(tc.function.arguments) as Record<
              string,
              unknown
            >;
          } catch (err) {
            logger.error("Failed to parse tool arguments", {
              err,
              tool: tc.function.name,
            });
            return `Error: Invalid JSON arguments for tool "${tc.function.name}"`;
          }
          logger.info("tool call", { tool: tc.function.name, args });

          const builtinResult = await ctx.executeBuiltinTool(
            tc.function.name,
            args,
          );
          const result = builtinResult ??
            (await ctx.executeUserTool(tc.function.name, args));
          logger.info("tool result", {
            tool: tc.function.name,
            resultLength: result.length,
            result: result.length > 500
              ? result.slice(0, 500) + "..."
              : result,
          });
          return result;
        }),
      );

      for (let j = 0; j < msg.tool_calls.length; j++) {
        const r = toolResults[j];
        messages.push({
          role: "tool",
          content: r.status === "fulfilled"
            ? r.value
            : `Error: ${r.reason}`,
          tool_call_id: msg.tool_calls[j].id,
        });
      }
    } else if (
      choice.finish_reason === "tool_use" ||
      choice.finish_reason === "tool_calls"
    ) {
      logger.warn(
        "finish_reason indicates tool use but no tool_calls present, retrying",
        { finishReason: choice.finish_reason, content: truncate(msg.content) },
      );
      if (msg.content) {
        messages.push({ role: "assistant", content: msg.content });
      }
    } else {
      // Text response — shouldn't happen with toolChoice required, but handle it
      const responseText = msg.content ??
        "Sorry, I couldn't generate a response.";
      messages.push({ role: "assistant", content: responseText });
      logger.info("turn complete", {
        responseLength: responseText.length,
        steps,
      });
      return { text: responseText, steps };
    }

    if (signal.aborted) break;

    // Re-call LLM — force final_answer on last iteration
    const callNum = i + 2;
    const lastIteration = i + 1 >= MAX_TOOL_ITERATIONS;

    if (lastIteration && finalAnswerSchema) {
      logLlmRequest(
        logger,
        `LLM call #${callNum} (forced final_answer)`,
        messages,
        FINAL_ANSWER_TOOL,
        1,
      );
      response = await callLLM([finalAnswerSchema], {
        type: "function" as const,
        function: { name: FINAL_ANSWER_TOOL },
      });
    } else {
      logLlmRequest(
        logger,
        `LLM call #${callNum} (after tools)`,
        messages,
        toolChoice,
        toolSchemas.length,
      );
      response = await callLLM(toolSchemas, toolChoice);
    }
    logLlmResponse(logger, `LLM response #${callNum}`, response);
  }

  return { text: "", steps };
}
