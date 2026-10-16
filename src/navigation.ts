import type {
  ExtensionDiffFile,
  ExtensionReviewNavigation,
  ExtensionReviewSnapshot,
} from "hunkdiff/extension";

import { guideTargetDefinition, type GuideDocument, type GuideTarget } from "./model.ts";

export interface TargetFingerprint {
  definition: string;
  patch?: string;
  content?: string;
}

export interface ResolvedTarget {
  status: "resolved";
  targetId: string;
  runtimeId: string;
  filePath: string;
  hunkIndex: number;
  fingerprint: TargetFingerprint;
}

export interface UnresolvedTarget {
  status: "missing-file" | "ambiguous-file" | "missing-line";
  targetId: string;
  fingerprint: TargetFingerprint;
}

export type TargetResolution = ResolvedTarget | UnresolvedTarget;

export interface ReviewFileState {
  path: string;
  previousPath?: string;
  runtimeId: string;
  fingerprint: TargetFingerprint;
}

export interface GuideResolution {
  targets: ReadonlyMap<string, TargetResolution>;
  files: readonly ReviewFileState[];
}

function hashText(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function patchFingerprint(
  file: Pick<ExtensionDiffFile, "path" | "previousPath" | "patch">,
): string {
  return hashText(`${file.previousPath ?? ""}\u0000${file.path}\u0000${file.patch}`);
}

function targetPath(file: Pick<ExtensionDiffFile, "path" | "previousPath">, target: GuideTarget) {
  return target.side === "old" ? (file.previousPath ?? file.path) : file.path;
}

function resolveTarget(target: GuideTarget, files: readonly ExtensionDiffFile[]): TargetResolution {
  const definition = guideTargetDefinition(target);
  const matches = files.filter((file) => targetPath(file, target) === target.path);
  if (matches.length === 0) {
    return { status: "missing-file", targetId: target.id, fingerprint: { definition } };
  }
  if (matches.length > 1) {
    return { status: "ambiguous-file", targetId: target.id, fingerprint: { definition } };
  }

  const file = matches[0]!;
  const fingerprint = { definition, patch: patchFingerprint(file) };
  const containingHunks = (file.hunks ?? []).filter((hunk) => {
    const range = target.side === "old" ? hunk.oldRange : hunk.newRange;
    return range && target.startLine >= range[0] && target.endLine <= range[1];
  });
  if (containingHunks.length !== 1) {
    return { status: "missing-line", targetId: target.id, fingerprint };
  }

  return {
    status: "resolved",
    targetId: target.id,
    runtimeId: file.id,
    filePath: file.path,
    hunkIndex: containingHunks[0]!.index,
    fingerprint,
  };
}

export function resolveGuide(
  guide: GuideDocument,
  files: readonly ExtensionDiffFile[],
): GuideResolution {
  const targets = new Map<string, TargetResolution>();
  for (const section of guide.sections) {
    for (const target of section.targets) targets.set(target.id, resolveTarget(target, files));
  }

  return {
    targets,
    files: files.map((file) => ({
      path: file.path,
      previousPath: file.previousPath,
      runtimeId: file.id,
      fingerprint: {
        definition: `${file.previousPath ?? ""}\u0000${file.path}`,
        patch: patchFingerprint(file),
      },
    })),
  };
}

/** The file fields needed to check targets; satisfied by Hunk files, provider requests, and parsed patches. */
export type TargetFile = Pick<ExtensionDiffFile, "path" | "previousPath" | "hunks">;

export interface TargetError {
  /** Field path relative to the guide document, such as `sections[0].targets[1].startLine`. */
  field: string;
  targetId: string;
  message: string;
}

const MAX_LISTED_RANGES = 8;

function formatRanges(ranges: readonly (readonly [number, number])[]): string {
  const listed = ranges
    .slice(0, MAX_LISTED_RANGES)
    .map(([start, end]) => (start === end ? `${start}` : `${start}-${end}`));
  if (ranges.length > MAX_LISTED_RANGES) listed.push("…");
  return listed.join(", ");
}

function explainTarget(
  target: GuideTarget,
  files: readonly TargetFile[],
): { field: string; message: string } | undefined {
  const matches = files.filter((file) => targetPath(file, target) === target.path);
  if (matches.length === 0) {
    const otherSide = target.side === "old" ? "new" : "old";
    const onOtherSide = files.some(
      (file) => targetPath(file, { ...target, side: otherSide }) === target.path,
    );
    return {
      field: "path",
      message: `no ${target.side}-side file ${target.path}${onOtherSide ? ` (it exists on the ${otherSide} side)` : ""}`,
    };
  }
  if (matches.length > 1) {
    return { field: "path", message: `ambiguous ${target.side}-side file ${target.path}` };
  }

  const ranges = (matches[0]!.hunks ?? [])
    .map((hunk) => (target.side === "old" ? hunk.oldRange : hunk.newRange))
    .filter((range): range is [number, number] => Boolean(range && range[0] >= 1));
  const lines = `lines ${target.startLine}-${target.endLine}`;
  if (ranges.length === 0) {
    return { field: "side", message: `${target.path} has no ${target.side}-side changed lines` };
  }
  const containing = ranges.filter(
    ([start, end]) => target.startLine >= start && target.endLine <= end,
  );
  if (containing.length === 1) return undefined;
  const intersecting = ranges.filter(
    ([start, end]) => start <= target.endLine && target.startLine <= end,
  );
  return {
    field: "startLine",
    message:
      intersecting.length > 1
        ? `${lines} cross ${target.side}-side hunks ${formatRanges(intersecting)} in ${target.path}`
        : `${lines} are outside the ${target.side}-side hunks of ${target.path} (${formatRanges(ranges)})`,
  };
}

/** Explain every target that does not fit inside exactly one changed hunk on its side. */
export function findTargetErrors(
  guide: GuideDocument,
  files: readonly TargetFile[],
): TargetError[] {
  const errors: TargetError[] = [];
  for (const [sectionIndex, section] of guide.sections.entries()) {
    for (const [targetIndex, target] of section.targets.entries()) {
      const problem = explainTarget(target, files);
      if (!problem) continue;
      errors.push({
        field: `sections[${sectionIndex}].targets[${targetIndex}].${problem.field}`,
        targetId: target.id,
        message: problem.message,
      });
    }
  }
  return errors;
}

function snapshotPathMatches(
  file: ExtensionReviewSnapshot["files"][number],
  target: GuideTarget,
): boolean {
  return (target.side === "old" ? (file.previousPath ?? file.path) : file.path) === target.path;
}

export function enrichResolutionFromSnapshot(
  guide: GuideDocument,
  resolution: GuideResolution,
  snapshot: ExtensionReviewSnapshot,
): GuideResolution {
  const targets = new Map(resolution.targets);
  for (const section of guide.sections) {
    for (const target of section.targets) {
      const current = targets.get(target.id);
      const matches = snapshot.files.filter((file) => snapshotPathMatches(file, target));
      if (!current || matches.length !== 1) continue;
      const file = matches[0]!;
      targets.set(target.id, {
        ...current,
        ...(current.status === "resolved" ? { runtimeId: file.runtimeId } : {}),
        fingerprint: {
          ...current.fingerprint,
          content: file.contentIdentity,
        },
      });
    }
  }

  const files = resolution.files.map((current) => {
    const match = snapshot.files.find(
      (file) => file.path === current.path && file.previousPath === current.previousPath,
    );
    return match
      ? {
          ...current,
          runtimeId: match.runtimeId,
          fingerprint: { ...current.fingerprint, content: match.contentIdentity },
        }
      : current;
  });

  return { targets, files };
}

export function revealTarget(
  target: GuideTarget,
  resolution: TargetResolution | undefined,
  navigation: ExtensionReviewNavigation,
): boolean {
  if (!resolution || resolution.status !== "resolved") return false;
  navigation.revealLine(resolution.runtimeId, target.side, target.startLine);
  return true;
}
