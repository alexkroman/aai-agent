import { useSession } from "../context.tsx";
import { ChatView } from "./ChatView.tsx";
import * as styles from "./styles.ts";

export function App() {
  const { started, start } = useSession();

  if (!started.value) {
    return (
      <div style={styles.startWrapper}>
        <button type="button" style={styles.startButton} onClick={start}>
          Start Conversation
        </button>
      </div>
    );
  }

  return <ChatView />;
}
