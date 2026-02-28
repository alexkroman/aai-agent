import { Agent, fetchJSON, z } from "@aai/sdk";

// ── Response schemas (only validate fields we actually use) ─────

const FdaDrugLabelResponse = z.object({
  results: z.array(
    z.object({
      openfda: z.object({
        generic_name: z.array(z.string()).optional(),
        brand_name: z.array(z.string()).optional(),
        manufacturer_name: z.array(z.string()).optional(),
      }).passthrough().optional(),
      purpose: z.array(z.string()).optional(),
      indications_and_usage: z.array(z.string()).optional(),
      warnings: z.array(z.string()).optional(),
      dosage_and_administration: z.array(z.string()).optional(),
      adverse_reactions: z.array(z.string()).optional(),
    }).passthrough(),
  ).optional(),
}).passthrough();

const RxCuiResponse = z.object({
  idGroup: z.object({
    rxnormId: z.array(z.string()).optional(),
  }).passthrough(),
}).passthrough();

const RxInteractionResponse = z.object({
  fullInteractionTypeGroup: z.array(
    z.object({
      fullInteractionType: z.array(
        z.object({
          interactionPair: z.array(
            z.object({
              description: z.string(),
              severity: z.string(),
            }).passthrough(),
          ).optional(),
        }).passthrough(),
      ).optional(),
    }).passthrough(),
  ).optional(),
}).passthrough();

