import * as styles from "./styles.ts";

export function ErrorBanner({ error }: { error: string }) {
  if (!error) return null;
  return <div style={styles.errorBanner}>{error}</div>;
}
