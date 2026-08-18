#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  boardSha256,
  canonicalBoardSource,
  createBoardRevision,
  diffBoardRevision,
  listBoardRevisions,
  restoreBoardRevision,
} from "./board-version-store.mjs";

function fail(message) {
  throw new Error(message);
}

function parseArguments(argv) {
  const command = argv[0] ?? "list";
  const options = { command, configPath: undefined, storageMode: "local", title: undefined, revisionId: undefined };
  for (let index = 1; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!["--config", "--storage", "--title", "--revision"].includes(flag) || !value) fail(`unknown or incomplete option: ${flag}`);
    index += 1;
    if (flag === "--config") options.configPath = resolve(value);
    if (flag === "--storage") {
      if (!["git", "local"].includes(value)) fail("--storage must be git or local");
      options.storageMode = value;
    }
    if (flag === "--title") options.title = value;
    if (flag === "--revision") options.revisionId = value;
  }
  if (!options.configPath) fail("--config is required");
  return options;
}

export async function runBoardVersionCli(argv) {
  const options = parseArguments(argv);
  if (options.command === "list") {
    const result = await listBoardRevisions(options);
    console.log(JSON.stringify(result, null, 2));
    return result;
  }
  if (options.command === "create") {
    const revision = await createBoardRevision(options);
    console.log(`BOARD_VERSION_CREATED ${revision.id} ${revision.title}`);
    return revision;
  }
  if (options.command === "diff") {
    if (!options.revisionId) fail("diff requires --revision");
    const diff = await diffBoardRevision(options);
    console.log(JSON.stringify(diff, null, 2));
    return diff;
  }
  if (options.command === "restore") {
    if (!options.revisionId) fail("restore requires --revision");
    const current = JSON.parse(await readFile(options.configPath, "utf8"));
    const baseHash = boardSha256(canonicalBoardSource(current));
    const result = await restoreBoardRevision({ ...options, baseHash });
    console.log(`BOARD_VERSION_RESTORED ${options.revisionId} sha256=${result.sha256}`);
    return result;
  }
  fail("command must be list, create, diff, or restore");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runBoardVersionCli(process.argv.slice(2)).catch((error) => {
    console.error(`BOARD_VERSION_ERROR ${error.message}`);
    process.exitCode = 1;
  });
}
