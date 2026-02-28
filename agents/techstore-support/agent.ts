import { Agent, z } from "../../mod.ts";

const agent = new Agent({
  name: "Nova",
  instructions:
    `You are Nova, a senior customer support agent for TechStore, an online
electronics retailer. You can look up orders, check inventory, process returns,
and escalate issues to specialists.

Rules:
- Always verify the customer's identity by looking up their email before accessing order details
- Be empathetic and solution-oriented
- If a product is out of stock, check availability at nearby stores
- For returns, check the return policy window (30 days) before processing
- Offer to escalate complex issues to a specialist team
- Keep responses conversational and concise — this is a voice call
- When quoting prices, always mention if there are active promotions`,
  greeting:
    "Hi, I'm Nova from TechStore support! I can help with orders, returns, product availability, and more. What can I do for you today?",
  voice: "jess",
  prompt:
    "Transcribe customer support conversations accurately including email addresses, order IDs like ORD-12345, product SKUs, brand names, and technical product terms like laptop, monitor, headphones, GPU, RAM, and SSD.",
})
  .tool("lookup_customer", {
    description:
      "Look up a customer profile by email address to verify their identity",
    parameters: z.object({
      email: z.string().describe("Customer email address"),
    }),
    handler: async ({ email }, ctx) => {
      const resp = await ctx.fetch(
        `https://api.example.com/customers?email=${encodeURIComponent(email)}`,
        {
          headers: {
            Authorization: `Bearer ${ctx.secrets.STORE_API_KEY}`,
          },
        },
      );
      if (!resp.ok) {
        return { error: `Customer lookup failed: ${resp.statusText}` };
      }
      return resp.json();
    },
  })
  .tool("get_order_details", {
    description:
      "Get full details for an order including items, status, shipping, and tracking",
    parameters: z.object({
      order_id: z.string().describe("Order ID (e.g. 'ORD-12345')"),
    }),
    handler: async ({ order_id }, ctx) => {
      const resp = await ctx.fetch(
        `https://api.example.com/orders/${order_id}`,
        {
          headers: {
            Authorization: `Bearer ${ctx.secrets.STORE_API_KEY}`,
          },
        },
      );
      if (!resp.ok) {
        return { error: `Order not found: ${resp.statusText}` };
      }
      return resp.json();
    },
  })
  .tool("check_inventory", {
    description:
      "Check product availability by SKU, including stock at nearby stores",
    parameters: z.object({
      sku: z.string().describe("Product SKU"),
      zip_code: z
        .string()
        .optional()
        .describe("ZIP code to check nearby store availability"),
    }),
    handler: async ({ sku, zip_code }, ctx) => {
      const params = new URLSearchParams({ sku });
      if (zip_code) params.set("zip", zip_code);
      const resp = await ctx.fetch(
        `https://api.example.com/inventory?${params}`,
        {
          headers: {
            Authorization: `Bearer ${ctx.secrets.STORE_API_KEY}`,
          },
        },
      );
      if (!resp.ok) {
        return { error: `Inventory check failed: ${resp.statusText}` };
      }
      return resp.json();
    },
  })
  .tool("check_promotions", {
    description:
      "Check active promotions and discount codes for a product or category",
    parameters: z.object({
      sku: z
        .string()
        .optional()
        .describe("Product SKU to check for product-specific deals"),
      category: z
        .string()
        .optional()
        .describe(
          "Product category (e.g. 'laptops', 'headphones', 'monitors')",
        ),
    }),
    handler: async ({ sku, category }, ctx) => {
      const params = new URLSearchParams();
      if (sku) params.set("sku", sku);
      if (category) params.set("category", category);
      const resp = await ctx.fetch(
        `https://api.example.com/promotions?${params}`,
        {
          headers: {
            Authorization: `Bearer ${ctx.secrets.STORE_API_KEY}`,
          },
        },
      );
      if (!resp.ok) {
        return { error: `Promotion lookup failed: ${resp.statusText}` };
      }
      return resp.json();
    },
  })
  .tool("initiate_return", {
    description:
      "Start a return/exchange process for a specific order item. Checks the 30-day return window automatically.",
    parameters: z.object({
      order_id: z.string().describe("Original order ID"),
      item_sku: z.string().describe("SKU of the item to return"),
      reason: z
        .string()
        .describe(
          "Reason for return (e.g. 'defective', 'wrong item', 'changed mind')",
        ),
      exchange_sku: z
        .string()
        .optional()
        .describe("If exchanging, the SKU of the replacement item"),
    }),
    handler: async ({ order_id, item_sku, reason, exchange_sku }, ctx) => {
      const resp = await ctx.fetch("https://api.example.com/returns", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ctx.secrets.STORE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          order_id,
          item_sku,
          reason,
          exchange_sku,
        }),
      });
      if (!resp.ok) {
        return { error: `Return initiation failed: ${resp.statusText}` };
      }
      return resp.json();
    },
  })
  .tool("escalate_to_specialist", {
    description:
      "Escalate a complex issue to a specialist team (billing, warranty, technical)",
    parameters: z.object({
      team: z
        .string()
        .describe(
          "Specialist team: 'billing', 'warranty', 'technical', or 'manager'",
        ),
      summary: z
        .string()
        .describe(
          "Brief summary of the issue and what has been tried so far",
        ),
      customer_email: z
        .string()
        .describe("Customer's email for follow-up"),
      priority: z
        .string()
        .optional()
        .describe(
          "Priority level: 'low', 'normal', 'high', 'urgent' (default 'normal')",
        ),
    }),
    handler: async ({ team, summary, customer_email, priority }, ctx) => {
      const resp = await ctx.fetch("https://api.example.com/escalations", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ctx.secrets.STORE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          team,
          summary,
          customer_email,
          priority: priority ?? "normal",
        }),
      });
      if (!resp.ok) {
        return { error: `Escalation failed: ${resp.statusText}` };
      }
      return resp.json();
    },
  });

export default agent;
