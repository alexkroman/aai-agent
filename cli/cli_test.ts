import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { main } from "./cli.ts";

describe("cli main", () => {
  it("prints version with --version", async () => {
    const original = console.log;
    const logged: string[] = [];
    console.log = (...args: string[]) => logged.push(args.join(" "));
    try {
      const code = await main(["--version"]);
      expect(code).toBe(0);
      expect(logged).toEqual(["0.1.0"]);
    } finally {
      console.log = original;
    }
  });

  it("prints usage with --help", async () => {
    const original = console.log;
    const logged: string[] = [];
    console.log = (...args: string[]) => logged.push(args.join(" "));
    try {
      const code = await main(["--help"]);
      expect(code).toBe(0);
      expect(logged.length).toBe(1);
      expect(logged[0]).toContain("dev");
      expect(logged[0]).toContain("build");
      expect(logged[0]).toContain("deploy");
    } finally {
      console.log = original;
    }
  });

  it("prints usage with no args", async () => {
    const original = console.log;
    const logged: string[] = [];
    console.log = (...args: string[]) => logged.push(args.join(" "));
    try {
      const code = await main([]);
      expect(code).toBe(0);
      expect(logged[0]).toContain("aai");
    } finally {
      console.log = original;
    }
  });

  it("prints command help with dev --help", async () => {
    const original = console.log;
    const logged: string[] = [];
    console.log = (...args: string[]) => logged.push(args.join(" "));
    try {
      const code = await main(["dev", "--help"]);
      expect(code).toBe(0);
      expect(logged.length).toBe(1);
      expect(logged[0]).toContain("--port");
    } finally {
      console.log = original;
    }
  });

  it("prints command help with build --help", async () => {
    const original = console.log;
    const logged: string[] = [];
    console.log = (...args: string[]) => logged.push(args.join(" "));
    try {
      const code = await main(["build", "--help"]);
      expect(code).toBe(0);
      expect(logged.length).toBe(1);
      expect(logged[0]).toContain("--out-dir");
    } finally {
      console.log = original;
    }
  });

  it("prints command help with deploy --help", async () => {
    const original = console.log;
    const logged: string[] = [];
    console.log = (...args: string[]) => logged.push(args.join(" "));
    try {
      const code = await main(["deploy", "--help"]);
      expect(code).toBe(0);
      expect(logged.length).toBe(1);
      expect(logged[0]).toContain("--url");
      expect(logged[0]).toContain("--dry-run");
    } finally {
      console.log = original;
    }
  });

  it("returns 1 for unknown command", async () => {
    const originalLog = console.log;
    const originalError = console.error;
    console.log = () => {};
    console.error = () => {};
    try {
      const code = await main(["unknown-command"]);
      expect(code).toBe(1);
    } finally {
      console.log = originalLog;
      console.error = originalError;
    }
  });
});
