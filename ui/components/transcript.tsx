import * as styles from "./styles.ts";

export function Transcript({ text }: { text: string }) {
  if (!text) return null;
  return (
    <div style={styles.bubbleRow(true)}>
      <div style={styles.transcriptBubble}>
        <div style={styles.bubbleText}>{text}</div>
      </div>
    </div>
  );
}
