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

describe("travel-concierge agent", () => {
  it("has correct config", () => {
    expect(agent.config.name).toBe("Aria");
    expect(agent.config.voice).toBe("tara");
    expect(agent.tools.size).toBe(2);
    expect(agent.config.builtinTools).toEqual([
      "web_search",
      "visit_webpage",
    ]);
  });

  it("has get_weather_forecast tool", () => {
    expect(agent.tools.has("get_weather_forecast")).toBe(true);
  });

  it("has convert_currency tool", () => {
    expect(agent.tools.has("convert_currency")).toBe(true);
  });

  describe("get_weather_forecast", () => {
    const handler = agent.tools.get("get_weather_forecast")!.handler;

    it("returns forecast for a valid city", async () => {
      let _callCount = 0;
      const mockCtxFetch = (() => {
        _callCount++;
        if (_callCount === 1) {
          // Geocoding response
          return Promise.resolve(
            new Response(
              JSON.stringify({
                results: [
                  {
                    latitude: 48.8566,
                    longitude: 2.3522,
                    name: "Paris",
                    country: "France",
                  },
                ],
              }),
            ),
          );
        }
        // Weather response
        return Promise.resolve(
          new Response(
            JSON.stringify({
              daily: {
                time: ["2024-01-01", "2024-01-02"],
                temperature_2m_max: [10, 12],
                temperature_2m_min: [2, 4],
                precipitation_sum: [0, 5],
                weathercode: [0, 61],
              },
            }),
          ),
        );
      }) as unknown as typeof globalThis.fetch;

      const result = (await handler(
        { city: "Paris" },
        { secrets: {}, fetch: mockCtxFetch },
      )) as Record<string, unknown>;

      expect(result.city).toBe("Paris");
      expect(result.country).toBe("France");
      const forecast = result.forecast as Record<string, unknown>[];
      expect(forecast).toHaveLength(2);
      expect(forecast[0].date).toBe("2024-01-01");
      expect(forecast[0].high_c).toBe(10);
      expect(forecast[0].low_c).toBe(2);
      expect(forecast[0].condition).toBe("Clear sky");
      expect(forecast[1].condition).toBe("Slight rain");
      // Check F conversion
      expect(forecast[0].high_f).toBe(50); // 10*9/5+32 = 50
    });

    it("returns error when city not found", async () => {
      const ctx = {
        secrets: {},
        fetch: mockFetch({ results: [] }),
      };

      const result = (await handler(
        { city: "Nonexistentville" },
        ctx,
      )) as Record<string, unknown>;

      expect(result.error).toBe("City not found: Nonexistentville");
    });

    it("returns error when geocoding API fails", async () => {
      const ctx = {
        secrets: {},
        fetch: mockFetchError(500, "Server Error"),
      };

      const result = (await handler(
        { city: "Paris" },
        ctx,
      )) as Record<string, unknown>;

      expect(result.error).toBeDefined();
    });

    it("returns error when weather API fails", async () => {
      let _callCount = 0;
      const mockCtxFetch = (() => {
        _callCount++;
        if (_callCount === 1) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                results: [
                  {
                    latitude: 48.8,
                    longitude: 2.3,
                    name: "Paris",
                    country: "France",
                  },
                ],
              }),
            ),
          );
        }
        return Promise.resolve(new Response("Server Error", { status: 500 }));
      }) as unknown as typeof globalThis.fetch;

      const result = (await handler(
        { city: "Paris" },
        { secrets: {}, fetch: mockCtxFetch },
      )) as Record<string, unknown>;

      expect(result.error).toBeDefined();
    });

    it("handles unknown weather codes", async () => {
      let _callCount = 0;
      const mockCtxFetch = (() => {
        _callCount++;
        if (_callCount === 1) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                results: [
                  {
                    latitude: 48.8,
                    longitude: 2.3,
                    name: "Paris",
                    country: "France",
                  },
                ],
              }),
            ),
          );
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              daily: {
                time: ["2024-01-01"],
                temperature_2m_max: [10],
                temperature_2m_min: [2],
                precipitation_sum: [0],
                weathercode: [999],
              },
            }),
          ),
        );
      }) as unknown as typeof globalThis.fetch;

      const result = (await handler(
        { city: "Paris" },
        { secrets: {}, fetch: mockCtxFetch },
      )) as Record<string, unknown>;

      const forecast = result.forecast as Record<string, unknown>[];
      expect(forecast[0].condition).toBe("Unknown");
    });
  });

  describe("convert_currency", () => {
    const handler = agent.tools.get("convert_currency")!.handler;

    it("converts currency successfully", async () => {
      const ctx = {
        secrets: {},
        fetch: mockFetch({
          rates: { EUR: 0.92, GBP: 0.79 },
        }),
      };

      const result = (await handler(
        { amount: 100, from: "usd", to: "eur" },
        ctx,
      )) as Record<string, unknown>;

      expect(result.amount).toBe(100);
      expect(result.from).toBe("USD");
      expect(result.to).toBe("EUR");
      expect(result.rate).toBe(0.92);
      expect(result.result).toBe(92);
    });

    it("returns error for unknown target currency", async () => {
      const ctx = {
        secrets: {},
        fetch: mockFetch({ rates: { EUR: 0.92 } }),
      };

      const result = (await handler(
        { amount: 100, from: "USD", to: "XYZ" },
        ctx,
      )) as Record<string, unknown>;

      expect(result.error).toBe("Unknown currency code: XYZ");
    });

    it("returns error when API fails", async () => {
      const ctx = {
        secrets: {},
        fetch: mockFetchError(500, "Server Error"),
      };

      const result = (await handler(
        { amount: 100, from: "USD", to: "EUR" },
        ctx,
      )) as Record<string, unknown>;

      expect(result.error).toBeDefined();
    });
  });
});
