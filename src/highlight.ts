import type { ExtensionDiffFile, ExtensionLineHighlight } from "hunkdiff/extension";

import type { GuideTarget } from "./model.ts";

export function targetHighlights(
  file: Pick<ExtensionDiffFile, "path" | "previousPath" | "patch">,
  target: GuideTarget,
): readonly ExtensionLineHighlight[] {
  const path = target.side === "old" ? (file.previousPath ?? file.path) : file.path;
  if (path !== target.path) return [];

  const marks: ExtensionLineHighlight[] = [];
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;
  for (const raw of file.patch.split("\n")) {
    const header = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (header) {
      oldLine = Number(header[1]);
      newLine = Number(header[2]);
      inHunk = true;
      continue;
    }
    if (!inHunk || raw.startsWith("+++") || raw.startsWith("---")) continue;

    const marker = raw[0];
    if (marker !== " " && marker !== "+" && marker !== "-") continue;
    const text = raw.slice(1);
    const line = target.side === "old" ? oldLine : newLine;
    const existsOnSide =
      (target.side === "old" && marker !== "+") || (target.side === "new" && marker !== "-");
    if (existsOnSide && text.length > 0 && line >= target.startLine && line <= target.endLine) {
      marks.push({
        side: target.side,
        line,
        range: [0, text.length],
        tone: "current",
      });
    }

    if (marker !== "+") oldLine += 1;
    if (marker !== "-") newLine += 1;
  }
  return marks;
}
