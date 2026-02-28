import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import agent from "../agent.ts";

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

describe("health-assistant agent", () => {
  it("has correct config", () => {
    expect(agent.config.name).toBe("Dr. Sage");
    expect(agent.config.voice).toBe("tara");
    expect(agent.tools.size).toBe(4);
    expect(agent.config.builtinTools).toEqual(["web_search"]);
  });

  describe("calculate_bmi", () => {
    const handler = agent.tools.get("calculate_bmi")!.handler;
    const ctx = { secrets: {}, fetch: globalThis.fetch };

    it("calculates normal BMI in kg/cm", async () => {
      const result = (await handler(
        { weight: 70, weight_unit: "kg", height: 175, height_unit: "cm" },
        ctx,
      )) as Record<string, unknown>;
      expect(result.category).toBe("normal");
      expect(result.bmi).toBeCloseTo(22.9, 0);
      expect(result.weight_kg).toBe(70);
      expect(result.height_m).toBe(1.75);
    });

    it("converts pounds and feet", async () => {
      const result = (await handler(
        { weight: 150, weight_unit: "lb", height: 5.5, height_unit: "ft" },
        ctx,
      )) as Record<string, unknown>;
      expect(result.weight_kg).toBeCloseTo(68, 0);
      expect(typeof result.bmi).toBe("number");
    });

    it("converts inches", async () => {
      const result = (await handler(
        { weight: 70, weight_unit: "kg", height: 69, height_unit: "in" },
        ctx,
      )) as Record<string, unknown>;
      expect(result.height_m).toBeCloseTo(1.75, 1);
      expect(result.category).toBe("normal");
    });

    it("converts meters directly", async () => {
      const result = (await handler(
        { weight: 70, weight_unit: "kg", height: 1.75, height_unit: "m" },
        ctx,
      )) as Record<string, unknown>;
      expect(result.height_m).toBe(1.75);
      expect(result.category).toBe("normal");
    });

    it("detects underweight", async () => {
      const result = (await handler(
        { weight: 45, weight_unit: "kg", height: 175, height_unit: "cm" },
        ctx,
      )) as Record<string, unknown>;
      expect(result.category).toBe("underweight");
    });

    it("detects overweight", async () => {
      const result = (await handler(
        { weight: 85, weight_unit: "kg", height: 175, height_unit: "cm" },
        ctx,
      )) as Record<string, unknown>;
      expect(result.category).toBe("overweight");
    });

    it("detects obese", async () => {
      const result = (await handler(
        { weight: 110, weight_unit: "kg", height: 175, height_unit: "cm" },
        ctx,
      )) as Record<string, unknown>;
      expect(result.category).toBe("obese");
    });
  });

  describe("dosage_by_weight", () => {
    const handler = agent.tools.get("dosage_by_weight")!.handler;
    const ctx = { secrets: {}, fetch: globalThis.fetch };

    it("calculates mg dosage from kg", async () => {
      const result = (await handler(
        {
          medication: "ibuprofen",
          weight: 30,
          weight_unit: "kg",
          dose_per_kg: 10,
        },
        ctx,
      )) as Record<string, unknown>;
      expect(result.calculated_dose_mg).toBe(300);
      expect(result.patient_weight_kg).toBe(30);
      expect(result.medication).toBe("ibuprofen");
      expect(result.frequency).toBe("as directed");
      expect(result.note).toContain("estimate");
    });

    it("converts from pounds", async () => {
      const result = (await handler(
        {
          medication: "amoxicillin",
          weight: 66,
          weight_unit: "lb",
          dose_per_kg: 25,
          frequency: "every 8 hours",
        },
        ctx,
      )) as Record<string, unknown>;
      expect(result.patient_weight_kg).toBeCloseTo(30, 0);
      expect(result.frequency).toBe("every 8 hours");
    });
  });

  describe("drug_info", () => {
    const handler = agent.tools.get("drug_info")!.handler;

    it("returns drug information", async () => {
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

      const result = (await handler(
        { name: "ibuprofen" },
        ctx,
      )) as Record<string, unknown>;

      expect(result.name).toBe("ibuprofen");
      expect(result.brand_names).toEqual(["Advil", "Motrin"]);
      expect(result.manufacturer).toBe("Pfizer");
      expect(result.purpose).toBe("Pain reliever/fever reducer");
    });

    it("returns error when drug not found (API error)", async () => {
      const ctx = {
        secrets: {},
        fetch: mockFetchError(404, "Not Found"),
      };

      const result = (await handler(
        { name: "nonexistentdrug" },
        ctx,
      )) as Record<string, unknown>;

      expect(result.error).toContain("not found");
    });

    it("returns error when results array is empty", async () => {
      const ctx = {
        secrets: {},
        fetch: mockFetch({ results: [] }),
      };

      const result = (await handler(
        { name: "unknowndrug" },
        ctx,
      )) as Record<string, unknown>;

      expect(result.error).toContain("No FDA data found");
    });

    it("handles missing openfda fields gracefully", async () => {
      const ctx = {
        secrets: {},
        fetch: mockFetch({
          results: [
            {
              indications_and_usage: ["For headaches"],
            },
          ],
        }),
      };

      const result = (await handler(
        { name: "aspirin" },
        ctx,
      )) as Record<string, unknown>;

      expect(result.name).toBe("aspirin"); // falls back to input name
      expect(result.purpose).toBe("For headaches");
      expect(result.manufacturer).toBe("N/A");
    });
  });

  describe("check_interaction", () => {
    const handler = agent.tools.get("check_interaction")!.handler;

    it("checks interactions between two drugs", async () => {
      let callCount = 0;
      const mockCtxFetch = ((_url: string | URL | Request) => {
        callCount++;
        const url = typeof _url === "string" ? _url : _url.toString();
        if (url.includes("rxcui.json")) {
          // RxCUI lookup
          const name = url.includes("ibuprofen") ? "ibuprofen" : "warfarin";
          const rxcui = name === "ibuprofen" ? "5640" : "11289";
          return Promise.resolve(
            new Response(
              JSON.stringify({
                idGroup: { rxnormId: [rxcui] },
              }),
            ),
          );
        }
        // Interaction lookup
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

      const result = (await handler(
        { drugs: "ibuprofen, warfarin" },
        { secrets: {}, fetch: mockCtxFetch },
      )) as Record<string, unknown>;

      expect(result.interactions_found).toBe(1);
      const interactions = result.interactions as Record<string, unknown>[];
      expect(interactions[0].description).toBe("Increased bleeding risk");
    });

    it("returns error when drugs cannot be resolved", async () => {
      const ctx = {
        secrets: {},
        fetch: mockFetchError(404, "Not Found"),
      };

      const result = (await handler(
        { drugs: "fakemed1, fakemed2" },
        ctx,
      )) as Record<string, unknown>;

      expect(result.error).toContain("Could not resolve");
    });

    it("returns error when only one drug resolves", async () => {
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
        // Second drug fails
        return Promise.resolve(
          new Response(
            JSON.stringify({ idGroup: {} }),
          ),
        );
      }) as unknown as typeof globalThis.fetch;

      const result = (await handler(
        { drugs: "ibuprofen, unknowndrug" },
        { secrets: {}, fetch: mockCtxFetch },
      )) as Record<string, unknown>;

      expect(result.error).toContain("Could not resolve");
    });

    it("handles no interactions found", async () => {
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

      const result = (await handler(
        { drugs: "drug1, drug2" },
        { secrets: {}, fetch: mockCtxFetch },
      )) as Record<string, unknown>;

      expect(result.interactions_found).toBe(0);
    });

    it("returns error when interaction lookup fails", async () => {
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

      const result = (await handler(
        { drugs: "drug1, drug2" },
        { secrets: {}, fetch: mockCtxFetch },
      )) as Record<string, unknown>;

      expect(result.error).toBe("Interaction lookup failed");
    });
  });
});
