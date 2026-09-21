import type { ExtensionChangeset, ExtensionReviewSnapshot } from "hunkdiff/extension";

import type { GuideDocument, GuideSection, GuideTarget } from "./model.ts";
import {
  enrichResolutionFromSnapshot,
  resolveGuide,
  type GuideResolution,
  type TargetFingerprint,
  type TargetResolution,
} from "./navigation.ts";
import { compareFingerprints } from "./reconciliation/reconcileGuide.ts";

export type GuideScope = "all" | "changed";
export type CheckpointStatus = "unchanged" | "changed" | "new" | "missing" | "unknown";
export type ReviewStatus = "unreviewed" | "reviewed" | "stale-reviewed";

export interface GuideSnapshot {
  guide: GuideDocument | null;
  sourcePath: string | null;
  lastError: string | null;
  resolution: GuideResolution;
  reviewed: ReadonlyMap<string, TargetFingerprint>;
  checkpoint: ReadonlyMap<string, TargetFingerprint> | null;
  fileCheckpoint: ReadonlyMap<string, TargetFingerprint> | null;
  sectionId: string | null;
  targetId: string | null;
  overview: boolean;
  scope: GuideScope;
  highlightActive: boolean;
  sessionEpoch: number;
}

const EMPTY_RESOLUTION: GuideResolution = { targets: new Map(), files: [] };

let currentFiles: ExtensionChangeset["files"] = [];
let snapshot: GuideSnapshot = {
  guide: null,
  sourcePath: null,
  lastError: null,
  resolution: EMPTY_RESOLUTION,
  reviewed: new Map(),
  checkpoint: null,
  fileCheckpoint: null,
  sectionId: null,
  targetId: null,
  overview: false,
  scope: "all",
  highlightActive: true,
  sessionEpoch: 0,
};

const listeners = new Set<() => void>();

function publish(next: GuideSnapshot) {
  snapshot = next;
  for (const listener of listeners) listener();
}

export function getGuideSnapshot() {
  return snapshot;
}

