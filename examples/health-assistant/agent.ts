import { Agent, fetchJSON, tool, z } from "@aai/sdk";
import type { ToolContext } from "@aai/sdk";

// ── FDA / NIH helpers ───────────────────────────────────────────

/** Pick the first string from an FDA array-of-strings field. */
function first(field: unknown): string | undefined {
  return Array.isArray(field) ? field[0] : undefined;
}

async function lookupDrug(
  name: string,
  ctx: ToolContext,
): Promise<Record<string, unknown>> {
  const q = encodeURIComponent(name.toLowerCase());
  let raw: Record<string, unknown>;
  try {
    raw = await fetchJSON(
      ctx.fetch,
      `https://api.fda.gov/drug/label.json?search=openfda.generic_name:"${q}"+openfda.brand_name:"${q}"&limit=1`,
    ) as Record<string, unknown>;
  } catch {
    return { error: `Drug not found: ${name}` };
  }

  const results = raw.results as Record<string, unknown>[] | undefined;
  if (!results?.length) return { error: `No FDA data found for: ${name}` };

  const drug = results[0];
  const openfda = (drug.openfda ?? {}) as Record<string, string[]>;
  return {
    name: openfda.generic_name?.[0] ?? name,
    brand_names: openfda.brand_name ?? [],
    purpose: first(drug.purpose) ?? first(drug.indications_and_usage) ?? "N/A",
    warnings: first(drug.warnings)?.slice(0, 500) ?? "N/A",
    dosage: first(drug.dosage_and_administration)?.slice(0, 500) ?? "N/A",
    side_effects: first(drug.adverse_reactions)?.slice(0, 500) ?? "N/A",
    manufacturer: openfda.manufacturer_name?.[0] ?? "N/A",
  };
}

interface RxCui {
  name: string;
  rxcui: string;
}

async function resolveRxCui(
  name: string,
  ctx: ToolContext,
): Promise<RxCui | null> {
  try {
    const raw = await fetchJSON(
      ctx.fetch,
      `https://rxnav.nlm.nih.gov/REST/rxcui.json?name=${
        encodeURIComponent(name)
      }`,
    ) as { idGroup: { rxnormId?: string[] } };
    const id = raw.idGroup.rxnormId?.[0];
    return id ? { name, rxcui: id } : null;
  } catch {
    return null;
  }
}

async function checkInteractions(
  drugs: string,
  ctx: ToolContext,
): Promise<Record<string, unknown>> {
  const names = drugs.split(",").map((d) => d.trim().toLowerCase());

  // Resolve all drug names in parallel
  const resolved = (await Promise.all(names.map((n) => resolveRxCui(n, ctx))))
    .filter((r): r is RxCui => r !== null);

  if (resolved.length < 2) {
    return {
      error: `Could not resolve all drug names. Found: ${
        resolved.map((r) => r.name).join(", ") || "none"
      }`,
    };
  }

  const rxcuiList = resolved.map((r) => r.rxcui).join("+");
  let raw: Record<string, unknown>;
  try {
    raw = await fetchJSON(
      ctx.fetch,
      `https://rxnav.nlm.nih.gov/REST/interaction/list.json?rxcuis=${rxcuiList}`,
    ) as Record<string, unknown>;
  } catch {
    return { error: "Interaction lookup failed" };
  }

  type InteractionGroup = {
    fullInteractionType?: {
      interactionPair?: { description: string; severity: string }[];
    }[];
  };

  const groups = (raw.fullInteractionTypeGroup ?? []) as InteractionGroup[];
  const interactions = groups
    .flatMap((g) => g.fullInteractionType ?? [])
    .flatMap((t) => t.interactionPair ?? [])
    .map(({ description, severity }) => ({ description, severity }));

  return {
    drugs: resolved.map(({ name, rxcui }) => ({ name, rxcui })),
    interactions_found: interactions.length,
    interactions: interactions.slice(0, 5),
  };
}

// ── Agent definition ────────────────────────────────────────────

export default new Agent({
  name: "Dr. Sage",
  instructions:
    `You are Dr. Sage, a friendly health information assistant. You help people \
understand symptoms, look up medication details, check drug interactions, and calculate \
basic health metrics.

Rules:
- You are NOT a doctor and cannot diagnose or prescribe. Always remind users to consult \
a healthcare provider for medical decisions.
- Be clear and calm when discussing symptoms — avoid alarming language
- When discussing medications, always mention common side effects
- Use plain language first, then mention the medical term
- Keep responses concise — this is a voice conversation
- If symptoms sound urgent (chest pain, difficulty breathing, sudden numbness), \
advise calling emergency services immediately
- Use web_search to look up current symptom information when needed

Use run_code for health calculations:
- BMI: weight_kg / (height_m * height_m). Categories: <18.5 underweight, 18.5-25 normal, 25-30 overweight, >30 obese
  Unit conversions: 1 lb = 0.453592 kg, 1 in = 0.0254 m, 1 ft = 0.3048 m, 1 cm = 0.01 m
- Weight-based dosage: dose_mg = weight_kg * dose_per_kg. Always note this is an estimate.`,
  greeting:
    "Hi, I'm Dr. Sage! I can help you look up symptoms, medication info, drug interactions, and health metrics. Just remember — I'm not a real doctor, so always check with your healthcare provider. What can I help with?",
  voice: "tara",
  prompt:
    "Transcribe medical and health terms accurately including drug names like acetaminophen, ibuprofen, amoxicillin, metformin, lisinopril, atorvastatin, omeprazole, and levothyroxine. Listen for dosages like 500 milligrams, 10 milliliters, and 200 micrograms. Recognize symptoms, body parts, and medical terms like hypertension, tachycardia, dyspnea, edema, cholesterol, and gastrointestinal.",
  builtinTools: ["web_search", "run_code"],
  tools: {
    drug_info: tool({
      description:
        "Look up detailed information about a medication from the FDA database including usage, warnings, and side effects.",
      parameters: z.object({
        name: z.string().describe(
          "Medication name (generic or brand, e.g. 'ibuprofen' or 'Advil')",
        ),
      }),
      handler: ({ name }, ctx) => lookupDrug(name, ctx),
    }),
    check_interaction: tool({
      description:
        "Check for known interactions between two or more medications using the NIH database.",
      parameters: z.object({
        drugs: z.string().describe(
          "Comma-separated medication names (e.g. 'ibuprofen, warfarin')",
        ),
      }),
      handler: ({ drugs }, ctx) => checkInteractions(drugs, ctx),
    }),
  },
});
