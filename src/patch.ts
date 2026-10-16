import type { TargetFile } from "./navigation.ts";

export interface PatchFile extends TargetFile {
  /** Added plus deleted lines, as counted by `git diff --numstat`. */
  changedLines: number;
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const C_ESCAPES: Record<string, number> = {
  a: 7,
  b: 8,
  t: 9,
  n: 10,
  v: 11,
  f: 12,
  r: 13,
  '"': 34,
  "\\": 92,
};

/** Decode Git's C-style quoted path, including octal UTF-8 bytes. */
function unquote(value: string): string {
  if (value.length < 2 || !value.startsWith('"') || !value.endsWith('"')) return value;
  const body = value.slice(1, -1);
  const encoder = new TextEncoder();
  const bytes: number[] = [];
  for (let index = 0; index < body.length; index += 1) {
    if (body[index] !== "\\") {
      const char = String.fromCodePoint(body.codePointAt(index)!);
      bytes.push(...encoder.encode(char));
      index += char.length - 1;
      continue;
    }
    const octal = /^[0-7]{3}/.exec(body.slice(index + 1));
    if (octal) {
      bytes.push(Number.parseInt(octal[0], 8));
      index += 3;
    } else {
      const next = body[index + 1] ?? "\\";
      bytes.push(C_ESCAPES[next] ?? next.charCodeAt(0));
      index += 1;
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

/** Parse a `---`/`+++` path; `null` means /dev/null. */
function markerPath(raw: string, prefix: string): string | null {
  // Git separates a trailing tab before optional metadata; quoted paths escape real tabs.
  const value = unquote(raw.split("\t")[0]!);
  if (value === "/dev/null") return null;
  return value.startsWith(prefix) ? value.slice(prefix.length) : value;
}

/** Recover the path from `diff --git a/<path> b/<path>` when no other header names it. */
function gitHeaderPath(line: string): string | undefined {
  const rest = line.slice("diff --git ".length);
  if (rest.startsWith('"')) {
    const end = rest.indexOf('" ');
    const path = end === -1 ? undefined : unquote(rest.slice(0, end + 1));
    return path?.startsWith("a/") ? path.slice(2) : path;
  }
  const length = (rest.length - 5) / 2;
  if (!Number.isInteger(length) || length < 1) return undefined;
  const oldPath = rest.slice(2, 2 + length);
  return rest.startsWith("a/") && rest.slice(length + 2) === ` b/${oldPath}` ? oldPath : undefined;
}

/** Match Hunk's public hunk ranges: a side with no lines still spans its anchor line. */
function sideRange(start: string, count: string | undefined): [number, number] {
  const lines = count === undefined ? 1 : Number(count);
  return [Number(start), Number(start) + Math.max(lines, 1) - 1];
}

function parseFile(section: string): PatchFile {
  const lines = section.split("\n");
  const firstHunk = lines.findIndex((line) => line.startsWith("@@ "));
  const header = firstHunk === -1 ? lines : lines.slice(0, firstHunk);
  let oldPath: string | null | undefined;
  let newPath: string | null | undefined;
  for (const line of header) {
    if (line.startsWith("--- ")) oldPath = markerPath(line.slice(4), "a/");
    else if (line.startsWith("+++ ")) newPath = markerPath(line.slice(4), "b/");
    else if (line.startsWith("rename from ")) oldPath = unquote(line.slice(12));
    else if (line.startsWith("rename to ")) newPath = unquote(line.slice(10));
    else if (line.startsWith("copy from ")) oldPath = unquote(line.slice(10));
    else if (line.startsWith("copy to ")) newPath = unquote(line.slice(8));
  }
  const fallback = gitHeaderPath(lines[0]!);
  const path = newPath ?? oldPath ?? fallback;
  if (!path) throw new Error(`could not read the file path from: ${lines[0]}`);
  const previousPath = oldPath && newPath && oldPath !== newPath ? oldPath : undefined;

  const body = firstHunk === -1 ? [] : lines.slice(firstHunk);
  const hunks = body.flatMap((line) => {
    const match = HUNK_HEADER.exec(line);
    return match ? [{ line, match }] : [];
  });
  return {
    path,
    ...(previousPath ? { previousPath } : {}),
    changedLines: body.filter((line) => line.startsWith("+") || line.startsWith("-")).length,
    hunks: hunks.map(({ line, match }, index) => ({
      index,
      header: line,
      oldRange: sideRange(match[1]!, match[2]),
      newRange: sideRange(match[3]!, match[4]),
    })),
  };
}

/** Parse Git-style unified diff text into files and their changed hunk ranges. */
export function parsePatch(text: string): PatchFile[] {
  const normalized = text.replaceAll("\r\n", "\n");
  const sections = normalized
    .split(/^(?=diff --git )/m)
    .filter((part) => part.startsWith("diff --git "));
  if (sections.length === 0 && normalized.trim()) {
    throw new Error("expected a Git-style unified diff with `diff --git` headers");
  }
  return sections.map(parseFile);
}
