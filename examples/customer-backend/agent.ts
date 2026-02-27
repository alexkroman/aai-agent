// agent.ts — Agent config and tools. This is the only file you edit.

export const config = {
  instructions: "You are a helpful assistant. Be concise.",
  greeting: "Hey! What can I help you with?",
  voice: "jess",
};

export const tools = {
  get_weather: {
    description: "Get current weather for a city",
    parameters: { city: { type: "string", description: "City name" } },
    handler: async (args: { city: string }) => {
      const resp = await fetch(
        `https://api.weather.com/current?city=${encodeURIComponent(args.city)}`
      );
      return await resp.json();
    },
  },

  search_web: {
    description: "Search the web for information",
    parameters: { query: { type: "string", description: "Search query" } },
    handler: async (args: { query: string }) => {
      const resp = await fetch(
        `https://api.duckduckgo.com/?q=${encodeURIComponent(args.query)}&format=json`
      );
      const data = await resp.json();
      return data.AbstractText || "No results found.";
    },
  },
};
