#!/usr/bin/env -S deno run --allow-read
/**
 * @module
 *
 * CLI script to convert a Mermaid stateDiagram-v2 file to TypeScript FSM config.
 *
 * This CLI tool enables diagram-driven development by converting visual Mermaid
 * state diagrams into ready-to-use TypeScript FSM configurations with TODO placeholders.
 *
 * @example Usage via deno task
 * ```sh
 * deno task mermaid-to-typescript --infile my-fsm.mermaid
 * deno task mermaid-to-typescript --infile my-fsm.mermaid | pbcopy
 * ```
 *
 * @example Direct usage
 * ```sh
 * deno run --allow-read jsr:@marianmeres/fsm/mermaid-to-typescript --infile diagram.mermaid
 * ```
 *
 * Options:
 * - `--infile <path>` - Path to the Mermaid diagram file (required)
 * - `--json` - Output JSON instead of TypeScript
 * - `--indent <str>` - Indentation for TypeScript output (default: "\t")
 * - `--name <str>` - Config variable name for TypeScript output (default: "config")
 * - `--help` - Show help message
 */

import { parseArgs } from "@std/cli/parse-args";
import { fromMermaid, toTypeScript } from "@marianmeres/fsm";

const args = parseArgs(Deno.args, {
	string: ["infile", "indent", "name"],
	boolean: ["help", "json"],
	default: {
		indent: "\t",
		name: "config",
	},
});

if (args.help) {
	console.log(`
mermaid-to-typescript - Convert Mermaid stateDiagram-v2 to TypeScript FSM config

Usage:
  deno run --allow-read scripts/mermaid-to-typescript.ts --infile <path> [options]

Options:
  --infile <path>   Path to the Mermaid diagram file (required)
  --json            Output JSON instead of TypeScript
  --indent <str>    Indentation string (default: "\\t")
  --name <str>      Config variable name (default: "config")
  --help            Show this help message

Examples:
  # Output TypeScript to stdout
  deno run --allow-read scripts/mermaid-to-typescript.ts --infile my-fsm.mermaid

  # Copy TypeScript to clipboard (macOS)
  deno run --allow-read scripts/mermaid-to-typescript.ts --infile my-fsm.mermaid | pbcopy

  # Output JSON config
  deno run --allow-read scripts/mermaid-to-typescript.ts --infile my-fsm.mermaid --json

  # Custom indentation and variable name
  deno run --allow-read scripts/mermaid-to-typescript.ts --infile my-fsm.mermaid --indent "  " --name "myConfig"
`);
	Deno.exit(0);
}

if (!args.infile) {
	console.error("Error: --infile is required");
	console.error("Run with --help for usage information");
	Deno.exit(1);
}

try {
	const mermaidContent = await Deno.readTextFile(args.infile);

	if (args.json) {
		const config = fromMermaid(mermaidContent);
		console.log(JSON.stringify(config, null, args.indent === "\t" ? "\t" : 2));
	} else {
		const tsCode = toTypeScript(mermaidContent, {
			indent: args.indent,
			configName: args.name,
		});
		console.log(tsCode);
	}
} catch (error) {
	if (error instanceof Deno.errors.NotFound) {
		console.error(`Error: File not found: ${args.infile}`);
		Deno.exit(1);
	}
	console.error(`Error: ${error instanceof Error ? error.message : error}`);
	Deno.exit(1);
}
