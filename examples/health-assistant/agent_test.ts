import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import {
  stubFetchError,
  stubFetchJson,
  testCtx,
} from "../../server/_tool_test_utils.ts";
import agent from "./agent.ts";

const ctx = testCtx();

Deno.test("health-assistant - has correct config", () => {
  assertEquals(agent.name, "Dr. Sage");
  assertEquals(agent.voice, "tara");
  assertEquals(Object.keys(agent.tools).length, 4);
  assertEquals(agent.builtinTools, ["web_search"]);
});

Deno.test("health-assistant - calculate_bmi normal in kg/cm", async () => {
  const result = (await agent.tools.calculate_bmi.handler(
    { weight: 70, weight_unit: "kg", height: 175, height_unit: "cm" },
    ctx,
  )) as Record<string, unknown>;
  assertEquals(result.category, "normal");
  assertAlmostEquals(result.bmi as number, 22.9, 0.5);
  assertEquals(result.weight_kg, 70);
  assertEquals(result.height_m, 1.75);
});

Deno.test("health-assistant - calculate_bmi converts pounds and feet", async () => {
  const result = (await agent.tools.calculate_bmi.handler(
    { weight: 150, weight_unit: "lb", height: 5.5, height_unit: "ft" },
    ctx,
  )) as Record<string, unknown>;
  assertAlmostEquals(result.weight_kg as number, 68, 1);
  assertEquals(typeof result.bmi, "number");
});

Deno.test("health-assistant - calculate_bmi converts inches", async () => {
  const result = (await agent.tools.calculate_bmi.handler(
    { weight: 70, weight_unit: "kg", height: 69, height_unit: "in" },
    ctx,
  )) as Record<string, unknown>;
  assertAlmostEquals(result.height_m as number, 1.75, 0.02);
  assertEquals(result.category, "normal");
});

Deno.test("health-assistant - calculate_bmi meters directly", async () => {
  const result = (await agent.tools.calculate_bmi.handler(
    { weight: 70, weight_unit: "kg", height: 1.75, height_unit: "m" },
    ctx,
  )) as Record<string, unknown>;
  assertEquals(result.height_m, 1.75);
  assertEquals(result.category, "normal");
});

Deno.test("health-assistant - calculate_bmi detects underweight", async () => {
  const result = (await agent.tools.calculate_bmi.handler(
    { weight: 45, weight_unit: "kg", height: 175, height_unit: "cm" },
    ctx,
  )) as Record<string, unknown>;
  assertEquals(result.category, "underweight");
});

Deno.test("health-assistant - calculate_bmi detects overweight", async () => {
  const result = (await agent.tools.calculate_bmi.handler(
    { weight: 85, weight_unit: "kg", height: 175, height_unit: "cm" },
    ctx,
  )) as Record<string, unknown>;
  assertEquals(result.category, "overweight");
});

Deno.test("health-assistant - calculate_bmi detects obese", async () => {
  const result = (await agent.tools.calculate_bmi.handler(
    { weight: 110, weight_unit: "kg", height: 175, height_unit: "cm" },
    ctx,
  )) as Record<string, unknown>;
  assertEquals(result.category, "obese");
});

Deno.test("health-assistant - dosage_by_weight in kg", async () => {
  const result = (await agent.tools.dosage_by_weight.handler(
    {
      medication: "ibuprofen",
      weight: 30,
      weight_unit: "kg",
      dose_per_kg: 10,
    },
    ctx,
  )) as Record<string, unknown>;
  assertEquals(result.calculated_dose_mg, 300);
  assertEquals(result.patient_weight_kg, 30);
  assertEquals(result.medication, "ibuprofen");
  assertEquals(result.frequency, "as directed");
  assert((result.note as string).includes("estimate"));
});

Deno.test("health-assistant - dosage_by_weight converts pounds", async () => {
  const result = (await agent.tools.dosage_by_weight.handler(
    {
      medication: "amoxicillin",
      weight: 66,
      weight_unit: "lb",
      dose_per_kg: 25,
      frequency: "every 8 hours",
    },
    ctx,
  )) as Record<string, unknown>;
  assertAlmostEquals(result.patient_weight_kg as number, 30, 1);
  assertEquals(result.frequency, "every 8 hours");
});

Deno.test("health-assistant - drug_info returns information", async () => {
  const result = (await agent.tools.drug_info.handler(
    { name: "ibuprofen" },
    testCtx(stubFetchJson({
      results: [
        {
          openfda: {
            generic_name: ["ibuprofen"],
            brand_name: ["Advil", "Motrin"],
            manufacturer_name: ["Pfizer"],
          },
          purpose: ["Pain reliever/fever reducer"],
          warnings: ["Stomach bleeding warning text"],
          dosage_and_administration: ["Adults: 200-400mg every 4-6 hours"],
          adverse_reactions: ["Nausea, stomach pain"],
        },
      ],
    })),
  )) as Record<string, unknown>;

  assertEquals(result.name, "ibuprofen");
  assertEquals(result.brand_names, ["Advil", "Motrin"]);
  assertEquals(result.manufacturer, "Pfizer");
  assertEquals(result.purpose, "Pain reliever/fever reducer");
});

