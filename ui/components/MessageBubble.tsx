import type { Message } from "../types.ts";
import * as styles from "./styles.ts";

export function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";
  return (
    <div style={styles.bubbleRow(isUser)}>
      <div style={styles.bubble(isUser)}>
        <div style={styles.bubbleText}>{message.text}</div>
        {message.steps && message.steps.length > 0 && (
          <div style={styles.stepsText}>{message.steps.join(" \u2192 ")}</div>
        )}
      </div>
    </div>
  );
}
