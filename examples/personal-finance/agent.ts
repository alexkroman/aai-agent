import { defineAgent, fetchJSON, tool, z } from "@aai/sdk";

// ── Response schemas (only validate fields we actually use) ─────

const ExchangeRateResponse = z.object({
  rates: z.record(z.string(), z.number()),
}).passthrough();

const CryptoPriceResponse = z.record(
  z.string(),
  z.record(z.string(), z.number()).optional(),
);

export default defineAgent({
  name: "Penny",
  instructions:
    `You are Penny, a friendly personal finance assistant. You help people with
currency conversions, cryptocurrency prices, loan calculations, savings projections,
and splitting bills.

Rules:
- Always show your math clearly when explaining calculations
- When discussing investments or crypto, remind users that prices fluctuate and
  this is not financial advice
- Be encouraging about savings goals
- Keep responses concise — this is a voice conversation
- Round dollar amounts to two decimal places for clarity`,
  greeting:
    "Hey there! I'm Penny, your personal finance helper. I can convert currencies, check crypto prices, calculate loans, project savings, or split a bill. What do you need?",
  voice: "jess",
  prompt:
    "Transcribe financial terms accurately including currency codes like USD EUR GBP JPY, cryptocurrency names like Bitcoin Ethereum Solana, percentage rates, and dollar amounts.",
  tools: {
    convert_currency: tool({
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
        try {
          const raw = await fetchJSON(
            ctx.fetch,
            `https://open.er-api.com/v6/latest/${fromCode}`,
          );
          const data = ExchangeRateResponse.parse(raw);
          const rate = data.rates[toCode];
          if (!rate) return { error: `Unknown currency code: ${toCode}` };
          return {
            amount,
            from: fromCode,
            to: toCode,
            rate: Math.round(rate * 10000) / 10000,
            result: Math.round(amount * rate * 100) / 100,
          };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),
    crypto_price: tool({
      description:
        "Get the current price of a cryptocurrency in a given fiat currency.",
      parameters: z.object({
        coin: z
          .string()
          .describe(
            "Cryptocurrency name or ID (e.g. 'bitcoin', 'ethereum', 'solana')",
          ),
        currency: z
          .string()
          .optional()
          .describe("Fiat currency code (default 'usd')"),
      }),
      handler: async ({ coin, currency }, ctx) => {
        const coinId = coin.toLowerCase();
        const cur = (currency ?? "usd").toLowerCase();
        try {
          const raw = await fetchJSON(
            ctx.fetch,
            `https://api.coingecko.com/api/v3/simple/price?ids=${
              encodeURIComponent(coinId)
            }&vs_currencies=${cur}&include_24hr_change=true&include_market_cap=true`,
          );
          const data = CryptoPriceResponse.parse(raw);
          const info = data[coinId];
          if (!info) {
            return {
              error:
                `Cryptocurrency not found: ${coin}. Try the full name like 'bitcoin' or 'ethereum'.`,
            };
          }
          return {
            coin: coinId,
            currency: cur,
            price: info[cur],
            change_24h_percent: info[`${cur}_24h_change`]
              ? Math.round(info[`${cur}_24h_change`] * 100) / 100
              : undefined,
            market_cap: info[`${cur}_market_cap`],
          };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),
    compound_interest: tool({
      description:
        "Calculate compound interest on a principal amount over time. Shows how savings or investments grow.",
      parameters: z.object({
        principal: z.number().describe("Starting amount in dollars"),
        rate: z
          .number()
          .describe(
            "Annual interest rate as a percentage (e.g. 5 for 5%)",
          ),
        years: z.number().describe("Number of years"),
        compounds_per_year: z
          .number()
          .optional()
          .describe(
            "How many times interest compounds per year (default 12 for monthly)",
          ),
        monthly_contribution: z
          .number()
          .optional()
          .describe("Additional amount added each month (default 0)"),
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

        const fvPrincipal = principal * Math.pow(1 + r / n, n * years);

        let fvContributions = 0;
        if (monthly > 0) {
          const periodicRate = r / n;
          const periods = n * years;
          fvContributions = monthly *
            ((Math.pow(1 + periodicRate, periods) - 1) / periodicRate);
        }

        const total = fvPrincipal + fvContributions;
        const totalContributed = principal + monthly * 12 * years;
        const interestEarned = total - totalContributed;

        return {
          principal,
          annual_rate_percent: rate,
          years,
          monthly_contribution: monthly,
          total_contributed: Math.round(totalContributed * 100) / 100,
          interest_earned: Math.round(interestEarned * 100) / 100,
          final_balance: Math.round(total * 100) / 100,
        };
      },
    }),
    loan_calculator: tool({
      description:
        "Calculate monthly payment, total interest, and amortization summary for a loan or mortgage.",
      parameters: z.object({
        principal: z.number().describe("Loan amount in dollars"),
        rate: z
          .number()
          .describe(
            "Annual interest rate as a percentage (e.g. 6.5 for 6.5%)",
          ),
        years: z.number().describe("Loan term in years"),
      }),
      handler: ({ principal, rate, years }) => {
        const monthlyRate = rate / 100 / 12;
        const payments = years * 12;

        if (monthlyRate === 0) {
          const monthly = principal / payments;
          return {
            principal,
            annual_rate_percent: rate,
            term_years: years,
            monthly_payment: Math.round(monthly * 100) / 100,
            total_paid: principal,
            total_interest: 0,
          };
        }

        const monthly = principal *
          (monthlyRate * Math.pow(1 + monthlyRate, payments)) /
          (Math.pow(1 + monthlyRate, payments) - 1);
        const totalPaid = monthly * payments;
        const totalInterest = totalPaid - principal;

        return {
          principal,
          annual_rate_percent: rate,
          term_years: years,
          monthly_payment: Math.round(monthly * 100) / 100,
          total_paid: Math.round(totalPaid * 100) / 100,
          total_interest: Math.round(totalInterest * 100) / 100,
        };
      },
    }),
    tip_calculator: tool({
      description: "Calculate tip and split a bill among multiple people.",
      parameters: z.object({
        bill: z.number().describe("Total bill amount in dollars"),
        tip_percent: z
          .number()
          .optional()
          .describe("Tip percentage (default 18)"),
        people: z
          .number()
          .optional()
          .describe("Number of people splitting the bill (default 1)"),
      }),
      handler: ({ bill, tip_percent, people }) => {
        const tipPct = tip_percent ?? 18;
        const numPeople = Math.max(Math.round(people ?? 1), 1);
        const tip = bill * (tipPct / 100);
        const total = bill + tip;
        const perPerson = total / numPeople;

        return {
          bill: Math.round(bill * 100) / 100,
          tip_percent: tipPct,
          tip_amount: Math.round(tip * 100) / 100,
          total: Math.round(total * 100) / 100,
          people: numPeople,
          per_person: Math.round(perPerson * 100) / 100,
        };
      },
    }),
  },
});
