#!/usr/bin/env bun
// Create a throwaway Git repository with an example's change left uncommitted.
//
//   eval "$(bun examples/sandbox.ts <example> [agent command...])"
//
// Prints shell lines that enter the sandbox and export HUNK_GUIDE_ROOT. With an agent
// command, also exports HUNK_GUIDE_COMMAND for bin/agent-provider.ts.
import { spawnSync } from "node:child_process";
import { appendFileSync, copyFileSync, existsSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const EXAMPLES = import.meta.dir;
const ROOT = dirname(EXAMPLES);

/** Earlier examples committed before an example's own change is applied. */
const BASES: Record<string, readonly string[]> = {
  "04-guide-your-change": ["03-live-review"],
};

function git(directory: string, args: string[]) {
  const result = spawnSync(
    "git",
    [
      "-c",
      "user.name=Demo",
      "-c",
      "user.email=demo@example.invalid",
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "commit.gpgSign=false",
      ...args,
    ],
    { cwd: directory, encoding: "utf8" },
  );
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr.trim()}`);
}

/** Create the sandbox in a new temporary directory and return its path. */
export function createSandbox(example: string): string {
  const patch = join(EXAMPLES, example, "review.patch");
  if (!existsSync(patch)) throw new Error(`unknown example: ${example}`);
  const directory = mkdtempSync(join(tmpdir(), `hunk-guide-${example}-`));
  git(directory, ["init", "-q"]);
  git(directory, ["config", "core.autocrlf", "false"]);
  mkdirSync(join(directory, ".git", "info"), { recursive: true });
  appendFileSync(join(directory, ".git", "info", "exclude"), ".hunk/\n");
  git(directory, ["commit", "-q", "--allow-empty", "-m", "Start demo"]);
  for (const base of BASES[example] ?? []) {
    git(directory, ["apply", join(EXAMPLES, base, "review.patch")]);
    git(directory, ["add", "-A"]);
    git(directory, ["commit", "-q", "-m", `Apply ${base}`]);
  }
  git(directory, ["apply", patch]);
  git(directory, ["add", "-N", "."]);
  const guide = join(EXAMPLES, example, "guide.json");
  if (existsSync(guide)) {
    mkdirSync(join(directory, ".hunk"));
    copyFileSync(guide, join(directory, ".hunk", "guide.json"));
  }
  return directory;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

if (import.meta.main) {
  const [example, ...agent] = process.argv.slice(2);
  try {
    if (!example) throw new Error("usage: sandbox.ts <example> [agent command...]");
    const name = example.replace(/\/$/, "").split("/").at(-1)!;
    const directory = createSandbox(name);
    const provider = ["bun", resolve(ROOT, "bin", "agent-provider.ts"), ...agent];
    console.error(`Sandbox: ${directory}`);
    console.log(`cd ${shellQuote(directory)}`);
    console.log(`export HUNK_GUIDE_ROOT=${shellQuote(ROOT)}`);
    if (agent.length)
      console.log(`export HUNK_GUIDE_COMMAND=${shellQuote(JSON.stringify(provider))}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
