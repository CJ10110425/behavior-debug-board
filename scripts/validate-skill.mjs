#!/usr/bin/env node

import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultSkillRoot = resolve(repoRoot, "skills/difftale");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export async function validateSkill(skillRoot = defaultSkillRoot) {
  const files = {
    skill: resolve(skillRoot, "SKILL.md"),
    manifest: resolve(skillRoot, "agents/openai.yaml"),
    launcher: resolve(skillRoot, "scripts/difftale.mjs"),
    saveServer: resolve(skillRoot, "scripts/save-board-server.mjs"),
    versionCli: resolve(skillRoot, "scripts/board-version.mjs"),
    versionStore: resolve(skillRoot, "scripts/board-version-store.mjs"),
    qa: resolve(skillRoot, "scripts/qa-board.mjs"),
    schema: resolve(skillRoot, "references/board-schema.md"),
    screenshots: resolve(skillRoot, "references/screenshots.md"),
    storage: resolve(skillRoot, "references/local-storage-and-git.md"),
    versions: resolve(skillRoot, "references/version-history.md"),
    logoMcp: resolve(skillRoot, "references/logo-mcp.md"),
    rendering: resolve(skillRoot, "references/rendering-stack.md"),
    fanout: resolve(skillRoot, "assets/fanout-board.json"),
    firebase: resolve(skillRoot, "assets/logos/firebase.svg"),
    firestore: resolve(skillRoot, "assets/logos/firestore.svg"),
    cloudRun: resolve(skillRoot, "assets/logos/cloud-run.svg"),
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
  assert(/^name: difftale$/m.test(frontmatter[1]), "skill name must match its directory");
  assert(/Start localhost, wait for a healthy response, and open the board/.test(skill), "skill contract must require opening localhost");
  assert(/Producing JSON without opening the board is incomplete/.test(skill), "skill must reject JSON-only completion");
  assert(/BOARD_RENDERED/.test(skill) && /BOARD_QA_PASS/.test(skill), "skill contract must distinguish server and render readiness");
  assert(/--full/.test(skill), "skill must document full renderer regression QA");
  assert(/Git.*choice gate|Git\/local-only choice gate/.test(skill), "skill must require an upfront Git choice gate");
  assert(/Browser memory or `localStorage` is never the sole copy/.test(skill), "skill must require durable local persistence");
  assert(/semantic|semantically/i.test(skill) && /restore/i.test(skill), "skill must document semantic version diff and restore");
  assert(/version-history\.md/.test(skill), "skill must route version requests to the version-history reference");
  assert(/kind: `screen`|`kind: "screen"`/.test(skill) && /screenshots\.md/.test(skill), "skill must model screenshots as first-class screen nodes");
  assert(/project layout\/platform code/.test(skill) && /Ask the user when evidence conflicts/.test(skill), "skill must inspect layout code and confirm ambiguous screen frames");
  assert(/value: "thesvg"/.test(manifest), "agents/openai.yaml must declare the Logo MCP dependency");
  assert(/allow_implicit_invocation: true/.test(manifest), "skill must allow implicit routing");
  assert(/difftale/.test(resolver) && /畫面/.test(resolver) && /本地端動態 Board/.test(resolver), "resolver entry is missing");
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
