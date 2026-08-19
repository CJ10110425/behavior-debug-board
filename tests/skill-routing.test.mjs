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
  assert.ok(result.privacyFiles >= 10);
});

test("reusable skill keeps personal project evidence out of public fixtures", async () => {
  const skill = await readFile(resolve(skillRoot, "SKILL.md"), "utf8");
  const fanout = JSON.parse(await readFile(resolve(skillRoot, "assets/fanout-board.json"), "utf8"));
  assert.match(skill, /Never copy a user's product, company, repository/);
  assert.match(skill, /role-based names and behavioral summaries/);
  for (const edge of fanout.flows.flatMap((flow) => flow.edges)) {
    assert.doesNotMatch(edge.label, /\b(?:GET|POST|PUT|PATCH|DELETE)\s+\/|\/[a-z0-9_-]+\/[a-z0-9_-]+/i);
  }
});

test("routing eval covers real positive and negative user language", async () => {
  const text = await readFile(resolve(skillRoot, "routing-eval.jsonl"), "utf8");
  const cases = text.trim().split("\n").map((line) => JSON.parse(line));

  assert.ok(cases.filter((entry) => entry.should_route).length >= 4);
  assert.ok(cases.filter((entry) => !entry.should_route).length >= 2);
  assert.ok(cases.some((entry) => /local.*board/i.test(entry.prompt)));
  assert.ok(cases.some((entry) => /before.*after/i.test(entry.prompt)));
  assert.ok(cases.some((entry) => /回傳|response/i.test(entry.prompt)));
  assert.ok(cases.some((entry) => /previous version/i.test(entry.prompt) && /compare/i.test(entry.prompt)));
  assert.ok(cases.some((entry) => /Capture.*app|screen/i.test(entry.prompt)));
  assert.ok(cases.filter((entry) => entry.should_route && /[一-龥]/.test(entry.prompt)).length >= 2);
  assert.ok(cases.filter((entry) => entry.should_route && !/[一-龥]/.test(entry.prompt)).length > cases.filter((entry) => entry.should_route && /[一-龥]/.test(entry.prompt)).length);
});

test("LLM quality evals require behavior synthesis and an opened local board", async () => {
  const text = await readFile(resolve(skillRoot, "llm-evals.jsonl"), "utf8");
  const cases = text.trim().split("\n").map((line) => JSON.parse(line));

  assert.ok(cases.length >= 3);
  for (const entry of cases) {
    if (entry.name === "git-choice-gate") {
      assert.ok(entry.expected.some((expectation) => /Git versioning.*local-only.*cancel/i.test(expectation)));
      assert.ok(entry.expected.some((expectation) => /never push automatically/i.test(expectation)));
      continue;
    }
    if (entry.name === "version-compare-restore") {
      assert.ok(entry.expected.some((expectation) => /Added.*Removed.*Changed.*Moved/.test(expectation)));
      assert.ok(entry.expected.some((expectation) => /automatic.*backup/i.test(expectation)));
      continue;
    }
    if (entry.name === "traditional-chinese-screen-flow") {
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

test("screen workflow inspects project layout before using screenshot geometry", async () => {
  const workflow = await readFile(resolve(skillRoot, "references/screenshots.md"), "utf8");
  assert.match(workflow, /Project code and the actual screen layout/);
  assert.match(workflow, /React Native, Expo, Flutter, SwiftUI/);
  assert.match(workflow, /responsive web page captured at a phone viewport uses `mobile`/);
  assert.match(workflow, /Ask the user when code, viewport, and dimensions disagree/);
});

test("public surfaces are English-first with Traditional Chinese retained as a secondary language", async () => {
  const [readme, skill, page, example, fanout] = await Promise.all([
    readFile(resolve(repoRoot, "README.md"), "utf8"),
    readFile(resolve(skillRoot, "SKILL.md"), "utf8"),
    readFile(resolve(repoRoot, "app/page.tsx"), "utf8"),
    readFile(resolve(skillRoot, "assets/example-board.json"), "utf8"),
    readFile(resolve(skillRoot, "assets/fanout-board.json"), "utf8"),
  ]);

  assert.match(readme, /\*\*English\*\* · \[繁體中文\]/);
  assert.match(skill, /English-first/);
  assert.match(page, /params\.get\("lang"\) === "zh-TW"/);
  assert.match(page, /createContext<UiLocale>\("en"\)/);
  assert.doesNotMatch(example, /[一-龥]/);
  assert.doesNotMatch(fanout, /[一-龥]/);
});
