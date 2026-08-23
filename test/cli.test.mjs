import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test, { after } from "node:test";

const fixtureDir = mkdtempSync(join(tmpdir(), "tokencut-cli-"));
const fixture = join(fixtureDir, "payload.json");
writeFileSync(fixture, JSON.stringify([{ role: "user", content: "hello" }]));
after(() => rmSync(fixtureDir, { recursive: true, force: true }));

function run(...args) {
  return spawnSync(process.execPath, ["bin/tokencut.mjs", fixture, ...args], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
  });
}

test("rejects invalid numeric flags with the flag and received value", async (t) => {
  const cases = [
    {
      args: ["--compact", "--max", "abc"],
      flag: "--max",
      received: '"abc"',
    },
    {
      args: ["--compact", "--max-tool", "-1"],
      flag: "--max-tool",
      received: '"-1"',
    },
    { args: ["--price", "NaN"], flag: "--price", received: '"NaN"' },
    {
      args: ["--price", "Infinity"],
      flag: "--price",
      received: '"Infinity"',
    },
    { args: ["--price"], flag: "--price", received: "true" },
  ];

  for (const scenario of cases) {
    await t.test(scenario.flag + " " + scenario.received, () => {
      const result = run(...scenario.args);
      assert.notEqual(result.status, 0);
      assert.equal(
        result.stderr,
        `${scenario.flag} must be a finite, non-negative number; received ${scenario.received}\n`,
      );
      assert.equal(result.stdout, "");
    });
  }
});

test("accepts zero as a compact token budget", () => {
  const result = run("--compact", "--max", "0", "--json");
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotThrow(() => JSON.parse(result.stdout));
});