export const agent = new Agent({
  name: "Dr. Sage",
  instructions:
    `You are Dr. Sage, a friendly health information assistant. You help people
understand symptoms, look up medication details, check drug interactions, and calculate
basic health metrics.

Rules:
- You are NOT a doctor and cannot diagnose or prescribe. Always remind users to consult
  a healthcare provider for medical decisions.
- Be clear and calm when discussing symptoms — avoid alarming language
- When discussing medications, always mention common side effects
- Use plain language first, then mention the medical term
- Keep responses concise — this is a voice conversation
- If symptoms sound urgent (chest pain, difficulty breathing, sudden numbness),
  advise calling emergency services immediately
- Use web_search to look up current symptom information when needed`,
  greeting:
    "Hi, I'm Dr. Sage! I can help you look up symptoms, medication info, drug interactions, and health metrics. Just remember — I'm not a real doctor, so always check with your healthcare provider. What can I help with?",
  voice: "tara",
  prompt:
    "Transcribe medical and health terms accurately including drug names like acetaminophen, ibuprofen, amoxicillin, metformin, lisinopril, atorvastatin, omeprazole, and levothyroxine. Listen for dosages like 500 milligrams, 10 milliliters, and 200 micrograms. Recognize symptoms, body parts, and medical terms like hypertension, tachycardia, dyspnea, edema, cholesterol, and gastrointestinal.",
  builtinTools: ["web_search"],
})
  .tool("drug_info", {
    description:
      "Look up detailed information about a medication from the FDA database including usage, warnings, and side effects.",
    parameters: z.object({
      name: z
        .string()
        .describe(
          "Medication name (generic or brand, e.g. 'ibuprofen' or 'Advil')",
        ),
    }),
    handler: async ({ name }, ctx) => {
      const encoded = encodeURIComponent(name.toLowerCase());
      const data = await fetchJSON(
        ctx.fetch,
        `https://api.fda.gov/drug/label.json?search=openfda.generic_name:"${encoded}"+openfda.brand_name:"${encoded}"&limit=1`,
        undefined,
        FdaDrugLabelResponse,
      );
      if ("error" in data) return { error: `Drug not found: ${name}` };
      const results = data.results;
      if (!results?.length) return { error: `No FDA data found for: ${name}` };
      const drug = results[0];
      const openfda = drug.openfda ?? {};
      return {
        name: openfda.generic_name?.[0] ?? name,
        brand_names: openfda.brand_name ?? [],
        purpose: str(drug.purpose) ?? str(drug.indications_and_usage) ?? "N/A",
        warnings: str(drug.warnings)?.slice(0, 500) ?? "N/A",
        dosage: str(drug.dosage_and_administration)?.slice(0, 500) ?? "N/A",
        side_effects: str(drug.adverse_reactions)?.slice(0, 500) ?? "N/A",
        manufacturer: openfda.manufacturer_name?.[0] ?? "N/A",
      };
    },
  })
  .tool("check_interaction", {
    description:
      "Check for known interactions between two or more medications using the NIH database.",
    parameters: z.object({
      drugs: z
        .string()
        .describe(
          "Comma-separated medication names (e.g. 'ibuprofen, warfarin')",
        ),
    }),
    handler: async ({ drugs }, ctx) => {
      const drugNames = drugs.split(",").map((d) => d.trim().toLowerCase());

      // Resolve each drug name to an RxCUI
      const rxcuis: { name: string; rxcui: string }[] = [];
      for (const drug of drugNames) {
        const data = await fetchJSON(
          ctx.fetch,
          `https://rxnav.nlm.nih.gov/REST/rxcui.json?name=${
            encodeURIComponent(drug)
          }`,
          undefined,
          RxCuiResponse,
        );
        if ("error" in data) continue;
        const rxcui = data.idGroup.rxnormId?.[0];
        if (rxcui) rxcuis.push({ name: drug, rxcui });
      }

      if (rxcuis.length < 2) {
        return {
          error: `Could not resolve all drug names. Found: ${
            rxcuis.map((r) => r.name).join(", ") || "none"
          }`,
        };
      }

      const rxcuiList = rxcuis.map((r) => r.rxcui).join("+");
      const data = await fetchJSON(
        ctx.fetch,
        `https://rxnav.nlm.nih.gov/REST/interaction/list.json?rxcuis=${rxcuiList}`,
        undefined,
        RxInteractionResponse,
      );
      if ("error" in data) return { error: "Interaction lookup failed" };

      const interactions = data.fullInteractionTypeGroup
        ?.flatMap((g) => g.fullInteractionType ?? [])
        ?.flatMap((t) => t.interactionPair ?? [])
        ?.map((pair) => ({
          description: pair.description,
          severity: pair.severity,
        })) ?? [];

      return {
        drugs: rxcuis.map((r) => ({ name: r.name, rxcui: r.rxcui })),
        interactions_found: interactions.length,
        interactions: interactions.slice(0, 5),
      };
    },
  })
  .tool("calculate_bmi", {
    description: "Calculate Body Mass Index from height and weight.",
    parameters: z.object({
      weight: z.number().describe("Weight value"),
      weight_unit: z.string().describe("Weight unit: 'kg' or 'lb'"),
      height: z.number().describe("Height value"),
      height_unit: z
        .string()
        .describe("Height unit: 'cm', 'm', 'in', or 'ft'"),
    }),
    handler: ({ weight, weight_unit, height, height_unit }) => {
      let weightKg = weight;
      if (weight_unit === "lb") weightKg = weight * 0.453592;
      let heightM = height;
      if (height_unit === "cm") heightM = height / 100;
      if (height_unit === "in") heightM = height * 0.0254;
      if (height_unit === "ft") heightM = height * 0.3048;
      const bmi = weightKg / (heightM * heightM);
      let category = "obese";
      if (bmi < 18.5) category = "underweight";
      else if (bmi < 25) category = "normal";
      else if (bmi < 30) category = "overweight";
      return {
        bmi: Math.round(bmi * 10) / 10,
        category,
        weight_kg: Math.round(weightKg * 10) / 10,
        height_m: Math.round(heightM * 100) / 100,
      };
    },
  })
  .tool("dosage_by_weight", {
    description:
      "Calculate a weight-based medication dosage. Common for pediatric dosing and certain medications.",
    parameters: z.object({
      medication: z.string().describe("Medication name"),
      weight: z.number().describe("Patient weight"),
      weight_unit: z.string().describe("Weight unit: 'kg' or 'lb'"),
      dose_per_kg: z
        .number()
        .describe("Recommended dose in mg per kg of body weight"),
      frequency: z
        .string()
        .optional()
        .describe(
          "Dosing frequency (e.g. 'every 6 hours', 'twice daily')",
        ),
    }),
    handler: (
      { medication, weight, weight_unit, dose_per_kg, frequency },
    ) => {
      let weightKg = weight;
      if (weight_unit === "lb") weightKg = weight * 0.453592;
      const dose = weightKg * dose_per_kg;
      return {
        medication,
        patient_weight_kg: Math.round(weightKg * 10) / 10,
        dose_per_kg_mg: dose_per_kg,
        calculated_dose_mg: Math.round(dose * 10) / 10,
        frequency: frequency ?? "as directed",
        note:
          "This is an estimate. Always verify with a pharmacist or prescriber.",
      };
    },
  });

/** Extract first string from an FDA field (which is always string[]). */
function str(field: unknown): string | undefined {
  return Array.isArray(field) ? field[0] : undefined;
}
