import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

/** Production `.ts` import suffixes crash Vercel with FUNCTION_INVOCATION_FAILED. */
test("production TypeScript never imports with a .ts suffix", () => {
  const files: string[] = [];
  for (const root of ["lib", "api"]) {
    const dir = path.join(process.cwd(), root);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith(".ts") || name.endsWith(".test.ts")) continue;
      files.push(path.join(dir, name));
    }
  }
  assert.ok(files.length > 0, "expected production .ts files under lib/ and api/");
  const bad: string[] = [];
  const re = /from\s+["'][^"']+\.ts["']/;
  for (const file of files) {
    if (re.test(fs.readFileSync(file, "utf8"))) {
      bad.push(path.relative(process.cwd(), file));
    }
  }
  assert.deepEqual(bad, []);
});
