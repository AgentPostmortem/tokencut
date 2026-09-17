import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
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

const tokenizer = join(fixtureDir, "counter #1.mjs");
writeFileSync(tokenizer, "export const count = (text) => text.length;\n");

test("analyze keeps the built-in estimate when no tokenizer is supplied", () => {
  const result = run("--json");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).totalTokens, 2);
});

test("analyze uses a tokenizer module, including spaces and URL-special characters", () => {
  const result = run("--tokenizer", tokenizer, "--json");
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.totalTokens, 5);
  assert.equal(report.biggest[0].tokens, 5);
});

test("resolves a relative tokenizer from the caller's directory before the payload", () => {
  const result = spawnSync(process.execPath, [
    fileURLToPath(new URL("../bin/tokencut.mjs", import.meta.url)),
    "--tokenizer", "./counter #1.mjs", fixture, "--json",
  ], { cwd: fixtureDir, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).totalTokens, 5);
});

test("compact uses the tokenizer for its budget and before/after report", () => {
  const payload = join(fixtureDir, "history.json");
  const output = join(fixtureDir, "compacted.json");
  const messages = Array.from({ length: 6 }, (_, i) => ({ role: "user", content: `hello-${i}` }));
  writeFileSync(payload, JSON.stringify(messages));
  const result = spawnSync(process.execPath, [
    "bin/tokencut.mjs", payload, "--tokenizer", tokenizer,
    "--compact", "--max", "28", "--out", output, "--json",
  ], { cwd: new URL("..", import.meta.url), encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.beforeTokens, 42);
  assert.equal(report.afterTokens, 28);
  assert.equal(report.savedTokens, 14);
  assert.deepEqual(JSON.parse(readFileSync(output, "utf8")), messages.slice(-4));
});

test("rejects a missing tokenizer argument without a stack trace", () => {
  const result = run("--tokenizer", "--json");
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "--tokenizer requires a module path\n");
});

test("reports tokenizer import and export errors without a stack trace", async (t) => {
  for (const [name, source, expected] of [
    ["missing.mjs", null, /could not load tokenizer/],
    ["no-count.mjs", "export default () => 1;", /must export a count\(text\) function/],
    ["not-callable.mjs", "export const count = 1;", /must export a count\(text\) function/],
    ["broken.mjs", 'throw new Error("broken module");', /broken module/],
  ]) {
    await t.test(name, () => {
      const path = join(fixtureDir, name);
      if (source !== null) writeFileSync(path, source);
      const result = run("--tokenizer", path, "--json");
      assert.equal(result.status, 1);
      assert.equal(result.stdout, "");
      assert.match(result.stderr, expected);
      assert.doesNotMatch(result.stderr, /\n\s+at /);
    });
  }
});