export function subscribeGuide(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function firstCursor(guide: GuideDocument | null) {
  const section = guide?.sections[0];
  return { sectionId: section?.id ?? null, targetId: section?.targets[0]?.id ?? null };
}

function targetById(guide: GuideDocument | null, targetId: string | null): GuideTarget | null {
  if (!guide || !targetId) return null;
  for (const section of guide.sections) {
    const target = section.targets.find((candidate) => candidate.id === targetId);
    if (target) return target;
  }
  return null;
}

function sectionById(guide: GuideDocument | null, sectionId: string | null): GuideSection | null {
  return guide?.sections.find((section) => section.id === sectionId) ?? null;
}

function retainCursor(guide: GuideDocument) {
  const section = sectionById(guide, snapshot.sectionId);
  if (!section) return firstCursor(guide);
  const target = section.targets.find((candidate) => candidate.id === snapshot.targetId);
  return { sectionId: section.id, targetId: target?.id ?? section.targets[0]!.id };
}

export function setGuide(guide: GuideDocument, sourcePath: string) {
  const sameGuide = snapshot.guide?.id === guide.id;
  const cursor = sameGuide ? retainCursor(guide) : firstCursor(guide);
  publish({
    ...snapshot,
    guide,
    sourcePath,
    lastError: null,
    resolution: resolveGuide(guide, currentFiles),
    reviewed: sameGuide ? snapshot.reviewed : new Map(),
    checkpoint: sameGuide ? snapshot.checkpoint : null,
    fileCheckpoint: sameGuide ? snapshot.fileCheckpoint : null,
    scope: sameGuide ? snapshot.scope : "all",
    overview: false,
    ...cursor,
  });
}

export function setGuideError(message: string) {
  publish({ ...snapshot, lastError: message });
}

export function reconcileChangeset(changeset: ExtensionChangeset, resetSession: boolean) {
  currentFiles = changeset.files;
  const cursor = resetSession && snapshot.guide ? firstCursor(snapshot.guide) : {};
  const next: GuideSnapshot = {
    ...snapshot,
    resolution: snapshot.guide ? resolveGuide(snapshot.guide, changeset.files) : EMPTY_RESOLUTION,
    reviewed: resetSession ? new Map() : snapshot.reviewed,
    checkpoint: resetSession ? null : snapshot.checkpoint,
    fileCheckpoint: resetSession ? null : snapshot.fileCheckpoint,
    scope: resetSession ? "all" : snapshot.scope,
    overview: resetSession ? false : snapshot.overview,
    sessionEpoch: resetSession ? snapshot.sessionEpoch + 1 : snapshot.sessionEpoch,
    ...cursor,
  };
  const visible = visibleTargets(next);
  const currentStillVisible = visible.some(({ target }) => target.id === next.targetId);
  const first = visible[0];
  publish(
    currentStillVisible
      ? next
      : first
        ? { ...next, sectionId: first.section.id, targetId: first.target.id, overview: false }
        : { ...next, sectionId: null, targetId: null, overview: true },
  );
}

export function enrichFromReviewSnapshot(review: ExtensionReviewSnapshot | null) {
  if (!review || !snapshot.guide) return;
  publish({
    ...snapshot,
    resolution: enrichResolutionFromSnapshot(snapshot.guide, snapshot.resolution, review),
  });
}

export function currentSection(state = snapshot): GuideSection | null {
  return sectionById(state.guide, state.sectionId);
}

export function currentTarget(state = snapshot): GuideTarget | null {
  return targetById(state.guide, state.targetId);
}

export function targetResolution(targetId: string, state = snapshot): TargetResolution | undefined {
  return state.resolution.targets.get(targetId);
}

export function checkpointStatus(targetId: string, state = snapshot): CheckpointStatus {
  if (!state.checkpoint) return "unknown";
  const current = state.resolution.targets.get(targetId);
  const previous = state.checkpoint.get(targetId);
  if (!current || current.status !== "resolved") return previous ? "missing" : "unknown";
  if (!previous) return "new";
  const comparison = compareFingerprints(previous, current.fingerprint);
  return comparison === "same" ? "unchanged" : comparison === "different" ? "changed" : "unknown";
}

export function reviewStatus(targetId: string, state = snapshot): ReviewStatus {
  const reviewed = state.reviewed.get(targetId);
  if (!reviewed) return "unreviewed";
  const current = state.resolution.targets.get(targetId);
  if (!current || current.status !== "resolved") return "stale-reviewed";
  return compareFingerprints(reviewed, current.fingerprint) === "same"
    ? "reviewed"
    : "stale-reviewed";
}

export function visibleSections(state = snapshot): readonly GuideSection[] {
  if (!state.guide) return [];
  if (state.scope === "all" || !state.checkpoint) return state.guide.sections;
  return state.guide.sections.filter((section) =>
    section.targets.some((target) => checkpointStatus(target.id, state) !== "unchanged"),
  );
}

function visibleTargets(
  state = snapshot,
): readonly { section: GuideSection; target: GuideTarget }[] {
  return visibleSections(state).flatMap((section) =>
    section.targets
      .filter(
        (target) => state.scope === "all" || checkpointStatus(target.id, state) !== "unchanged",
      )
      .map((target) => ({ section, target })),
  );
}

function moveCursor(delta: number, bySection: boolean) {
  if (!snapshot.guide) return;
  if (bySection) {
    const sections = visibleSections(snapshot);
    if (sections.length === 0) return;
    const currentIndex = Math.max(
      0,
      sections.findIndex((section) => section.id === snapshot.sectionId),
    );
    const section = sections[(currentIndex + delta + sections.length) % sections.length]!;
    const target = section.targets.find(
      (candidate) =>
        snapshot.scope === "all" || checkpointStatus(candidate.id, snapshot) !== "unchanged",
    );
    publish({
      ...snapshot,
      sectionId: section.id,
      targetId: target?.id ?? section.targets[0]!.id,
      overview: false,
    });
    return;
  }

  const targets = visibleTargets(snapshot);
  if (targets.length === 0) return;
  const currentIndex = Math.max(
    0,
    targets.findIndex(({ target }) => target.id === snapshot.targetId),
  );
  const entry = targets[(currentIndex + delta + targets.length) % targets.length]!;
  publish({
    ...snapshot,
    sectionId: entry.section.id,
    targetId: entry.target.id,
    overview: false,
  });
}

export function nextSection() {
  moveCursor(1, true);
}

export function previousSection() {
  moveCursor(-1, true);
}

export function nextTarget() {
  moveCursor(1, false);
}

export function previousTarget() {
  moveCursor(-1, false);
}

export function showOverview() {
  publish({ ...snapshot, overview: true });
}

export function setHighlightActive(active: boolean) {
  publish({ ...snapshot, highlightActive: active });
}

export function toggleCurrentReviewed() {
  const target = currentTarget();
  if (!target) return false;
  const resolution = snapshot.resolution.targets.get(target.id);
  if (!resolution || resolution.status !== "resolved") return false;

  const reviewed = new Map(snapshot.reviewed);
  if (reviewStatus(target.id) === "reviewed") reviewed.delete(target.id);
  else reviewed.set(target.id, resolution.fingerprint);
  publish({ ...snapshot, reviewed });
  return true;
}

export function toggleCurrentSectionReviewed() {
  const section = currentSection();
  if (!section) return false;
  const resolvable = section.targets.flatMap((target) => {
    const resolution = snapshot.resolution.targets.get(target.id);
    return resolution?.status === "resolved"
      ? [{ target, fingerprint: resolution.fingerprint }]
      : [];
  });
  if (resolvable.length === 0) return false;

  const allReviewed = resolvable.every(({ target }) => reviewStatus(target.id) === "reviewed");
  const reviewed = new Map(snapshot.reviewed);
  for (const { target, fingerprint } of resolvable) {
    if (allReviewed) reviewed.delete(target.id);
    else reviewed.set(target.id, fingerprint);
  }
  publish({ ...snapshot, reviewed });
  return true;
}

export function setCheckpoint() {
  const checkpoint = new Map<string, TargetFingerprint>();
  for (const [targetId, resolution] of snapshot.resolution.targets) {
    if (resolution.status === "resolved") checkpoint.set(targetId, resolution.fingerprint);
  }
  const fileCheckpoint = new Map(
    snapshot.resolution.files.map((file) => [file.path, file.fingerprint] as const),
  );
  publish({ ...snapshot, checkpoint, fileCheckpoint, scope: "all" });
}

export function toggleScope(): boolean {
  if (!snapshot.checkpoint) return false;
  const scope: GuideScope = snapshot.scope === "all" ? "changed" : "all";
  const next: GuideSnapshot = { ...snapshot, scope };
  const visible = visibleTargets(next);
  const currentStillVisible = visible.some(({ target }) => target.id === next.targetId);
  const first = visible[0];
  publish(
    currentStillVisible
      ? next
      : first
        ? { ...next, sectionId: first.section.id, targetId: first.target.id, overview: false }
        : { ...next, sectionId: null, targetId: null, overview: true },
  );
  return true;
}

export function changedUnrepresentedFiles(state = snapshot): readonly ReviewFileStateView[] {
  if (!state.guide) return [];
  const represented = new Set(
    state.guide.sections.flatMap((section) => section.targets.map((target) => target.path)),
  );
  return state.resolution.files
    .filter((file) => !represented.has(file.path) && !represented.has(file.previousPath ?? ""))
    .map((file) => {
      const baseline = state.fileCheckpoint?.get(file.path);
      return {
        path: file.path,
        changed:
          !state.fileCheckpoint || compareFingerprints(baseline, file.fingerprint) !== "same",
      };
    });
}

export interface ReviewFileStateView {
  path: string;
  changed: boolean;
}
