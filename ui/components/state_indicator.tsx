import type { AgentState } from "../types.ts";
import * as styles from "./styles.ts";

export function StateIndicator({ state }: { state: AgentState }) {
  return (
    <div style={styles.stateRow}>
      <div style={styles.stateDot(state)} />
      <span style={styles.stateLabel}>{state}</span>
    </div>
  );
}
