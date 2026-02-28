import { assert, assertEquals, assertRejects } from "@std/assert";
import {
  stubFetchError,
  stubFetchJson,
  testCtx,
} from "../../server/_tool_test_utils.ts";
import agent from "./agent.ts";

const ctx = testCtx();

Deno.test("personal-finance - has correct config", () => {
  assertEquals(agent.name, "Penny");
  assertEquals(agent.voice, "jess");
  assertEquals(Object.keys(agent.tools).length, 5);
});

// ── compound_interest ────────────────────────────────────────────

Deno.test("compound_interest - basic", async () => {
  const result = (await agent.tools.compound_interest.handler(
    { principal: 10000, rate: 5, years: 10 },
    ctx,
  )) as Record<string, unknown>;
  assertEquals(result.principal, 10000);
  assertEquals(result.annual_rate_percent, 5);
  assert((result.final_balance as number) > 16000);
  assert((result.interest_earned as number) > 6000);
});

Deno.test("compound_interest - with monthly contributions", async () => {
  const result = (await agent.tools.compound_interest.handler(
    { principal: 1000, rate: 7, years: 20, monthly_contribution: 200 },
    ctx,
  )) as Record<string, unknown>;
  assertEquals(result.total_contributed, 49000);
  assert(
    (result.final_balance as number) > (result.total_contributed as number),
  );
  assertEquals(result.monthly_contribution, 200);
});

Deno.test("compound_interest - custom compounds_per_year", async () => {
  const result = (await agent.tools.compound_interest.handler(
    { principal: 10000, rate: 5, years: 1, compounds_per_year: 1 },
    ctx,
  )) as Record<string, unknown>;
  assertEquals(result.final_balance, 10500);
});

Deno.test("compound_interest - zero monthly", async () => {
  const result = (await agent.tools.compound_interest.handler(
    { principal: 5000, rate: 3, years: 5, monthly_contribution: 0 },
    ctx,
  )) as Record<string, unknown>;
  assertEquals(result.monthly_contribution, 0);
  assertEquals(result.total_contributed, 5000);
});

// ── loan_calculator ──────────────────────────────────────────────

Deno.test("loan_calculator - mortgage", async () => {
  const result = (await agent.tools.loan_calculator.handler(
    { principal: 300000, rate: 6.5, years: 30 },
    ctx,
  )) as Record<string, unknown>;
  assert((result.monthly_payment as number) > 1800);
  assert((result.monthly_payment as number) < 2000);
  assert((result.total_interest as number) > 0);
  assertEquals(result.term_years, 30);
});

Deno.test("loan_calculator - zero interest", async () => {
  const result = (await agent.tools.loan_calculator.handler(
    { principal: 12000, rate: 0, years: 1 },
    ctx,
  )) as Record<string, unknown>;
  assertEquals(result.monthly_payment, 1000);
  assertEquals(result.total_interest, 0);
  assertEquals(result.total_paid, 12000);
});

// ── tip_calculator ───────────────────────────────────────────────

Deno.test("tip_calculator - defaults", async () => {
  const result = (await agent.tools.tip_calculator.handler(
    { bill: 100 },
    ctx,
  )) as Record<string, unknown>;
  assertEquals(result.tip_amount, 18);
  assertEquals(result.total, 118);
  assertEquals(result.per_person, 118);
  assertEquals(result.tip_percent, 18);
  assertEquals(result.people, 1);
});

Deno.test("tip_calculator - splits bill", async () => {
  const result = (await agent.tools.tip_calculator.handler(
    { bill: 200, tip_percent: 20, people: 4 },
    ctx,
  )) as Record<string, unknown>;
  assertEquals(result.tip_amount, 40);
  assertEquals(result.total, 240);
  assertEquals(result.per_person, 60);
});

Deno.test("tip_calculator - rounds fractional people", async () => {
  const result = (await agent.tools.tip_calculator.handler(
    { bill: 100, people: 2.7 },
    ctx,
  )) as Record<string, unknown>;
  assertEquals(result.people, 3);
});

// ── convert_currency ─────────────────────────────────────────────

Deno.test("convert_currency - success", async () => {
  const result = (await agent.tools.convert_currency.handler(
    { amount: 100, from: "usd", to: "eur" },
    testCtx(stubFetchJson({ rates: { EUR: 0.92, GBP: 0.79 } })),
  )) as Record<string, unknown>;
  assertEquals(result.amount, 100);
  assertEquals(result.from, "USD");
  assertEquals(result.to, "EUR");
  assertEquals(result.rate, 0.92);
  assertEquals(result.result, 92);
});

Deno.test("convert_currency - unknown currency", async () => {
  const result = (await agent.tools.convert_currency.handler(
    { amount: 50, from: "USD", to: "XYZ" },
    testCtx(stubFetchJson({ rates: { EUR: 0.92 } })),
  )) as Record<string, unknown>;
  assertEquals(result.error, "Unknown currency code: XYZ");
});

Deno.test("convert_currency - API failure throws", async () => {
  await assertRejects(async () => {
    await agent.tools.convert_currency.handler(
      { amount: 50, from: "USD", to: "EUR" },
      testCtx(stubFetchError(500, "Server Error")),
    );
  });
});

// ── crypto_price ─────────────────────────────────────────────────

Deno.test("crypto_price - defaults", async () => {
  const result = (await agent.tools.crypto_price.handler(
    { coin: "bitcoin" },
    testCtx(stubFetchJson({
      bitcoin: {
        usd: 45000,
        usd_24h_change: 2.5,
        usd_market_cap: 900000000000,
      },
    })),
  )) as Record<string, unknown>;
  assertEquals(result.coin, "bitcoin");
  assertEquals(result.currency, "usd");
  assertEquals(result.price, 45000);
  assertEquals(result.change_24h_percent, 2.5);
  assertEquals(result.market_cap, 900000000000);
});

Deno.test("crypto_price - custom currency", async () => {
  const result = (await agent.tools.crypto_price.handler(
    { coin: "ethereum", currency: "EUR" },
    testCtx(stubFetchJson({
      ethereum: {
        eur: 2000,
        eur_24h_change: -1.2,
        eur_market_cap: 240000000000,
      },
    })),
  )) as Record<string, unknown>;
  assertEquals(result.coin, "ethereum");
  assertEquals(result.currency, "eur");
  assertEquals(result.price, 2000);
});

Deno.test("crypto_price - unknown coin", async () => {
  const result = (await agent.tools.crypto_price.handler(
    { coin: "fakecoin" },
    testCtx(stubFetchJson({})),
  )) as Record<string, unknown>;
  assert((result.error as string).includes("not found"));
});

Deno.test("crypto_price - API failure throws", async () => {
  await assertRejects(async () => {
    await agent.tools.crypto_price.handler(
      { coin: "bitcoin" },
      testCtx(stubFetchError(500, "Server Error")),
    );
  });
});
