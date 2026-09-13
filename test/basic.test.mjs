import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateTokens, analyzePayload, compact } from "../src/index.mjs";

test("estimateTokens is positive and grows with length", () => {
  assert.ok(estimateTokens("hello world") > 0);
  assert.ok(estimateTokens("a".repeat(400)) > estimateTokens("a".repeat(40)));
  assert.equal(estimateTokens(""), 0);
  assert.equal(estimateTokens(null), 0);
});

test("analyzePayload totals across roles and kinds", () => {
  const payload = {
    system: "You are a helpful agent.",
    messages: [
      { role: "user", content: "hi" },
      { role: "assistant", content: [{ type: "text", text: "hello" }, { type: "tool_use", input: { q: "weather" } }] },
      { role: "user", content: [{ type: "tool_result", content: "x".repeat(2000) }] },
    ],
  };
  const a = analyzePayload(payload);
  assert.ok(a.totalTokens > 0);
  assert.ok(a.byRole.system > 0);
  assert.ok(a.byKind.tool_result > a.byKind.text);
  assert.ok(a.costUSD > 0);
});

test("compact truncates a bloated tool_result and reports savings", () => {
  const payload = { messages: [{ role: "user", content: [{ type: "tool_result", content: "x".repeat(8000) }] }] };
  const { payload: out, report } = compact(payload, { maxToolResultTokens: 100 });
  assert.ok(report.savedTokens > 0);
  assert.ok(report.afterTokens < report.beforeTokens);
  assert.ok(out.messages[0].content[0].content.includes("tokencut truncated"));
});

test("compact dedupes identical blocks", () => {
  const dup = "this is a repeated context block that appears twice in the payload";
  const payload = { messages: [
    { role: "user", content: [{ type: "text", text: dup }] },
    { role: "user", content: [{ type: "text", text: dup }] },
  ] };
  const { report } = compact(payload);
  assert.ok(report.actions.some((a) => a.startsWith("dedupe")));
});

test("compact trims oldest messages to a hard budget, keeps system", () => {
  const messages = [{ role: "system", content: "sys" }];
  for (let i = 0; i < 20; i++) messages.push({ role: "user", content: "message number " + i + " " + "y".repeat(200) });
  const { payload: out, report } = compact({ messages }, { maxTokens: 300, keepLastTurns: 2 });
  assert.ok(report.afterTokens <= 300 || report.savedTokens > 0);
  assert.equal(out.messages[0].role, "system");
});

test("compact trims a large payload with linear token counting", () => {
  const messages = Array.from({ length: 500 }, (_, i) => ({
    role: "user",
    content: `message-${i}`,
  }));
  let counterCalls = 0;
  const counter = () => {
    counterCalls++;
    return 1;
  };

  const { payload: out, report } = compact(
    { messages },
    { maxTokens: 4, keepLastTurns: 4, dropDuplicates: false, counter },
  );

  assert.deepEqual(out.messages, messages.slice(-4));
  assert.equal(report.beforeTokens, 500);
  assert.equal(report.afterTokens, 4);
  assert.equal(report.savedTokens, 496);
  assert.equal(report.actions.length, 496);
  assert.ok(counterCalls <= messages.length * 3, `counter called ${counterCalls} times`);
});

test("compact rejects invalid budgets before transforming the payload", () => {
  const payload = { messages: [{ role: "user", content: "keep me" }] };
  const invalidOptions = [
    ["maxToolResultTokens", -1],
    ["maxToolResultTokens", Number.POSITIVE_INFINITY],
    ["maxTokens", Number.NaN],
    ["keepLastTurns", -1],
    ["keepLastTurns", 1.5],
  ];

  for (const [name, value] of invalidOptions) {
    assert.throws(
      () => compact(payload, { [name]: value }),
      { name: "RangeError", message: new RegExp(`${name} must be`) },
    );
  }
});

test("analyzePayload empty messages yields zero tokens", () => {
  const a = analyzePayload({ messages: [] });
  assert.equal(a.totalTokens, 0);
  assert.equal(a.units, 0);
  assert.equal(a.costUSD, 0);
  assert.deepEqual(a.biggest, []);
});

test("analyzePayload empty array payload yields zero tokens", () => {
  const a = analyzePayload([]);
  assert.equal(a.totalTokens, 0);
  assert.equal(a.units, 0);
});

test("units rejects non-array payload.messages with TypeError", () => {
  assert.throws(
    () => analyzePayload({ messages: "not-an-array" }),
    { name: "TypeError", message: /payload\.messages must be an array/ },
  );
  assert.throws(
    () => compact({ messages: { bad: true } }),
    { name: "TypeError", message: /payload\.messages must be an array/ },
  );
});
