import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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


test("--version prints package version", () => {
  const r = spawnSync(process.execPath, ["bin/tokencut.mjs", "--version"], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
  });
  assert.equal(r.status, 0);
  const ver = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
  assert.equal(r.stdout.trim(), ver);
});


test("rejects compact budget flags without --compact", async (t) => {
  for (const flag of ["--max", "--max-tool"]) {
    await t.test(flag, () => {
      const result = run(flag, "1");
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /requires --compact/);
      assert.equal(result.stdout, "");
    });
  }
});
