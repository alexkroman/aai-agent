import { Agent, z } from "../../mod.ts";

const agent = new Agent({
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
  advise calling emergency services immediately`,
  greeting:
    "Hi, I'm Dr. Sage! I can help you look up symptoms, medication info, drug interactions, and health metrics. Just remember — I'm not a real doctor, so always check with your healthcare provider. What can I help with?",
  voice: "tara",
  prompt:
    "Transcribe medical and health terms accurately including drug names like acetaminophen, ibuprofen, amoxicillin, metformin, lisinopril, atorvastatin, omeprazole, and levothyroxine. Listen for dosages like 500 milligrams, 10 milliliters, and 200 micrograms. Recognize symptoms, body parts, and medical terms like hypertension, tachycardia, dyspnea, edema, cholesterol, and gastrointestinal.",
})
  .tool("check_symptoms", {
    description:
      "Look up possible conditions matching a set of symptoms. Returns conditions ranked by likelihood.",
    parameters: z.object({
      symptoms: z
        .string()
        .describe(
          "Comma-separated symptoms (e.g. 'headache, fever, sore throat')",
        ),
      age: z
        .number()
        .optional()
        .describe("Patient age for more accurate results"),
      sex: z
        .string()
        .optional()
        .describe(
          "Patient sex ('male' or 'female') for more accurate results",
        ),
    }),
    handler: async ({ symptoms, age, sex }, ctx) => {
      const params = new URLSearchParams({ symptoms });
      if (age !== undefined) params.set("age", String(age));
      if (sex) params.set("sex", sex);
      const resp = await ctx.fetch(
        `https://api.example.com/symptoms/check?${params}`,
        {
          headers: {
            Authorization: `Bearer ${ctx.secrets.HEALTH_API_KEY}`,
          },
        },
      );
      if (!resp.ok) {
        return { error: `Symptom lookup failed: ${resp.statusText}` };
      }
      return resp.json();
    },
  })
  .tool("drug_info", {
    description:
      "Look up detailed information about a medication including dosage, side effects, warnings, and what it's prescribed for.",
    parameters: z.object({
      name: z
        .string()
        .describe(
          "Medication name (generic or brand, e.g. 'ibuprofen' or 'Advil')",
        ),
    }),
    handler: async ({ name }, ctx) => {
      const resp = await ctx.fetch(
        `https://api.example.com/drugs/${encodeURIComponent(name)}`,
        {
          headers: {
            Authorization: `Bearer ${ctx.secrets.HEALTH_API_KEY}`,
          },
        },
      );
      if (!resp.ok) return { error: `Drug lookup failed: ${resp.statusText}` };
      return resp.json();
    },
  })
  .tool("check_interaction", {
    description:
      "Check for known interactions between two or more medications.",
    parameters: z.object({
      drugs: z
        .string()
        .describe(
          "Comma-separated medication names (e.g. 'ibuprofen, warfarin')",
        ),
    }),
    handler: async ({ drugs }, ctx) => {
      const resp = await ctx.fetch(
        `https://api.example.com/drugs/interactions?drugs=${
          encodeURIComponent(drugs)
        }`,
        {
          headers: {
            Authorization: `Bearer ${ctx.secrets.HEALTH_API_KEY}`,
          },
        },
      );
      if (!resp.ok) {
        return { error: `Interaction check failed: ${resp.statusText}` };
      }
      return resp.json();
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

export default agent;
