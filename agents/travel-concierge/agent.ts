import { Agent, z } from "../../mod.ts";

const agent = new Agent({
  name: "Aria",
  instructions:
    `You are Aria, a luxury travel concierge. You help customers plan trips,
find flights and hotels, check weather at destinations, and convert currencies.

Rules:
- Always check weather before recommending activities
- When discussing costs, convert to the customer's preferred currency
- Suggest specific restaurants, landmarks, and experiences
- Be warm and enthusiastic but concise — this is a voice conversation
- If the customer hasn't specified dates, ask for them before searching flights`,
  greeting:
    "Welcome! I'm Aria, your travel concierge. Where are you dreaming of going?",
  voice: "tara",
  prompt:
    "Transcribe travel-related terms accurately including city names, airport codes like JFK SFO LAX CDG, airline names, hotel chains, currencies like USD EUR GBP JPY, and dates.",
})
  .tool("search_flights", {
    description:
      "Search for available flights between two cities on a given date",
    parameters: z.object({
      origin: z
        .string()
        .describe(
          "Departure city or airport code (e.g. 'SFO', 'New York')",
        ),
      destination: z
        .string()
        .describe("Arrival city or airport code"),
      date: z
        .string()
        .describe("Departure date in YYYY-MM-DD format"),
      passengers: z
        .number()
        .optional()
        .describe("Number of passengers (default 1)"),
    }),
    handler: async ({ origin, destination, date, passengers }, ctx) => {
      const params = new URLSearchParams({
        origin,
        destination,
        date,
        passengers: String(passengers ?? 1),
      });
      const resp = await ctx.fetch(
        `https://api.example.com/flights/search?${params}`,
        {
          headers: {
            Authorization: `Bearer ${ctx.secrets.FLIGHTS_API_KEY}`,
          },
        },
      );
      if (!resp.ok) {
        return { error: `Flight search failed: ${resp.statusText}` };
      }
      return resp.json();
    },
  })
  .tool("search_hotels", {
    description:
      "Search for hotels in a city with check-in and check-out dates",
    parameters: z.object({
      city: z.string().describe("City to search hotels in"),
      check_in: z.string().describe("Check-in date (YYYY-MM-DD)"),
      check_out: z.string().describe("Check-out date (YYYY-MM-DD)"),
      guests: z
        .number()
        .optional()
        .describe("Number of guests (default 2)"),
      max_price: z
        .number()
        .optional()
        .describe("Maximum price per night in USD"),
    }),
    handler: async ({ city, check_in, check_out, guests, max_price }, ctx) => {
      const resp = await ctx.fetch("https://api.example.com/hotels/search", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ctx.secrets.HOTELS_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          city,
          check_in,
          check_out,
          guests: guests ?? 2,
          max_price_usd: max_price,
        }),
      });
      if (!resp.ok) {
        return { error: `Hotel search failed: ${resp.statusText}` };
      }
      return resp.json();
    },
  })
  .tool("get_weather_forecast", {
    description: "Get a 7-day weather forecast for a destination city",
    parameters: z.object({
      city: z.string().describe("City name"),
    }),
    handler: async ({ city }, ctx) => {
      const resp = await ctx.fetch(
        `https://api.example.com/weather/forecast?city=${
          encodeURIComponent(city)
        }&days=7`,
        { headers: { "X-Api-Key": ctx.secrets.WEATHER_API_KEY } },
      );
      if (!resp.ok) {
        return { error: `Weather lookup failed: ${resp.statusText}` };
      }
      return resp.json();
    },
  })
  .tool("convert_currency", {
    description:
      "Convert an amount from one currency to another using live exchange rates",
    parameters: z.object({
      amount: z.number().describe("Amount to convert"),
      from: z.string().describe("Source currency code (e.g. 'USD')"),
      to: z.string().describe("Target currency code (e.g. 'EUR')"),
    }),
    handler: async ({ amount, from, to }, ctx) => {
      const resp = await ctx.fetch(
        `https://api.example.com/fx/convert?amount=${amount}&from=${from}&to=${to}`,
        {
          headers: {
            Authorization: `Bearer ${ctx.secrets.FX_API_KEY}`,
          },
        },
      );
      if (!resp.ok) {
        return { error: `Currency conversion failed: ${resp.statusText}` };
      }
      return resp.json();
    },
  });

export default agent;
