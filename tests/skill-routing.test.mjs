import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { validateSkill } from "../scripts/validate-skill.mjs";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const skillRoot = resolve(repoRoot, "skills/difftale");

test("skill package has the required contract, resources, resolver, and Logo MCP", async () => {
  const result = await validateSkill(skillRoot);
  assert.equal(result.files, 17);
  assert.equal(result.categoryIcons, 17);
});

test("routing eval covers real positive and negative user language", async () => {
  const text = await readFile(resolve(skillRoot, "routing-eval.jsonl"), "utf8");
  const cases = text.trim().split("\n").map((line) => JSON.parse(line));

  assert.ok(cases.filter((entry) => entry.should_route).length >= 4);
  assert.ok(cases.filter((entry) => !entry.should_route).length >= 2);
  assert.ok(cases.some((entry) => /本地.*board/i.test(entry.prompt)));
  assert.ok(cases.some((entry) => /before.*after/i.test(entry.prompt)));
  assert.ok(cases.some((entry) => /回傳|response/i.test(entry.prompt)));
  assert.ok(cases.some((entry) => /上一版|版本/.test(entry.prompt) && /比較|恢復/.test(entry.prompt)));
  assert.ok(cases.some((entry) => /App.*截圖|畫面.*操作路徑/i.test(entry.prompt)));
});

test("LLM quality evals require behavior synthesis and an opened local board", async () => {
  const text = await readFile(resolve(skillRoot, "llm-evals.jsonl"), "utf8");
  const cases = text.trim().split("\n").map((line) => JSON.parse(line));

  assert.ok(cases.length >= 3);
  for (const entry of cases) {
    if (entry.name === "git-choice-gate") {
      assert.ok(entry.expected.some((expectation) => /Git 版控.*只存本機.*取消/i.test(expectation)));
      assert.ok(entry.expected.some((expectation) => /不會自動 push/i.test(expectation)));
      continue;
    }
    if (entry.name === "version-compare-restore") {
      assert.ok(entry.expected.some((expectation) => /新增.*移除.*修改.*移動/.test(expectation)));
      assert.ok(entry.expected.some((expectation) => /自動備份/.test(expectation)));
      continue;
    }
    if (entry.name === "app-screen-flow") {
      assert.ok(entry.expected.some((expectation) => /kind screen/.test(expectation)));
      assert.ok(entry.expected.some((expectation) => /assets\/screens/.test(expectation)));
    }
    assert.ok(entry.expected.some((expectation) => /localhost|本地端 Board/i.test(expectation)));
    assert.ok(entry.expected.some((expectation) => /Before.*After|behavior/i.test(expectation)));
  }
});

test("unknown brands escalate from web search to a category icon without inventing a logo", async () => {
  const workflow = await readFile(resolve(skillRoot, "references/logo-mcp.md"), "utf8");
  assert.match(workflow, /official logo.*brand assets.*media kit.*brand guidelines/);
  assert.match(workflow, /trusted vector registries/);
  assert.match(workflow, /use `categoryIcon`/);
  assert.match(workflow, /Never redraw, recolor, approximate, or generate a brand logo/);
});
