import { assertEquals } from "@std/assert";
import { getLogger } from "./logger.ts";

Deno.test("getLogger returns named logger with all methods", () => {
  const log = getLogger("test");
  assertEquals(typeof log.debug, "function");
  assertEquals(typeof log.info, "function");
  assertEquals(typeof log.warn, "function");
  assertEquals(typeof log.error, "function");
});
