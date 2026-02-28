import { assertEquals, assertRejects } from "@std/assert";
import { fetchJSON, HttpError } from "./fetch_json.ts";

function stubFetch(
  handler: (url: string | URL) => Response,
): [typeof globalThis.fetch, () => void] {
  const original = globalThis.fetch;
  const stub = (input: string | URL | Request) =>
    Promise.resolve(handler(input as string | URL));
  globalThis.fetch = stub as typeof globalThis.fetch;
  return [stub as typeof globalThis.fetch, () => {
    globalThis.fetch = original;
  }];
}

Deno.test("fetchJSON - returns parsed JSON", async () => {
  const [fetch, restore] = stubFetch(() => Response.json({ name: "test" }));
  try {
    const data = await fetchJSON(fetch, "https://example.com");
    assertEquals(data, { name: "test" });
  } finally {
    restore();
  }
});

Deno.test("fetchJSON - throws HttpError on 404", async () => {
  const [fetch, restore] = stubFetch(
    () => new Response(null, { status: 404, statusText: "Not Found" }),
  );
  try {
    const err = await assertRejects(
      () => fetchJSON(fetch, "https://example.com"),
      HttpError,
    );
    assertEquals(err.status, 404);
    assertEquals(err.message, "404 Not Found");
  } finally {
    restore();
  }
});

Deno.test("fetchJSON - throws on invalid JSON", async () => {
  const [fetch, restore] = stubFetch(() => new Response("not json"));
  try {
    await assertRejects(
      () => fetchJSON(fetch, "https://example.com"),
      SyntaxError,
    );
  } finally {
    restore();
  }
});

Deno.test("fetchJSON - passes RequestInit through", async () => {
  let captured: RequestInit | undefined;
  const original = globalThis.fetch;
  const stub = (
    _input: string | URL | Request,
    init?: RequestInit,
  ) => {
    captured = init;
    return Promise.resolve(Response.json({}));
  };
  globalThis.fetch = stub as typeof globalThis.fetch;
  try {
    await fetchJSON(stub as typeof globalThis.fetch, "https://example.com", {
      headers: { "X-Custom": "val" },
    });
    assertEquals(
      (captured!.headers as Record<string, string>)["X-Custom"],
      "val",
    );
  } finally {
    globalThis.fetch = original;
  }
});
