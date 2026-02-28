import { assert, assertEquals } from "@std/assert";
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

Deno.test("travel-concierge - has correct config", () => {
  assertEquals(agent.name, "Aria");
  assertEquals(agent.voice, "tara");
  assertEquals(Object.keys(agent.tools).length, 2);
  assertEquals(agent.builtinTools, ["web_search", "visit_webpage"]);
});

Deno.test("travel-concierge - has get_weather_forecast tool", () => {
  assert("get_weather_forecast" in agent.tools);
});

Deno.test("travel-concierge - has convert_currency tool", () => {
  assert("convert_currency" in agent.tools);
});

Deno.test("travel-concierge - weather forecast for valid city", async () => {
  let _callCount = 0;
  const mockCtxFetch = (() => {
    _callCount++;
    if (_callCount === 1) {
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

  const result = (await agent.tools.get_weather_forecast.handler(
    { city: "Paris" },
    { secrets: {}, fetch: mockCtxFetch },
  )) as Record<string, unknown>;

  assertEquals(result.city, "Paris");
  assertEquals(result.country, "France");
  const forecast = result.forecast as Record<string, unknown>[];
  assertEquals(forecast.length, 2);
  assertEquals(forecast[0].date, "2024-01-01");
  assertEquals(forecast[0].high_c, 10);
  assertEquals(forecast[0].low_c, 2);
  assertEquals(forecast[0].condition, "Clear sky");
  assertEquals(forecast[1].condition, "Slight rain");
  assertEquals(forecast[0].high_f, 50); // 10*9/5+32 = 50
});

Deno.test("travel-concierge - weather city not found", async () => {
  const ctx = { secrets: {}, fetch: mockFetch({ results: [] }) };
  const result = (await agent.tools.get_weather_forecast.handler(
    { city: "Nonexistentville" },
    ctx,
  )) as Record<string, unknown>;
  assertEquals(result.error, "City not found: Nonexistentville");
});

Deno.test("travel-concierge - weather geocoding API fails", async () => {
  const ctx = { secrets: {}, fetch: mockFetchError(500, "Server Error") };
  const result = (await agent.tools.get_weather_forecast.handler(
    { city: "Paris" },
    ctx,
  )) as Record<string, unknown>;
  assert(result.error !== undefined);
});

Deno.test("travel-concierge - weather API fails", async () => {
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

  const result = (await agent.tools.get_weather_forecast.handler(
    { city: "Paris" },
    { secrets: {}, fetch: mockCtxFetch },
  )) as Record<string, unknown>;
  assert(result.error !== undefined);
});

Deno.test("travel-concierge - unknown weather codes", async () => {
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

  const result = (await agent.tools.get_weather_forecast.handler(
    { city: "Paris" },
    { secrets: {}, fetch: mockCtxFetch },
  )) as Record<string, unknown>;
  const forecast = result.forecast as Record<string, unknown>[];
  assertEquals(forecast[0].condition, "Unknown");
});

Deno.test("travel-concierge - convert_currency success", async () => {
  const ctx = {
    secrets: {},
    fetch: mockFetch({ rates: { EUR: 0.92, GBP: 0.79 } }),
  };
  const result = (await agent.tools.convert_currency.handler(
    { amount: 100, from: "usd", to: "eur" },
    ctx,
  )) as Record<string, unknown>;
  assertEquals(result.amount, 100);
  assertEquals(result.from, "USD");
  assertEquals(result.to, "EUR");
  assertEquals(result.rate, 0.92);
  assertEquals(result.result, 92);
});

Deno.test("travel-concierge - convert_currency unknown target", async () => {
  const ctx = {
    secrets: {},
    fetch: mockFetch({ rates: { EUR: 0.92 } }),
  };
  const result = (await agent.tools.convert_currency.handler(
    { amount: 100, from: "USD", to: "XYZ" },
    ctx,
  )) as Record<string, unknown>;
  assertEquals(result.error, "Unknown currency code: XYZ");
});

Deno.test("travel-concierge - convert_currency API failure", async () => {
  const ctx = { secrets: {}, fetch: mockFetchError(500, "Server Error") };
  const result = (await agent.tools.convert_currency.handler(
    { amount: 100, from: "USD", to: "EUR" },
    ctx,
  )) as Record<string, unknown>;
  assert(result.error !== undefined);
});
