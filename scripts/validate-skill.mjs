#!/usr/bin/env node

import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultSkillRoot = resolve(repoRoot, "skills/behavior-debug-board");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export async function validateSkill(skillRoot = defaultSkillRoot) {
  const files = {
    skill: resolve(skillRoot, "SKILL.md"),
    manifest: resolve(skillRoot, "agents/openai.yaml"),
    launcher: resolve(skillRoot, "scripts/behavior-debug-board.mjs"),
    qa: resolve(skillRoot, "scripts/qa-board.mjs"),
    schema: resolve(skillRoot, "references/board-schema.md"),
    logoMcp: resolve(skillRoot, "references/logo-mcp.md"),
    rendering: resolve(skillRoot, "references/rendering-stack.md"),
    firebase: resolve(skillRoot, "assets/logos/firebase.svg"),
    firestore: resolve(skillRoot, "assets/logos/firestore.svg"),
  };

  const categoryIconNames = [
    "app-window", "smartphone", "braces", "database", "key-round", "hard-drive", "server", "credit-card",
    "chart-no-axes-column-increasing", "message-square", "network", "shield-check", "cloud", "workflow", "webhook", "bot", "boxes",
  ];
  const categoryIconFiles = categoryIconNames.map((name) => resolve(repoRoot, `public/icons/${name}.svg`));

  await Promise.all([...Object.values(files), ...categoryIconFiles].map((file) => access(file)));
  const [skill, manifest, resolver, logoMcp] = await Promise.all([
    readFile(files.skill, "utf8"),
    readFile(files.manifest, "utf8"),
    readFile(resolve(repoRoot, "skills/RESOLVER.md"), "utf8"),
    readFile(files.logoMcp, "utf8"),
  ]);

  const frontmatter = skill.match(/^---\n([\s\S]*?)\n---\n/);
  assert(frontmatter, "SKILL.md requires YAML frontmatter");
  const frontmatterKeys = [...frontmatter[1].matchAll(/^([a-z_]+):/gm)].map((match) => match[1]);
  assert(frontmatterKeys.length === 2 && frontmatterKeys.includes("name") && frontmatterKeys.includes("description"), "SKILL.md frontmatter must contain only name and description");
  assert(/^name: behavior-debug-board$/m.test(frontmatter[1]), "skill name must match its directory");
  assert(/Start localhost, wait for a healthy response, and open the board/.test(skill), "skill contract must require opening localhost");
  assert(/Producing JSON without opening the board is incomplete/.test(skill), "skill must reject JSON-only completion");
  assert(/BOARD_RENDERED/.test(skill) && /BOARD_QA_PASS/.test(skill), "skill contract must distinguish server and render readiness");
  assert(/--full/.test(skill), "skill must document full renderer regression QA");
  assert(/value: "thesvg"/.test(manifest), "agents/openai.yaml must declare the Logo MCP dependency");
  assert(/allow_implicit_invocation: true/.test(manifest), "skill must allow implicit routing");
  assert(/behavior-debug-board/.test(resolver) && /本地端動態 Board/.test(resolver), "resolver entry is missing");
  assert(/Search the web/.test(logoMcp), "logo fallback must search the web after MCP misses");
  assert(/categoryIcon/.test(logoMcp), "logo fallback must define category icons");
  assert(/Never redraw, recolor, approximate, or generate a brand logo/.test(logoMcp), "logo fallback must prohibit invented brand marks");

  return { skillRoot, files: Object.keys(files).length, categoryIcons: categoryIconFiles.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  validateSkill(process.argv[2])
    .then(({ skillRoot, files }) => console.log(`SKILL_VALID ${skillRoot} (${files} required resources)`))
    .catch((error) => {
      console.error(`SKILL_ERROR ${error.message}`);
      process.exitCode = 1;
    });
}
