import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import agent from "./agent.ts";

/** Create a mock ctx.fetch that returns the given data as JSON. */
function mockFetch(data: unknown): typeof globalThis.fetch {
  return (() =>
    Promise.resolve(
      new Response(JSON.stringify(data), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    )) as unknown as typeof globalThis.fetch;
}

/** Create a mock ctx.fetch that returns an HTTP error. */
function mockFetchError(status: number, body: string): typeof globalThis.fetch {
  return (() =>
    Promise.resolve(
      new Response(body, { status }),
    )) as unknown as typeof globalThis.fetch;
}

Deno.test("health-assistant - has correct config", () => {
  assertEquals(agent.name, "Dr. Sage");
  assertEquals(agent.voice, "tara");
  assertEquals(Object.keys(agent.tools).length, 4);
  assertEquals(agent.builtinTools, ["web_search"]);
});

Deno.test("health-assistant - calculate_bmi normal in kg/cm", async () => {
  const result = (await agent.tools.calculate_bmi.handler(
    { weight: 70, weight_unit: "kg", height: 175, height_unit: "cm" },
    { secrets: {}, fetch: globalThis.fetch },
  )) as Record<string, unknown>;
  assertEquals(result.category, "normal");
  assertAlmostEquals(result.bmi as number, 22.9, 0.5);
  assertEquals(result.weight_kg, 70);
  assertEquals(result.height_m, 1.75);
});

Deno.test("health-assistant - calculate_bmi converts pounds and feet", async () => {
  const result = (await agent.tools.calculate_bmi.handler(
    { weight: 150, weight_unit: "lb", height: 5.5, height_unit: "ft" },
    { secrets: {}, fetch: globalThis.fetch },
  )) as Record<string, unknown>;
  assertAlmostEquals(result.weight_kg as number, 68, 1);
  assertEquals(typeof result.bmi, "number");
});

Deno.test("health-assistant - calculate_bmi converts inches", async () => {
  const result = (await agent.tools.calculate_bmi.handler(
    { weight: 70, weight_unit: "kg", height: 69, height_unit: "in" },
    { secrets: {}, fetch: globalThis.fetch },
  )) as Record<string, unknown>;
  assertAlmostEquals(result.height_m as number, 1.75, 0.02);
  assertEquals(result.category, "normal");
});

Deno.test("health-assistant - calculate_bmi meters directly", async () => {
  const result = (await agent.tools.calculate_bmi.handler(
    { weight: 70, weight_unit: "kg", height: 1.75, height_unit: "m" },
    { secrets: {}, fetch: globalThis.fetch },
  )) as Record<string, unknown>;
  assertEquals(result.height_m, 1.75);
  assertEquals(result.category, "normal");
});

Deno.test("health-assistant - calculate_bmi detects underweight", async () => {
  const result = (await agent.tools.calculate_bmi.handler(
    { weight: 45, weight_unit: "kg", height: 175, height_unit: "cm" },
    { secrets: {}, fetch: globalThis.fetch },
  )) as Record<string, unknown>;
  assertEquals(result.category, "underweight");
});

Deno.test("health-assistant - calculate_bmi detects overweight", async () => {
  const result = (await agent.tools.calculate_bmi.handler(
    { weight: 85, weight_unit: "kg", height: 175, height_unit: "cm" },
    { secrets: {}, fetch: globalThis.fetch },
  )) as Record<string, unknown>;
  assertEquals(result.category, "overweight");
});

Deno.test("health-assistant - calculate_bmi detects obese", async () => {
  const result = (await agent.tools.calculate_bmi.handler(
    { weight: 110, weight_unit: "kg", height: 175, height_unit: "cm" },
    { secrets: {}, fetch: globalThis.fetch },
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
    { secrets: {}, fetch: globalThis.fetch },
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
    { secrets: {}, fetch: globalThis.fetch },
  )) as Record<string, unknown>;
  assertAlmostEquals(result.patient_weight_kg as number, 30, 1);
  assertEquals(result.frequency, "every 8 hours");
});

Deno.test("health-assistant - drug_info returns information", async () => {
  const ctx = {
    secrets: {},
    fetch: mockFetch({
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
    }),
  };

  const result = (await agent.tools.drug_info.handler(
    { name: "ibuprofen" },
    ctx,
  )) as Record<string, unknown>;

  assertEquals(result.name, "ibuprofen");
  assertEquals(result.brand_names, ["Advil", "Motrin"]);
  assertEquals(result.manufacturer, "Pfizer");
  assertEquals(result.purpose, "Pain reliever/fever reducer");
});

Deno.test("health-assistant - drug_info error on API failure", async () => {
  const ctx = { secrets: {}, fetch: mockFetchError(404, "Not Found") };
  const result = (await agent.tools.drug_info.handler(
    { name: "nonexistentdrug" },
    ctx,
  )) as Record<string, unknown>;
  assert((result.error as string).includes("not found"));
});

Deno.test("health-assistant - drug_info error on empty results", async () => {
  const ctx = { secrets: {}, fetch: mockFetch({ results: [] }) };
  const result = (await agent.tools.drug_info.handler(
    { name: "unknowndrug" },
    ctx,
  )) as Record<string, unknown>;
  assert((result.error as string).includes("No FDA data found"));
});

Deno.test("health-assistant - drug_info handles missing openfda", async () => {
  const ctx = {
    secrets: {},
    fetch: mockFetch({
      results: [{ indications_and_usage: ["For headaches"] }],
    }),
  };
  const result = (await agent.tools.drug_info.handler(
    { name: "aspirin" },
    ctx,
  )) as Record<string, unknown>;
  assertEquals(result.name, "aspirin");
  assertEquals(result.purpose, "For headaches");
  assertEquals(result.manufacturer, "N/A");
});

Deno.test("health-assistant - check_interaction between two drugs", async () => {
  let callCount = 0;
  const mockCtxFetch = ((_url: string | URL | Request) => {
    callCount++;
    const url = typeof _url === "string" ? _url : _url.toString();
    if (url.includes("rxcui.json")) {
      const name = url.includes("ibuprofen") ? "ibuprofen" : "warfarin";
      const rxcui = name === "ibuprofen" ? "5640" : "11289";
      return Promise.resolve(
        new Response(
          JSON.stringify({ idGroup: { rxnormId: [rxcui] } }),
        ),
      );
    }
    return Promise.resolve(
      new Response(
        JSON.stringify({
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
      ),
    );
  }) as unknown as typeof globalThis.fetch;

  const result = (await agent.tools.check_interaction.handler(
    { drugs: "ibuprofen, warfarin" },
    { secrets: {}, fetch: mockCtxFetch },
  )) as Record<string, unknown>;

  assertEquals(result.interactions_found, 1);
  const interactions = result.interactions as Record<string, unknown>[];
  assertEquals(interactions[0].description, "Increased bleeding risk");
  void callCount; // suppress unused warning
});

Deno.test("health-assistant - check_interaction error unresolved drugs", async () => {
  const ctx = { secrets: {}, fetch: mockFetchError(404, "Not Found") };
  const result = (await agent.tools.check_interaction.handler(
    { drugs: "fakemed1, fakemed2" },
    ctx,
  )) as Record<string, unknown>;
  assert((result.error as string).includes("Could not resolve"));
});

Deno.test("health-assistant - check_interaction error one drug resolves", async () => {
  let _callCount = 0;
  const mockCtxFetch = (() => {
    _callCount++;
    if (_callCount === 1) {
      return Promise.resolve(
        new Response(
          JSON.stringify({ idGroup: { rxnormId: ["5640"] } }),
        ),
      );
    }
    return Promise.resolve(
      new Response(JSON.stringify({ idGroup: {} })),
    );
  }) as unknown as typeof globalThis.fetch;

  const result = (await agent.tools.check_interaction.handler(
    { drugs: "ibuprofen, unknowndrug" },
    { secrets: {}, fetch: mockCtxFetch },
  )) as Record<string, unknown>;
  assert((result.error as string).includes("Could not resolve"));
});

Deno.test("health-assistant - check_interaction no interactions found", async () => {
  let _callCount = 0;
  const mockCtxFetch = (() => {
    _callCount++;
    if (_callCount <= 2) {
      const rxcui = _callCount === 1 ? "123" : "456";
      return Promise.resolve(
        new Response(
          JSON.stringify({ idGroup: { rxnormId: [rxcui] } }),
        ),
      );
    }
    return Promise.resolve(new Response(JSON.stringify({})));
  }) as unknown as typeof globalThis.fetch;

  const result = (await agent.tools.check_interaction.handler(
    { drugs: "drug1, drug2" },
    { secrets: {}, fetch: mockCtxFetch },
  )) as Record<string, unknown>;
  assertEquals(result.interactions_found, 0);
});

Deno.test("health-assistant - check_interaction lookup fails", async () => {
  let _callCount = 0;
  const mockCtxFetch = (() => {
    _callCount++;
    if (_callCount <= 2) {
      const rxcui = _callCount === 1 ? "123" : "456";
      return Promise.resolve(
        new Response(
          JSON.stringify({ idGroup: { rxnormId: [rxcui] } }),
        ),
      );
    }
    return Promise.resolve(new Response("Server Error", { status: 500 }));
  }) as unknown as typeof globalThis.fetch;

  const result = (await agent.tools.check_interaction.handler(
    { drugs: "drug1, drug2" },
    { secrets: {}, fetch: mockCtxFetch },
  )) as Record<string, unknown>;
  assertEquals(result.error, "Interaction lookup failed");
});
