import { Agent, tool, z } from "@aai/sdk";

const WEATHER_CODES: Record<number, string> = {
  0: "Clear sky",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Foggy",
  48: "Depositing rime fog",
  51: "Light drizzle",
  53: "Moderate drizzle",
  55: "Dense drizzle",
  61: "Slight rain",
  63: "Moderate rain",
  65: "Heavy rain",
  71: "Slight snow",
  73: "Moderate snow",
  75: "Heavy snow",
  80: "Slight rain showers",
  81: "Moderate rain showers",
  82: "Violent rain showers",
  85: "Slight snow showers",
  86: "Heavy snow showers",
  95: "Thunderstorm",
  96: "Thunderstorm with slight hail",
  99: "Thunderstorm with heavy hail",
};

const toF = (c: number) => Math.round(c * 9 / 5 + 32);

export default new Agent({
  name: "Aria",
  instructions:
    `You are Aria, a luxury travel concierge. You help customers plan trips,
find flights and hotels, check weather at destinations, and convert currencies.

Rules:
- Always check weather before recommending activities
- When discussing costs, convert to the customer's preferred currency
- Suggest specific restaurants, landmarks, and experiences
- Be warm and enthusiastic but concise — this is a voice conversation
- If the customer hasn't specified dates, ask for them before searching flights
- Use web_search to find current flight and hotel options, then visit_webpage for details`,
  greeting:
    "Welcome! I'm Aria, your travel concierge. Where are you dreaming of going?",
  voice: "tara",
  prompt:
    "Transcribe travel-related terms accurately including city names, airport codes like JFK SFO LAX CDG, airline names, hotel chains, currencies like USD EUR GBP JPY, and dates.",
  builtinTools: ["web_search", "visit_webpage"],
  tools: {
    get_weather_forecast: tool({
      description: "Get a 7-day weather forecast for a destination city.",
      parameters: z.object({
        city: z.string().describe("City name (e.g. 'Paris', 'Tokyo')"),
      }),
      handler: async ({ city }, ctx) => {
        try {
          const geoResp = await ctx.fetch(
            `https://geocoding-api.open-meteo.com/v1/search?name=${
              encodeURIComponent(city)
            }&count=1&language=en`,
          );
          const geo = await geoResp.json();
          const loc = geo.results?.[0];
          if (!loc) return { error: `City not found: ${city}` };

          const wxResp = await ctx.fetch(
            `https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weathercode&timezone=auto&forecast_days=7`,
          );
          const { daily } = await wxResp.json();

          return {
            city: loc.name,
            country: loc.country,
            forecast: daily.time.map((date: string, i: number) => ({
              date,
              high_c: daily.temperature_2m_max[i],
              low_c: daily.temperature_2m_min[i],
              high_f: toF(daily.temperature_2m_max[i]),
              low_f: toF(daily.temperature_2m_min[i]),
              precipitation_mm: daily.precipitation_sum[i],
              condition: WEATHER_CODES[daily.weathercode[i]] ?? "Unknown",
            })),
          };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),
    convert_currency: tool({
      description: "Convert between currencies using live exchange rates.",
      parameters: z.object({
        amount: z.number().describe("Amount to convert"),
        from: z.string().describe("Source currency code (e.g. 'USD')"),
        to: z.string().describe("Target currency code (e.g. 'EUR')"),
      }),
      handler: async ({ amount, from, to }, ctx) => {
        const fromCode = from.toUpperCase();
        const toCode = to.toUpperCase();
        try {
          const resp = await ctx.fetch(
            `https://open.er-api.com/v6/latest/${fromCode}`,
          );
          const { rates } = await resp.json();
          const rate = rates[toCode];
          if (!rate) return { error: `Unknown currency code: ${toCode}` };
          return {
            amount,
            from: fromCode,
            to: toCode,
            rate: Math.round(rate * 1e4) / 1e4,
            result: Math.round(amount * rate * 100) / 100,
          };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),
  },
});
