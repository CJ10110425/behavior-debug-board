#!/usr/bin/env node

import { main } from "../../difftale/scripts/difftale.mjs";

main(process.argv.slice(2)).catch((error) => {
  console.error(`BOARD_ERROR ${error.message}`);
  process.exitCode = 1;
});
