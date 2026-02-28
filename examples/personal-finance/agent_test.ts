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

Deno.test("personal-finance - has correct config", () => {
  assertEquals(agent.name, "Penny");
  assertEquals(agent.voice, "jess");
  assertEquals(Object.keys(agent.tools).length, 5);
});

Deno.test("personal-finance - compound_interest basic", async () => {
  const result = (await agent.tools.compound_interest.handler(
    { principal: 10000, rate: 5, years: 10 },
    { secrets: {}, fetch: globalThis.fetch },
  )) as Record<string, unknown>;
  assertEquals(result.principal, 10000);
  assertEquals(result.annual_rate_percent, 5);
  assert((result.final_balance as number) > 16000);
  assert((result.interest_earned as number) > 6000);
});

Deno.test("personal-finance - compound_interest with monthly contributions", async () => {
  const result = (await agent.tools.compound_interest.handler(
    {
      principal: 1000,
      rate: 7,
      years: 20,
      monthly_contribution: 200,
    },
    { secrets: {}, fetch: globalThis.fetch },
  )) as Record<string, unknown>;
  assertEquals(result.total_contributed, 49000);
  assert(
    (result.final_balance as number) > (result.total_contributed as number),
  );
  assertEquals(result.monthly_contribution, 200);
});

Deno.test("personal-finance - compound_interest custom compounds_per_year", async () => {
  const result = (await agent.tools.compound_interest.handler(
    { principal: 10000, rate: 5, years: 1, compounds_per_year: 1 },
    { secrets: {}, fetch: globalThis.fetch },
  )) as Record<string, unknown>;
  // Annual compounding: 10000 * (1 + 0.05)^1 = 10500
  assertEquals(result.final_balance, 10500);
});

Deno.test("personal-finance - compound_interest zero monthly", async () => {
  const result = (await agent.tools.compound_interest.handler(
    { principal: 5000, rate: 3, years: 5, monthly_contribution: 0 },
    { secrets: {}, fetch: globalThis.fetch },
  )) as Record<string, unknown>;
  assertEquals(result.monthly_contribution, 0);
  assertEquals(result.total_contributed, 5000);
});

Deno.test("personal-finance - loan_calculator mortgage", async () => {
  const result = (await agent.tools.loan_calculator.handler(
    { principal: 300000, rate: 6.5, years: 30 },
    { secrets: {}, fetch: globalThis.fetch },
  )) as Record<string, unknown>;
  assert((result.monthly_payment as number) > 1800);
  assert((result.monthly_payment as number) < 2000);
  assert((result.total_interest as number) > 0);
  assertEquals(result.term_years, 30);
});

Deno.test("personal-finance - loan_calculator zero interest", async () => {
  const result = (await agent.tools.loan_calculator.handler(
    { principal: 12000, rate: 0, years: 1 },
    { secrets: {}, fetch: globalThis.fetch },
  )) as Record<string, unknown>;
  assertEquals(result.monthly_payment, 1000);
  assertEquals(result.total_interest, 0);
  assertEquals(result.total_paid, 12000);
});

Deno.test("personal-finance - tip_calculator defaults", async () => {
  const result = (await agent.tools.tip_calculator.handler(
    { bill: 100 },
    { secrets: {}, fetch: globalThis.fetch },
  )) as Record<string, unknown>;
  assertEquals(result.tip_amount, 18);
  assertEquals(result.total, 118);
  assertEquals(result.per_person, 118);
  assertEquals(result.tip_percent, 18);
  assertEquals(result.people, 1);
});

Deno.test("personal-finance - tip_calculator splits bill", async () => {
  const result = (await agent.tools.tip_calculator.handler(
    { bill: 200, tip_percent: 20, people: 4 },
    { secrets: {}, fetch: globalThis.fetch },
  )) as Record<string, unknown>;
  assertEquals(result.tip_amount, 40);
  assertEquals(result.total, 240);
  assertEquals(result.per_person, 60);
});

Deno.test("personal-finance - tip_calculator rounds fractional people", async () => {
  const result = (await agent.tools.tip_calculator.handler(
    { bill: 100, people: 2.7 },
    { secrets: {}, fetch: globalThis.fetch },
  )) as Record<string, unknown>;
  assertEquals(result.people, 3);
});

Deno.test("personal-finance - convert_currency success", async () => {
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

Deno.test("personal-finance - convert_currency unknown currency", async () => {
  const ctx = {
    secrets: {},
    fetch: mockFetch({ rates: { EUR: 0.92 } }),
  };
  const result = (await agent.tools.convert_currency.handler(
    { amount: 50, from: "USD", to: "XYZ" },
    ctx,
  )) as Record<string, unknown>;
  assertEquals(result.error, "Unknown currency code: XYZ");
});

Deno.test("personal-finance - convert_currency API failure", async () => {
  const ctx = { secrets: {}, fetch: mockFetchError(500, "Server Error") };
  const result = (await agent.tools.convert_currency.handler(
    { amount: 50, from: "USD", to: "EUR" },
    ctx,
  )) as Record<string, unknown>;
  assert(result.error !== undefined);
});

Deno.test("personal-finance - crypto_price defaults", async () => {
  const ctx = {
    secrets: {},
    fetch: mockFetch({
      bitcoin: {
        usd: 45000,
        usd_24h_change: 2.5,
        usd_market_cap: 900000000000,
      },
    }),
  };
  const result = (await agent.tools.crypto_price.handler(
    { coin: "bitcoin" },
    ctx,
  )) as Record<string, unknown>;
  assertEquals(result.coin, "bitcoin");
  assertEquals(result.currency, "usd");
  assertEquals(result.price, 45000);
  assertEquals(result.change_24h_percent, 2.5);
  assertEquals(result.market_cap, 900000000000);
});

Deno.test("personal-finance - crypto_price custom currency", async () => {
  const ctx = {
    secrets: {},
    fetch: mockFetch({
      ethereum: {
        eur: 2000,
        eur_24h_change: -1.2,
        eur_market_cap: 240000000000,
      },
    }),
  };
  const result = (await agent.tools.crypto_price.handler(
    { coin: "ethereum", currency: "EUR" },
    ctx,
  )) as Record<string, unknown>;
  assertEquals(result.coin, "ethereum");
  assertEquals(result.currency, "eur");
  assertEquals(result.price, 2000);
});

Deno.test("personal-finance - crypto_price unknown coin", async () => {
  const ctx = { secrets: {}, fetch: mockFetch({}) };
  const result = (await agent.tools.crypto_price.handler(
    { coin: "fakecoin" },
    ctx,
  )) as Record<string, unknown>;
  assert((result.error as string).includes("not found"));
});

Deno.test("personal-finance - crypto_price API failure", async () => {
  const ctx = { secrets: {}, fetch: mockFetchError(500, "Server Error") };
  const result = (await agent.tools.crypto_price.handler(
    { coin: "bitcoin" },
    ctx,
  )) as Record<string, unknown>;
  assert(result.error !== undefined);
});
