#!/usr/bin/env node
/** Validate the structure and links in the curated README. */

import { main } from "../src/cli.ts";

process.exitCode = await main(process.argv.slice(2));
