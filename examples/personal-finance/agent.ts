import { Agent, fetchJSON, tool, z } from "@aai/sdk";

// ── Helpers ──────────────────────────────────────────────────────

/** Round to N decimal places (default 2). */
const round = (v: number, d = 2): number => {
  const f = 10 ** d;
  return Math.round(v * f) / f;
};

// ── Tools ────────────────────────────────────────────────────────

const convert_currency = tool({
  description:
    "Convert an amount from one currency to another using live exchange rates.",
  parameters: z.object({
    amount: z.number().describe("Amount to convert"),
    from: z.string().describe("Source currency code (e.g. 'USD')"),
    to: z.string().describe("Target currency code (e.g. 'EUR')"),
  }),
  handler: async ({ amount, from, to }, ctx) => {
    const fromCode = from.toUpperCase();
    const toCode = to.toUpperCase();
    const { rates } = (await fetchJSON(
      ctx.fetch,
      `https://open.er-api.com/v6/latest/${fromCode}`,
    )) as { rates: Record<string, number> };
    const rate = rates[toCode];
    if (!rate) return { error: `Unknown currency code: ${toCode}` };
    return {
      amount,
      from: fromCode,
      to: toCode,
      rate: round(rate, 4),
      result: round(amount * rate),
    };
  },
});

const crypto_price = tool({
  description:
    "Get the current price of a cryptocurrency in a given fiat currency.",
  parameters: z.object({
    coin: z.string().describe("Cryptocurrency ID (e.g. 'bitcoin', 'ethereum')"),
    currency: z.string().optional().describe(
      "Fiat currency code (default 'usd')",
    ),
  }),
  handler: async ({ coin, currency }, ctx) => {
    const coinId = coin.toLowerCase();
    const cur = (currency ?? "usd").toLowerCase();
    const url = new URL("https://api.coingecko.com/api/v3/simple/price");
    url.searchParams.set("ids", coinId);
    url.searchParams.set("vs_currencies", cur);
    url.searchParams.set("include_24hr_change", "true");
    url.searchParams.set("include_market_cap", "true");
    const data = (await fetchJSON(ctx.fetch, url.href)) as Record<
      string,
      Record<string, number> | undefined
    >;
    const info = data[coinId];
    if (!info) {
      return {
        error:
          `Cryptocurrency not found: ${coin}. Try the full name like 'bitcoin'.`,
      };
    }
    return {
      coin: coinId,
      currency: cur,
      price: info[cur],
      change_24h_percent: info[`${cur}_24h_change`] != null
        ? round(info[`${cur}_24h_change`])
        : undefined,
      market_cap: info[`${cur}_market_cap`],
    };
  },
});

const compound_interest = tool({
  description:
    "Calculate compound interest — shows how savings grow over time.",
  parameters: z.object({
    principal: z.number().describe("Starting amount in dollars"),
    rate: z.number().describe(
      "Annual interest rate as percentage (e.g. 5 for 5%)",
    ),
    years: z.number().describe("Number of years"),
    compounds_per_year: z.number().optional()
      .describe("Compounding frequency per year (default 12)"),
    monthly_contribution: z.number().optional()
      .describe("Additional monthly deposit (default 0)"),
  }),
  handler: ({
    principal,
    rate,
    years,
    compounds_per_year,
    monthly_contribution,
  }) => {
    const n = compounds_per_year ?? 12;
    const r = rate / 100;
    const monthly = monthly_contribution ?? 0;

    const fvPrincipal = principal * (1 + r / n) ** (n * years);
    const periodicRate = r / n;
    const fvContributions = monthly > 0 && periodicRate > 0
      ? monthly * (((1 + periodicRate) ** (n * years) - 1) / periodicRate)
      : 0;

    const total = fvPrincipal + fvContributions;
    const totalContributed = principal + monthly * 12 * years;

    return {
      principal,
      annual_rate_percent: rate,
      years,
      monthly_contribution: monthly,
      total_contributed: round(totalContributed),
      interest_earned: round(total - totalContributed),
      final_balance: round(total),
    };
  },
});

const loan_calculator = tool({
  description:
    "Calculate monthly payment, total interest, and amortization for a loan.",
  parameters: z.object({
    principal: z.number().describe("Loan amount in dollars"),
    rate: z.number().describe(
      "Annual interest rate as percentage (e.g. 6.5)",
    ),
    years: z.number().describe("Loan term in years"),
  }),
  handler: ({ principal, rate, years }) => {
    const m = rate / 100 / 12;
    const n = years * 12;
    const payment = m === 0
      ? principal / n
      : principal * (m * (1 + m) ** n) / ((1 + m) ** n - 1);
    const totalPaid = payment * n;

    return {
      principal,
      annual_rate_percent: rate,
      term_years: years,
      monthly_payment: round(payment),
      total_paid: round(totalPaid),
      total_interest: round(totalPaid - principal),
    };
  },
});

const tip_calculator = tool({
  description: "Calculate tip and split a bill among multiple people.",
  parameters: z.object({
    bill: z.number().describe("Total bill amount in dollars"),
    tip_percent: z.number().optional().describe(
      "Tip percentage (default 18)",
    ),
    people: z.number().optional().describe(
      "Number of people splitting (default 1)",
    ),
  }),
  handler: ({ bill, tip_percent, people }) => {
    const pct = tip_percent ?? 18;
    const n = Math.max(Math.round(people ?? 1), 1);
    const tip = bill * (pct / 100);
    const total = bill + tip;

    return {
      bill: round(bill),
      tip_percent: pct,
      tip_amount: round(tip),
      total: round(total),
      people: n,
      per_person: round(total / n),
    };
  },
});

// ── Agent ────────────────────────────────────────────────────────

export default new Agent({
  name: "Penny",
  voice: "jess",
  greeting:
    "Hey there! I'm Penny, your personal finance helper. I can convert currencies, check crypto prices, calculate loans, project savings, or split a bill. What do you need?",
  instructions:
    `You are Penny, a friendly personal finance assistant. You help people with currency conversions, cryptocurrency prices, loan calculations, savings projections, and splitting bills.

Rules:
- Always show your math clearly when explaining calculations
- When discussing investments or crypto, remind users that prices fluctuate and this is not financial advice
- Be encouraging about savings goals
- Keep responses concise — this is a voice conversation
- Round dollar amounts to two decimal places for clarity`,
  prompt:
    "Transcribe financial terms accurately including currency codes like USD EUR GBP JPY, cryptocurrency names like Bitcoin Ethereum Solana, percentage rates, and dollar amounts.",
  tools: {
    convert_currency,
    crypto_price,
    compound_interest,
    loan_calculator,
    tip_calculator,
  },
});
