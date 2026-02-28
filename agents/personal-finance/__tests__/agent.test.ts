import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { agent } from "../agent.ts";

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

describe("personal-finance agent", () => {
  it("has correct config", () => {
    expect(agent.config.name).toBe("Penny");
    expect(agent.config.voice).toBe("jess");
    expect(agent.tools.size).toBe(5);
  });

  describe("compound_interest", () => {
    const handler = agent.tools.get("compound_interest")!.handler;
    const ctx = { secrets: {}, fetch: globalThis.fetch };

    it("calculates basic compound interest", async () => {
      const result = (await handler(
        { principal: 10000, rate: 5, years: 10 },
        ctx,
      )) as Record<string, unknown>;
      expect(result.principal).toBe(10000);
      expect(result.annual_rate_percent).toBe(5);
      expect(result.final_balance).toBeGreaterThan(16000);
      expect(result.interest_earned).toBeGreaterThan(6000);
    });

    it("includes monthly contributions", async () => {
      const result = (await handler(
        {
          principal: 1000,
          rate: 7,
          years: 20,
          monthly_contribution: 200,
        },
        ctx,
      )) as Record<string, unknown>;
      expect(result.total_contributed).toBe(49000);
      expect(result.final_balance as number).toBeGreaterThan(
        result.total_contributed as number,
      );
      expect(result.monthly_contribution).toBe(200);
    });

    it("handles custom compounds_per_year", async () => {
      const result = (await handler(
        { principal: 10000, rate: 5, years: 1, compounds_per_year: 1 },
        ctx,
      )) as Record<string, unknown>;
      // Annual compounding: 10000 * (1 + 0.05)^1 = 10500
      expect(result.final_balance).toBe(10500);
    });

    it("handles zero monthly contribution", async () => {
      const result = (await handler(
        { principal: 5000, rate: 3, years: 5, monthly_contribution: 0 },
        ctx,
      )) as Record<string, unknown>;
      expect(result.monthly_contribution).toBe(0);
      expect(result.total_contributed).toBe(5000);
    });
  });

  describe("loan_calculator", () => {
    const handler = agent.tools.get("loan_calculator")!.handler;
    const ctx = { secrets: {}, fetch: globalThis.fetch };

    it("calculates monthly mortgage payment", async () => {
      const result = (await handler(
        { principal: 300000, rate: 6.5, years: 30 },
        ctx,
      )) as Record<string, unknown>;
      expect(result.monthly_payment).toBeGreaterThan(1800);
      expect(result.monthly_payment).toBeLessThan(2000);
      expect(result.total_interest).toBeGreaterThan(0);
      expect(result.term_years).toBe(30);
    });

    it("handles zero interest", async () => {
      const result = (await handler(
        { principal: 12000, rate: 0, years: 1 },
        ctx,
      )) as Record<string, unknown>;
      expect(result.monthly_payment).toBe(1000);
      expect(result.total_interest).toBe(0);
      expect(result.total_paid).toBe(12000);
    });
  });

  describe("tip_calculator", () => {
    const handler = agent.tools.get("tip_calculator")!.handler;
    const ctx = { secrets: {}, fetch: globalThis.fetch };

    it("calculates tip with defaults", async () => {
      const result = (await handler(
        { bill: 100 },
        ctx,
      )) as Record<string, unknown>;
      expect(result.tip_amount).toBe(18);
      expect(result.total).toBe(118);
      expect(result.per_person).toBe(118);
      expect(result.tip_percent).toBe(18);
      expect(result.people).toBe(1);
    });

    it("splits bill among people", async () => {
      const result = (await handler(
        { bill: 200, tip_percent: 20, people: 4 },
        ctx,
      )) as Record<string, unknown>;
      expect(result.tip_amount).toBe(40);
      expect(result.total).toBe(240);
      expect(result.per_person).toBe(60);
    });

    it("handles fractional people by rounding", async () => {
      const result = (await handler(
        { bill: 100, people: 2.7 },
        ctx,
      )) as Record<string, unknown>;
      expect(result.people).toBe(3);
    });
  });

  describe("convert_currency", () => {
    const handler = agent.tools.get("convert_currency")!.handler;

    it("converts currency successfully", async () => {
      const ctx = {
        secrets: {},
        fetch: mockFetch({ rates: { EUR: 0.92, GBP: 0.79 } }),
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

    it("returns error for unknown currency", async () => {
      const ctx = {
        secrets: {},
        fetch: mockFetch({ rates: { EUR: 0.92 } }),
      };

      const result = (await handler(
        { amount: 50, from: "USD", to: "XYZ" },
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
        { amount: 50, from: "USD", to: "EUR" },
        ctx,
      )) as Record<string, unknown>;

      expect(result.error).toBeDefined();
    });
  });

  describe("crypto_price", () => {
    const handler = agent.tools.get("crypto_price")!.handler;

    it("returns crypto price with defaults", async () => {
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

      const result = (await handler(
        { coin: "bitcoin" },
        ctx,
      )) as Record<string, unknown>;

      expect(result.coin).toBe("bitcoin");
      expect(result.currency).toBe("usd");
      expect(result.price).toBe(45000);
      expect(result.change_24h_percent).toBe(2.5);
      expect(result.market_cap).toBe(900000000000);
    });

    it("handles custom currency", async () => {
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

      const result = (await handler(
        { coin: "ethereum", currency: "EUR" },
        ctx,
      )) as Record<string, unknown>;

      expect(result.coin).toBe("ethereum");
      expect(result.currency).toBe("eur");
      expect(result.price).toBe(2000);
    });

    it("returns error for unknown coin", async () => {
      const ctx = {
        secrets: {},
        fetch: mockFetch({}),
      };

      const result = (await handler(
        { coin: "fakecoin" },
        ctx,
      )) as Record<string, unknown>;

      expect(result.error).toContain("not found");
    });

    it("returns error when API fails", async () => {
      const ctx = {
        secrets: {},
        fetch: mockFetchError(500, "Server Error"),
      };

      const result = (await handler(
        { coin: "bitcoin" },
        ctx,
      )) as Record<string, unknown>;

      expect(result.error).toBeDefined();
    });
  });
});
