// secrets.ts — Per-customer secret store backed by a JSON file.
//
// File format:
// {
//   "pk_customer_abc": { "WEATHER_API_KEY": "sk-abc", "DB_KEY": "xyz" },
//   "pk_customer_def": { "STRIPE_KEY": "sk-123" }
// }
//
// API key from the WebSocket connection is the lookup key.

import { readFileSync } from "fs";

export type SecretStore = ReadonlyMap<string, Record<string, string>>;

/**
 * Load a secrets file and return a map of API key → secrets.
 * Throws on invalid JSON or missing file.
 */
export function loadSecretsFile(filePath: string): SecretStore {
  const raw = readFileSync(filePath, "utf-8");
  const data = JSON.parse(raw) as Record<string, Record<string, string>>;

  const store = new Map<string, Record<string, string>>();
  for (const [key, secrets] of Object.entries(data)) {
    store.set(key, secrets);
  }
  return store;
}
