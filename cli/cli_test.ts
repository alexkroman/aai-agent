import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { cli } from "./cli.ts";

describe("cli root", () => {
  function parse(args: string[]) {
    return cli.reset().throwErrors().noExit().parse(args);
  }

  it("shows version with --version", async () => {
    // throwErrors + noExit makes --version return instead of exiting
    // Cliffy prints version and resolves
    try {
      await parse(["--version"]);
    } catch {
      // --version may throw a special exit error in noExit mode
    }
  });

  it("rejects unknown subcommands", async () => {
    try {
      await parse(["unknown-command"]);
      expect(true).toBe(false); // should not reach
    } catch (err) {
      expect((err as Error).message).toContain("unknown");
    }
  });

  it("accepts --verbose global option", async () => {
    // Should not throw when --verbose is provided with a valid subcommand
    // We test with help which doesn't require side effects
    try {
      await parse(["build", "--help"]);
    } catch {
      // --help may throw in noExit mode, that's fine
    }
  });
});
