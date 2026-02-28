import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { devCommand } from "../commands/dev.ts";

describe("devCommand parsing", () => {
  function parse(args: string[]) {
    return devCommand.reset().throwErrors().noExit().parse(args);
  }

  it("defaults --port to 3000", async () => {
    const { options } = await parse([]);
    expect(options.port).toBe(3000);
  });

  it("accepts custom --port", async () => {
    const { options } = await parse(["--port", "8080"]);
    expect(options.port).toBe(8080);
  });

  it("accepts -p shorthand", async () => {
    const { options } = await parse(["-p", "4000"]);
    expect(options.port).toBe(4000);
  });
});
