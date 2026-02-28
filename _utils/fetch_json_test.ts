import { assertEquals, assertRejects } from "@std/assert";
import { fetchJSON, HttpError } from "./fetch_json.ts";

const fakeFetch = (resp: Response): typeof globalThis.fetch => () =>
  Promise.resolve(resp);

Deno.test("fetchJSON - returns parsed JSON", async () => {
  const data = await fetchJSON(
    fakeFetch(Response.json({ name: "test" })),
    "https://example.com",
  );
  assertEquals(data, { name: "test" });
});

Deno.test("fetchJSON - throws HttpError on 404", async () => {
  const fetch = fakeFetch(
    new Response(null, { status: 404, statusText: "Not Found" }),
  );
  const err = await assertRejects(
    () => fetchJSON(fetch, "https://example.com"),
    HttpError,
  );
  assertEquals(err.status, 404);
  assertEquals(err.message, "404 Not Found");
});

Deno.test("fetchJSON - throws on invalid JSON", async () => {
  await assertRejects(
    () => fetchJSON(fakeFetch(new Response("not json")), "https://example.com"),
    SyntaxError,
  );
});

Deno.test("fetchJSON - passes RequestInit through", async () => {
  let captured: RequestInit | undefined;
  const fetch: typeof globalThis.fetch = (_input, init?) => {
    captured = init;
    return Promise.resolve(Response.json({}));
  };
  await fetchJSON(fetch, "https://example.com", {
    headers: { "X-Custom": "val" },
  });
  assertEquals(
    (captured!.headers as Record<string, string>)["X-Custom"],
    "val",
  );
});
