"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { Analyzer } = require("./model");
const C = require("./contract");
const F = require("./fixtures");
const P = require("./presentation");
const { loadResources } = require("./resources");

const leak = "已修正 completeness.score：按各维度权重计算为 13，其余业务事实保持不变。";
const resources = loadResources();
const input = F.input(resources.context);
input.userMessage = "自动化可以改成定时任务吗";
input.conversationContext.recentTurns = [{ turnId: input.turnId, role: "user", message: input.userMessage }];

async function generate(replies, verify) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const part of req) body += part;
    const request = JSON.parse(body);
    requests.push(request);
    const value = structuredClone(replies[Math.min(requests.length - 1, replies.length - 1)]);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) } }] }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const env = { REQUIREMENT_MODEL_BASE_URL: `http://127.0.0.1:${server.address().port}/v1`, REQUIREMENT_MODEL_API_KEY: "fixture-key", REQUIREMENT_MODEL: "fixture-model" };
  const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  try { await verify(new Analyzer().run(input, resources), requests); }
  finally {
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}

test("arithmetic-only mismatch is computed once without changing the business response", async () => {
  const value = F.output(input);
  value.completeness.dimensions.role_scenario.status = "partial";
  value.completeness.dimensions.scope_branches.status = "partial";
  value.completeness.score = 12;
  await generate([value], async (promise, requests) => {
    const result = await promise;
    assert.equal(requests.length, 1);
    assert.equal(result.completeness.score, 13);
    assert.deepEqual({ ...result, completeness: { ...result.completeness, score: 12 } }, value);
    assert.equal(result.recommendation.type, "supplement");
  });
});

test("structural retry keeps the original user request last and returns a business question", async () => {
  const bad = F.output(input), good = F.output(input);
  bad.capabilityAssessment.capabilityVersion = null;
  good.assistantMessage = "你希望只调整名称，还是也改变任务的定时执行方式？";
  await generate([bad, good], async (promise, requests) => {
    assert.equal((await promise).assistantMessage, good.assistantMessage);
    assert.equal(requests.length, 2);
    assert.deepEqual(requests[1].messages.filter(item => item.role === "user"), [{ role: "user", content: JSON.stringify(input) }]);
    assert.equal(JSON.parse(requests[1].messages.at(-1).content).userMessage, input.userMessage);
    assert(requests[1].messages[0].content.includes("不是用户需求"));
  });
});

test("diagnostic narration is rejected then regenerated before display", async () => {
  const bad = F.output(input), good = F.output(input);
  bad.assistantMessage = leak;
  await generate([bad, good], async (promise, requests) => {
    assert.equal((await promise).assistantMessage, good.assistantMessage);
    assert.equal(requests.length, 2);
  });
});

test("repeated diagnostic narration fails closed instead of becoming a successful response", async () => {
  const bad = F.output(input); bad.assistantMessage = leak;
  await generate([bad], async (promise, requests) => {
    await assert.rejects(promise, { code: "INTERNAL_RESPONSE" });
    assert.equal(requests.length, 2);
  });
});

test("native timeout becomes a recoverable model timeout, not numeric DOM error 23", async t => {
  t.mock.method(globalThis, "fetch", async () => { throw new DOMException("Timed out", "TimeoutError"); });
  const settings = { REQUIREMENT_MODEL_BASE_URL: "http://127.0.0.1/unused", REQUIREMENT_MODEL_API_KEY: "fixture-key", REQUIREMENT_MODEL: "fixture-model" };
  const previous = Object.fromEntries(Object.keys(settings).map(key => [key, process.env[key]]));
  Object.assign(process.env, settings);
  try { await assert.rejects(new Analyzer().run(input, resources), { code: "MODEL_TIMEOUT" }); }
  finally { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
});

test("internal text in questions, reasons, and solution panels is blocked", () => {
  for (const mutate of [value => { value.openQuestions[0].text = leak; }, value => { value.recommendation.explanation = leak; }, value => { value.solutionProposal.direction = leak; }]) {
    const bad = F.output(input); mutate(bad);
    assert.throws(() => C.checkOutput(bad, input), { code: "INTERNAL_RESPONSE" });
  }
  for (const text of ["已修正评分，其余业务事实保持不变。", "已按各维度权重重新计算分数。", "Fixed the weighted score; business facts unchanged."]) assert(P.isInternalMessage(text), text);
});

test("ordinary product requests about JSON, scores, and editing fields remain allowed", () => {
  for (const message of ["你希望导出的 JSON 包含哪些信息？", "你希望如何展示需求完整度评分？", "你希望任务名称可以修改，还是希望增加新的输入字段？"]) {
    const value = F.output(input); value.assistantMessage = message;
    assert.equal(C.checkOutput(value, input).assistantMessage, message);
  }
});

test("legacy diagnostic replies are hidden without editing user input or stored business facts", () => {
  const value = F.output(input); value.assistantMessage = leak;
  const turns = [{ role: "user", message: leak }, { role: "assistant", message: leak }];
  const original = structuredClone({ value, turns });
  const shown = P.displayTurns(turns, value);
  assert.equal(shown[0].message, leak);
  assert.equal(shown[1].message, value.openQuestions[0].text);
  assert.equal(P.displayAnalysis(value).assistantMessage, value.openQuestions[0].text);
  assert.deepEqual({ value, turns }, original);
  const history = [...turns, { role: "user", message: input.userMessage }];
  assert.deepEqual(P.displayTurns(history, value), [history[0], history[2]]);
});
