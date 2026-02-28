import type { Logger } from "../_utils/logger.ts";

const MAX_TOOL_ITERATIONS = 3;
import type { CallLLMOptions } from "./llm.ts";
import type { ChatMessage, LLMResponse, ToolSchema } from "./types.ts";

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

function logLlmResponse(logger: Logger, response: LLMResponse): void {
  const choice = response.choices[0];
  logger.info("LLM response", {
    finishReason: choice?.finish_reason,
    toolCalls: choice?.message?.tool_calls?.length ?? 0,
  });
  logger.debug("LLM response detail", {
    content: choice?.message?.content,
    toolCalls: choice?.message?.tool_calls,
  });
}

export async function executeTurn(
  text: string,
  ctx: TurnContext,
  signal: AbortSignal,
): Promise<TurnResult> {
  const { messages, toolSchemas, logger } = ctx;

  messages.push({ role: "user", content: text });

  logger.info("calling LLM", {
    messageCount: messages.length,
    toolCount: toolSchemas.length,
  });
  logger.debug("LLM request", {
    messages,
    model: ctx.model,
  });

  let response = await ctx.callLLM({
    messages,
    tools: toolSchemas,
    apiKey: ctx.apiKey,
    model: ctx.model,
    signal,
    gatewayBase: ctx.gatewayBase,
  });
  logLlmResponse(logger, response);

  const steps: string[] = [];
  let iterations = 0;

  while (iterations < MAX_TOOL_ITERATIONS) {
    const choice = response.choices[0];
    if (!choice) break;

    const msg = choice.message;

    if (msg.tool_calls && msg.tool_calls.length > 0) {
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
        iteration: iterations + 1,
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
            result: result.length > 500 ? result.slice(0, 500) + "..." : result,
          });
          return result;
        }),
      );

      for (let i = 0; i < msg.tool_calls.length; i++) {
        const r = toolResults[i];
        messages.push({
          role: "tool",
          content: r.status === "fulfilled" ? r.value : `Error: ${r.reason}`,
          tool_call_id: msg.tool_calls[i].id,
        });
      }

      if (signal.aborted) break;

      logger.info("re-calling LLM with tool results", {
        messageCount: messages.length,
        iteration: iterations + 1,
      });

      response = await ctx.callLLM({
        messages,
        tools: toolSchemas,
        apiKey: ctx.apiKey,
        model: ctx.model,
        signal,
        gatewayBase: ctx.gatewayBase,
      });
      logLlmResponse(logger, response);
      iterations++;
    } else {
      const responseText = msg.content ??
        "Sorry, I couldn't generate a response.";
      messages.push({ role: "assistant", content: responseText });

      logger.info("turn complete", {
        responseLength: responseText.length,
        steps,
      });

      return { text: responseText, steps };
    }
  }

  // Exhausted tool iterations without a final text response
  return { text: "", steps };
}
