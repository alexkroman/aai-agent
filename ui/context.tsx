// context.tsx — Preact context for SessionSignals. No prop-drilling needed.

import { createContext } from "preact";
import { useContext } from "preact/hooks";
import type { ComponentChildren } from "preact";
import type { SessionSignals } from "./signals.ts";

const Ctx = createContext<SessionSignals | null>(null);

export function SessionProvider(
  { value, children }: { value: SessionSignals; children: ComponentChildren },
) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionSignals {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSession() requires <SessionProvider>");
  return ctx;
}
