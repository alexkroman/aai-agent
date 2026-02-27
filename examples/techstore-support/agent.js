const { VoiceAgent } = await import("/client.js");

VoiceAgent.start({
  element: "#app",
  apiKey: "pk_your_publishable_key",

  prompt:
    "Transcribe customer support conversations accurately including email addresses, order IDs like ORD-12345, product SKUs, brand names, and technical product terms like laptop, monitor, headphones, GPU, RAM, and SSD.",

  instructions: `You are Nova, a senior customer support agent for TechStore, an online
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

  tools: {
    lookup_customer: {
      description:
        "Look up a customer profile by email address to verify their identity",
      parameters: {
        email: { type: "string", description: "Customer email address" },
      },
      handler: async (args, ctx) => {
        const resp = ctx.fetch(
          `https://api.example.com/customers?email=${encodeURIComponent(args.email)}`,
          {
            headers: {
              Authorization: `Bearer ${ctx.secrets.STORE_API_KEY}`,
            },
          },
        );
        if (!resp.ok)
          return { error: `Customer lookup failed: ${resp.statusText}` };
        return resp.json();
      },
    },

    get_order_details: {
      description:
        "Get full details for an order including items, status, shipping, and tracking",
      parameters: {
        order_id: {
          type: "string",
          description: "Order ID (e.g. 'ORD-12345')",
        },
      },
      handler: async (args, ctx) => {
        const resp = ctx.fetch(
          `https://api.example.com/orders/${args.order_id}`,
          {
            headers: {
              Authorization: `Bearer ${ctx.secrets.STORE_API_KEY}`,
            },
          },
        );
        if (!resp.ok) return { error: `Order not found: ${resp.statusText}` };
        return resp.json();
      },
    },

    check_inventory: {
      description:
        "Check product availability by SKU, including stock at nearby stores",
      parameters: {
        sku: { type: "string", description: "Product SKU" },
        zip_code: {
          type: "string?",
          description: "ZIP code to check nearby store availability",
        },
      },
      handler: async (args, ctx) => {
        const params = new URLSearchParams({ sku: args.sku });
        if (args.zip_code) params.set("zip", args.zip_code);
        const resp = ctx.fetch(`https://api.example.com/inventory?${params}`, {
          headers: {
            Authorization: `Bearer ${ctx.secrets.STORE_API_KEY}`,
          },
        });
        if (!resp.ok)
          return { error: `Inventory check failed: ${resp.statusText}` };
        return resp.json();
      },
    },

    check_promotions: {
      description:
        "Check active promotions and discount codes for a product or category",
      parameters: {
        sku: {
          type: "string?",
          description: "Product SKU to check for product-specific deals",
        },
        category: {
          type: "string?",
          description:
            "Product category (e.g. 'laptops', 'headphones', 'monitors')",
        },
      },
      handler: async (args, ctx) => {
        const params = new URLSearchParams();
        if (args.sku) params.set("sku", args.sku);
        if (args.category) params.set("category", args.category);
        const resp = ctx.fetch(`https://api.example.com/promotions?${params}`, {
          headers: {
            Authorization: `Bearer ${ctx.secrets.STORE_API_KEY}`,
          },
        });
        if (!resp.ok)
          return { error: `Promotion lookup failed: ${resp.statusText}` };
        return resp.json();
      },
    },

    initiate_return: {
      description:
        "Start a return/exchange process for a specific order item. Checks the 30-day return window automatically.",
      parameters: {
        order_id: { type: "string", description: "Original order ID" },
        item_sku: {
          type: "string",
          description: "SKU of the item to return",
        },
        reason: {
          type: "string",
          description:
            "Reason for return (e.g. 'defective', 'wrong item', 'changed mind')",
        },
        exchange_sku: {
          type: "string?",
          description: "If exchanging, the SKU of the replacement item",
        },
      },
      handler: async (args, ctx) => {
        const resp = ctx.fetch("https://api.example.com/returns", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${ctx.secrets.STORE_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            order_id: args.order_id,
            item_sku: args.item_sku,
            reason: args.reason,
            exchange_sku: args.exchange_sku,
          }),
        });
        if (!resp.ok)
          return {
            error: `Return initiation failed: ${resp.statusText}`,
          };
        return resp.json();
      },
    },

    escalate_to_specialist: {
      description:
        "Escalate a complex issue to a specialist team (billing, warranty, technical)",
      parameters: {
        team: {
          type: "string",
          description:
            "Specialist team: 'billing', 'warranty', 'technical', or 'manager'",
        },
        summary: {
          type: "string",
          description:
            "Brief summary of the issue and what has been tried so far",
        },
        customer_email: {
          type: "string",
          description: "Customer's email for follow-up",
        },
        priority: {
          type: "string?",
          description:
            "Priority level: 'low', 'normal', 'high', 'urgent' (default 'normal')",
        },
      },
      handler: async (args, ctx) => {
        const resp = ctx.fetch("https://api.example.com/escalations", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${ctx.secrets.STORE_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            team: args.team,
            summary: args.summary,
            customer_email: args.customer_email,
            priority: args.priority ?? "normal",
          }),
        });
        if (!resp.ok) return { error: `Escalation failed: ${resp.statusText}` };
        return resp.json();
      },
    },
  },
});
