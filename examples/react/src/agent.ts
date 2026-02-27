// agent.ts — Agent config and tools. This is the only file you edit.

type Ctx = {
  secrets: Record<string, string>;
  fetch: (url: string, init?: RequestInit) => {
    ok: boolean;
    status: number;
    statusText: string;
    headers: Record<string, string>;
    text: () => string;
    json: () => unknown;
  };
};

export const config = {
  instructions: "You are a helpful order tracking assistant. Be concise.",
  greeting: "Hi! I can help you check your order status.",
  voice: "jess",
};

export const tools = {
  check_order: {
    description: "Look up order status by order ID",
    parameters: { order_id: { type: "string", description: "Order ID" } },
    handler: async (args: { order_id: string }, ctx: Ctx) => {
      const resp = ctx.fetch(
        `https://api.example.com/orders/${args.order_id}`,
        { headers: { Authorization: `Bearer ${ctx.secrets.ORDERS_API_KEY}` } }
      );
      return resp.json();
    },
  },
  schedule_callback: {
    description: "Schedule a callback for the customer",
    parameters: {
      phone: { type: "string", description: "Phone number" },
      time: { type: "string?", description: "Preferred time, e.g. '2pm'" },
    },
    handler: async (args: { phone: string; time?: string }, ctx: Ctx) => {
      const resp = ctx.fetch("https://api.example.com/callbacks", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ctx.secrets.ORDERS_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ phone: args.phone, time: args.time ?? "next available" }),
      });
      return resp.json();
    },
  },
};
