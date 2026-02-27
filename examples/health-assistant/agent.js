const { VoiceAgent } = await import("/client.js");

VoiceAgent.start({
  element: "#app",
  apiKey: "pk_your_publishable_key",

  prompt:
    "Transcribe medical and health terms accurately including drug names like acetaminophen, ibuprofen, amoxicillin, metformin, lisinopril, atorvastatin, omeprazole, and levothyroxine. Listen for dosages like 500 milligrams, 10 milliliters, and 200 micrograms. Recognize symptoms, body parts, and medical terms like hypertension, tachycardia, dyspnea, edema, cholesterol, and gastrointestinal.",

  instructions: `You are Dr. Sage, a friendly health information assistant. You help people
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

  tools: {
    check_symptoms: {
      description:
        "Look up possible conditions matching a set of symptoms. Returns conditions ranked by likelihood.",
      parameters: {
        symptoms: {
          type: "string",
          description:
            "Comma-separated symptoms (e.g. 'headache, fever, sore throat')",
        },
        age: {
          type: "number?",
          description: "Patient age for more accurate results",
        },
        sex: {
          type: "string?",
          description:
            "Patient sex ('male' or 'female') for more accurate results",
        },
      },
      handler: async (args, ctx) => {
        const params = new URLSearchParams({ symptoms: args.symptoms });
        if (args.age) params.set("age", String(args.age));
        if (args.sex) params.set("sex", args.sex);
        const resp = ctx.fetch(
          `https://api.example.com/symptoms/check?${params}`,
          {
            headers: {
              Authorization: `Bearer ${ctx.secrets.HEALTH_API_KEY}`,
            },
          },
        );
        if (!resp.ok)
          return { error: `Symptom lookup failed: ${resp.statusText}` };
        return resp.json();
      },
    },

    drug_info: {
      description:
        "Look up detailed information about a medication including dosage, side effects, warnings, and what it's prescribed for.",
      parameters: {
        name: {
          type: "string",
          description:
            "Medication name (generic or brand, e.g. 'ibuprofen' or 'Advil')",
        },
      },
      handler: async (args, ctx) => {
        const resp = ctx.fetch(
          `https://api.example.com/drugs/${encodeURIComponent(args.name)}`,
          {
            headers: {
              Authorization: `Bearer ${ctx.secrets.HEALTH_API_KEY}`,
            },
          },
        );
        if (!resp.ok)
          return { error: `Drug lookup failed: ${resp.statusText}` };
        return resp.json();
      },
    },

    check_interaction: {
      description:
        "Check for known interactions between two or more medications.",
      parameters: {
        drugs: {
          type: "string",
          description:
            "Comma-separated medication names (e.g. 'ibuprofen, warfarin')",
        },
      },
      handler: async (args, ctx) => {
        const resp = ctx.fetch(
          `https://api.example.com/drugs/interactions?drugs=${encodeURIComponent(args.drugs)}`,
          {
            headers: {
              Authorization: `Bearer ${ctx.secrets.HEALTH_API_KEY}`,
            },
          },
        );
        if (!resp.ok)
          return {
            error: `Interaction check failed: ${resp.statusText}`,
          };
        return resp.json();
      },
    },

    calculate_bmi: {
      description: "Calculate Body Mass Index from height and weight.",
      parameters: {
        weight: { type: "number", description: "Weight value" },
        weight_unit: {
          type: "string",
          description: "Weight unit: 'kg' or 'lb'",
        },
        height: { type: "number", description: "Height value" },
        height_unit: {
          type: "string",
          description: "Height unit: 'cm', 'm', 'in', or 'ft'",
        },
      },
      handler: async (args) => {
        let weightKg = args.weight;
        if (args.weight_unit === "lb") weightKg = args.weight * 0.453592;

        let heightM = args.height;
        if (args.height_unit === "cm") heightM = args.height / 100;
        if (args.height_unit === "in") heightM = args.height * 0.0254;
        if (args.height_unit === "ft") heightM = args.height * 0.3048;

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
    },

    dosage_by_weight: {
      description:
        "Calculate a weight-based medication dosage. Common for pediatric dosing and certain medications.",
      parameters: {
        medication: { type: "string", description: "Medication name" },
        weight: { type: "number", description: "Patient weight" },
        weight_unit: {
          type: "string",
          description: "Weight unit: 'kg' or 'lb'",
        },
        dose_per_kg: {
          type: "number",
          description: "Recommended dose in mg per kg of body weight",
        },
        frequency: {
          type: "string?",
          description: "Dosing frequency (e.g. 'every 6 hours', 'twice daily')",
        },
      },
      handler: async (args) => {
        let weightKg = args.weight;
        if (args.weight_unit === "lb") weightKg = args.weight * 0.453592;

        const dose = weightKg * args.dose_per_kg;
        return {
          medication: args.medication,
          patient_weight_kg: Math.round(weightKg * 10) / 10,
          dose_per_kg_mg: args.dose_per_kg,
          calculated_dose_mg: Math.round(dose * 10) / 10,
          frequency: args.frequency ?? "as directed",
          note: "This is an estimate. Always verify with a pharmacist or prescriber.",
        };
      },
    },
  },
});