Deno.test("health-assistant - drug_info error on API failure", async () => {
  const result = (await agent.tools.drug_info.handler(
    { name: "nonexistentdrug" },
    testCtx(stubFetchError(404, "Not Found")),
  )) as Record<string, unknown>;
  assert((result.error as string).includes("not found"));
});

Deno.test("health-assistant - drug_info error on empty results", async () => {
  const result = (await agent.tools.drug_info.handler(
    { name: "unknowndrug" },
    testCtx(stubFetchJson({ results: [] })),
  )) as Record<string, unknown>;
  assert((result.error as string).includes("No FDA data found"));
});

Deno.test("health-assistant - drug_info handles missing openfda", async () => {
  const result = (await agent.tools.drug_info.handler(
    { name: "aspirin" },
    testCtx(stubFetchJson({
      results: [{ indications_and_usage: ["For headaches"] }],
    })),
  )) as Record<string, unknown>;
  assertEquals(result.name, "aspirin");
  assertEquals(result.purpose, "For headaches");
  assertEquals(result.manufacturer, "N/A");
});

Deno.test("health-assistant - check_interaction between two drugs", async () => {
  const fetch = ((input: string | URL) => {
    const url = String(input);
    if (url.includes("rxcui.json")) {
      const name = url.includes("ibuprofen") ? "ibuprofen" : "warfarin";
      const rxcui = name === "ibuprofen" ? "5640" : "11289";
      return Promise.resolve(
        Response.json({ idGroup: { rxnormId: [rxcui] } }),
      );
    }
    return Promise.resolve(
      Response.json({
        fullInteractionTypeGroup: [
          {
            fullInteractionType: [
              {
                interactionPair: [
                  {
                    description: "Increased bleeding risk",
                    severity: "high",
                  },
                ],
              },
            ],
          },
        ],
      }),
    );
  }) as typeof globalThis.fetch;

  const result = (await agent.tools.check_interaction.handler(
    { drugs: "ibuprofen, warfarin" },
    testCtx(fetch),
  )) as Record<string, unknown>;

  assertEquals(result.interactions_found, 1);
  const interactions = result.interactions as Record<string, unknown>[];
  assertEquals(interactions[0].description, "Increased bleeding risk");
});

Deno.test("health-assistant - check_interaction error unresolved drugs", async () => {
  const result = (await agent.tools.check_interaction.handler(
    { drugs: "fakemed1, fakemed2" },
    testCtx(stubFetchError(404, "Not Found")),
  )) as Record<string, unknown>;
  assert((result.error as string).includes("Could not resolve"));
});

Deno.test("health-assistant - check_interaction error one drug resolves", async () => {
  let callCount = 0;
  const fetch = (() => {
    callCount++;
    if (callCount === 1) {
      return Promise.resolve(
        Response.json({ idGroup: { rxnormId: ["5640"] } }),
      );
    }
    return Promise.resolve(Response.json({ idGroup: {} }));
  }) as typeof globalThis.fetch;

  const result = (await agent.tools.check_interaction.handler(
    { drugs: "ibuprofen, unknowndrug" },
    testCtx(fetch),
  )) as Record<string, unknown>;
  assert((result.error as string).includes("Could not resolve"));
});

Deno.test("health-assistant - check_interaction no interactions found", async () => {
  let callCount = 0;
  const fetch = (() => {
    callCount++;
    if (callCount <= 2) {
      const rxcui = callCount === 1 ? "123" : "456";
      return Promise.resolve(
        Response.json({ idGroup: { rxnormId: [rxcui] } }),
      );
    }
    return Promise.resolve(Response.json({}));
  }) as typeof globalThis.fetch;

  const result = (await agent.tools.check_interaction.handler(
    { drugs: "drug1, drug2" },
    testCtx(fetch),
  )) as Record<string, unknown>;
  assertEquals(result.interactions_found, 0);
});

Deno.test("health-assistant - check_interaction lookup fails", async () => {
  let callCount = 0;
  const fetch = (() => {
    callCount++;
    if (callCount <= 2) {
      const rxcui = callCount === 1 ? "123" : "456";
      return Promise.resolve(
        Response.json({ idGroup: { rxnormId: [rxcui] } }),
      );
    }
    return Promise.resolve(new Response("Server Error", { status: 500 }));
  }) as typeof globalThis.fetch;

  const result = (await agent.tools.check_interaction.handler(
    { drugs: "drug1, drug2" },
    testCtx(fetch),
  )) as Record<string, unknown>;
  assertEquals(result.error, "Interaction lookup failed");
});
