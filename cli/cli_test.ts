import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { main } from "./cli.ts";

describe("cli main", () => {
  const logged: string[] = [];
  let origLog: typeof console.log;
  let origError: typeof console.error;

  beforeEach(() => {
    logged.length = 0;
    origLog = console.log;
    origError = console.error;
    console.log = (...args: string[]) => logged.push(args.join(" "));
    console.error = () => {};
  });

  afterEach(() => {
    console.log = origLog;
    console.error = origError;
  });

  it("prints version with --version", async () => {
    expect(await main(["--version"])).toBe(0);
    expect(logged).toEqual(["0.1.0"]);
  });

  it("prints usage with --help", async () => {
    expect(await main(["--help"])).toBe(0);
    expect(logged[0]).toContain("dev");
    expect(logged[0]).toContain("build");
    expect(logged[0]).toContain("deploy");
  });

  it("prints usage with no args", async () => {
    expect(await main([])).toBe(0);
    expect(logged[0]).toContain("aai");
  });

  it("prints command help with dev --help", async () => {
    expect(await main(["dev", "--help"])).toBe(0);
    expect(logged[0]).toContain("--port");
  });

  it("prints command help with build --help", async () => {
    expect(await main(["build", "--help"])).toBe(0);
    expect(logged[0]).toContain("--out-dir");
  });

  it("prints command help with deploy --help", async () => {
    expect(await main(["deploy", "--help"])).toBe(0);
    expect(logged[0]).toContain("--url");
    expect(logged[0]).toContain("--dry-run");
  });

  it("returns 1 for unknown command", async () => {
    expect(await main(["unknown-command"])).toBe(1);
  });
});
