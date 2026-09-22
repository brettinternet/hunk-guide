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
export type FileCheckpointStatus = "unchanged" | "changed" | "new" | "unknown";
export type ReviewStatus = "unreviewed" | "reviewed" | "stale-reviewed";
export type GuideProviderStatus =
  | "disabled"
  | "idle"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export type GuideSource =
  | { kind: "file"; path: string }
  | {
      kind: "generated";
      provider: string;
      requestId: string;
      reviewEpoch: number;
      stale: boolean;
      savedPath?: string;
    };

export interface GuideSnapshot {
  guide: GuideDocument | null;
  source: GuideSource | null;
  lastError: string | null;
  resolution: GuideResolution;
  reviewed: ReadonlyMap<string, TargetFingerprint>;
  checkpoint: ReadonlyMap<string, TargetFingerprint> | null;
  fileCheckpoint: ReadonlyMap<string, TargetFingerprint> | null;
  sectionId: string | null;
  targetId: string | null;
  overview: boolean;
  showAllChanges: boolean;
  scope: GuideScope;
  showVerification: boolean;
  showSupporting: boolean;
  showMechanical: boolean;
  sessionEpoch: number;
  provider: {
    configured: boolean;
    status: GuideProviderStatus;
    message: string | null;
    startedAt: number | null;
    timeoutSeconds: number | null;
  };
}

const EMPTY_RESOLUTION: GuideResolution = { targets: new Map(), files: [] };

let currentFiles: ExtensionChangeset["files"] = [];
let snapshot: GuideSnapshot = {
  guide: null,
  source: null,
  lastError: null,
  resolution: EMPTY_RESOLUTION,
  reviewed: new Map(),
  checkpoint: null,
  fileCheckpoint: null,
  sectionId: null,
  targetId: null,
  overview: false,
  showAllChanges: false,
  scope: "all",
  showVerification: true,
  showSupporting: false,
  showMechanical: false,
  sessionEpoch: 0,
  provider: {
    configured: false,
    status: "disabled",
    message: null,
    startedAt: null,
    timeoutSeconds: null,
  },
};

const listeners = new Set<() => void>();

function publish(next: GuideSnapshot) {
  snapshot = next;
  for (const listener of listeners) listener();
}

export function getGuideSnapshot() {
  return snapshot;
}

export function setProviderConfigured(configured: boolean, message: string | null = null) {
  publish({
    ...snapshot,
    provider: {
      configured,
      status: configured ? "idle" : "disabled",
      message,
      startedAt: null,
      timeoutSeconds: null,
    },
  });
}

export function setProviderStatus(
  status: GuideProviderStatus,
  message: string | null = null,
  timing: { startedAt: number; timeoutSeconds: number } | null = null,
) {
  publish({
    ...snapshot,
    provider: {
      ...snapshot.provider,
      status,
      message,
      startedAt: timing?.startedAt ?? null,
      timeoutSeconds: timing?.timeoutSeconds ?? null,
    },
  });
}

export function subscribeGuide(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
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
  if (!section) return { sectionId: null, targetId: null };
  const target = section.targets.find((candidate) => candidate.id === snapshot.targetId);
  return { sectionId: section.id, targetId: target?.id ?? section.targets[0]!.id };
}

export function setGuide(guide: GuideDocument, source: GuideSource) {
  const sameGuide = snapshot.guide?.id === guide.id;
  const next: GuideSnapshot = {
    ...snapshot,
    guide,
    source,
    lastError: null,
    resolution: resolveGuide(guide, currentFiles),
    reviewed: sameGuide ? snapshot.reviewed : new Map(),
    checkpoint: sameGuide ? snapshot.checkpoint : null,
    fileCheckpoint: sameGuide ? snapshot.fileCheckpoint : null,
    scope: sameGuide ? snapshot.scope : "all",
    overview: false,
    showAllChanges: sameGuide ? snapshot.showAllChanges : false,
    ...(sameGuide ? retainCursor(guide) : { sectionId: null, targetId: null }),
  };
  publishWithVisibleCursor(next);
}

export function setGeneratedGuideSaved(path: string) {
  if (snapshot.source?.kind !== "generated") return false;
  publish({ ...snapshot, source: { ...snapshot.source, savedPath: path } });
  return true;
}

export function setGuideError(message: string | null) {
  publish({ ...snapshot, lastError: message });
}

export function reconcileChangeset(changeset: ExtensionChangeset, resetSession: boolean) {
  currentFiles = changeset.files;
  const cursor = resetSession ? { sectionId: null, targetId: null } : {};
  const next: GuideSnapshot = {
    ...snapshot,
    source:
      snapshot.source?.kind === "generated" ? { ...snapshot.source, stale: true } : snapshot.source,
    resolution: snapshot.guide ? resolveGuide(snapshot.guide, changeset.files) : EMPTY_RESOLUTION,
    reviewed: resetSession ? new Map() : snapshot.reviewed,
    checkpoint: resetSession ? null : snapshot.checkpoint,
    fileCheckpoint: resetSession ? null : snapshot.fileCheckpoint,
    scope: resetSession ? "all" : snapshot.scope,
    overview: resetSession ? false : snapshot.overview,
    showAllChanges: resetSession ? false : snapshot.showAllChanges,
    sessionEpoch: resetSession ? snapshot.sessionEpoch + 1 : snapshot.sessionEpoch,
    ...cursor,
  };
  publishWithVisibleCursor(next);
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
  if (!current || current.status === "ambiguous-file") return "unknown";
  if (current.status !== "resolved") return previous ? "missing" : "unknown";
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

function sectionKindVisible(section: GuideSection, state: GuideSnapshot): boolean {
  if (section.kind === "verification") return state.showVerification;
  if (section.kind === "supporting") return state.showSupporting;
  if (section.kind === "mechanical") return state.showMechanical;
  return true;
}

export function visibleSections(state = snapshot): readonly GuideSection[] {
  if (!state.guide) return [];
  return state.guide.sections.filter(
    (section) =>
      sectionKindVisible(section, state) &&
      (state.scope === "all" ||
        !state.checkpoint ||
        section.targets.some((target) => checkpointStatus(target.id, state) !== "unchanged")),
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

export interface GuideProgressView {
  reviewedCount: number;
  targetCount: number;
  visibleReviewedCount: number;
  visibleTargetCount: number;
  hiddenKinds: readonly string[];
}

export function guideProgress(state = snapshot): GuideProgressView {
  const targets = state.guide?.sections.flatMap((section) => section.targets) ?? [];
  const visible = visibleTargets(state).map(({ target }) => target);
  const filterableKinds = ["verification", "supporting", "mechanical"] as const;
  return {
    reviewedCount: targets.filter((target) => reviewStatus(target.id, state) === "reviewed").length,
    targetCount: targets.length,
    visibleReviewedCount: visible.filter((target) => reviewStatus(target.id, state) === "reviewed")
      .length,
    visibleTargetCount: visible.length,
    hiddenKinds: filterableKinds.filter(
      (kind) =>
        state.guide?.sections.some(
          (section) => section.kind === kind && !sectionKindVisible(section, state),
        ) ?? false,
    ),
  };
}

function publishWithVisibleCursor(next: GuideSnapshot) {
  const visible = visibleTargets(next);
  if (visible.some(({ target }) => target.id === next.targetId)) {
    publish(next);
    return;
  }

  const currentSectionIndex =
    next.guide?.sections.findIndex((section) => section.id === next.sectionId) ?? -1;
  const sameSection = visible.find(({ section }) => section.id === next.sectionId);
  const nextSection = visible.find(({ section }) => {
    const index = next.guide?.sections.findIndex((candidate) => candidate.id === section.id) ?? -1;
    return index > currentSectionIndex;
  });
  const replacement = sameSection ?? nextSection ?? visible[0];
  publish(
    replacement
      ? {
          ...next,
          sectionId: replacement.section.id,
          targetId: replacement.target.id,
          overview: false,
        }
      : { ...next, sectionId: null, targetId: null, overview: true },
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

export function toggleShowAllChanges(): boolean {
  const showAllChanges = !snapshot.showAllChanges;
  publish({ ...snapshot, showAllChanges });
  return showAllChanges;
}

export interface SectionFocusFile {
  runtimeId: string;
  hunkIndexes: readonly number[];
}

export interface SectionFocus {
  files: readonly SectionFocusFile[];
  hunkCount: number;
  fileCount: number;
  hiddenFileCount: number;
}

export function currentSectionFocus(state = snapshot): SectionFocus | null {
  if (state.showAllChanges || state.overview) return null;
  const section = currentSection(state);
  if (!section) return null;

  const hunksByFile = new Map<string, Set<number>>();
  for (const target of section.targets) {
    const resolution = state.resolution.targets.get(target.id);
    if (resolution?.status !== "resolved") continue;
    const hunkIndexes = hunksByFile.get(resolution.runtimeId) ?? new Set<number>();
    hunkIndexes.add(resolution.hunkIndex);
    hunksByFile.set(resolution.runtimeId, hunkIndexes);
  }
  if (hunksByFile.size === 0) return null;

  const files = [...hunksByFile].map(([runtimeId, hunkIndexes]) => ({
    runtimeId,
    hunkIndexes: [...hunkIndexes].sort((left, right) => left - right),
  }));
  return {
    files,
    hunkCount: files.reduce((count, file) => count + file.hunkIndexes.length, 0),
    fileCount: files.length,
    hiddenFileCount: Math.max(0, state.resolution.files.length - files.length),
  };
}

export function selectSection(sectionId: string): GuideTarget | null {
  const section = visibleSections(snapshot).find((candidate) => candidate.id === sectionId);
  const target = section?.targets.find(
    (candidate) =>
      snapshot.scope === "all" || checkpointStatus(candidate.id, snapshot) !== "unchanged",
  );
  if (!section || !target) return null;
  publish({ ...snapshot, sectionId: section.id, targetId: target.id, overview: false });
  return target;
}

export function selectTarget(targetId: string): GuideTarget | null {
  const entry = visibleTargets(snapshot).find(({ target }) => target.id === targetId);
  if (!entry) return null;
  publish({
    ...snapshot,
    sectionId: entry.section.id,
    targetId: entry.target.id,
    overview: false,
  });
  return entry.target;
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
  publishWithVisibleCursor({ ...snapshot, scope });
  return true;
}

export function setSectionVisibility(
  showVerification: boolean,
  showSupporting: boolean,
  showMechanical: boolean,
) {
  publishWithVisibleCursor({ ...snapshot, showVerification, showSupporting, showMechanical });
}

export function toggleVerificationSections(): boolean {
  const showVerification = !snapshot.showVerification;
  publishWithVisibleCursor({ ...snapshot, showVerification });
  return showVerification;
}

export function toggleSupportingSections(): boolean {
  const showSupporting = !snapshot.showSupporting;
  publishWithVisibleCursor({ ...snapshot, showSupporting });
  return showSupporting;
}

export function toggleMechanicalSections(): boolean {
  const showMechanical = !snapshot.showMechanical;
  publishWithVisibleCursor({ ...snapshot, showMechanical });
  return showMechanical;
}

export function unrepresentedFiles(state = snapshot): readonly ReviewFileStateView[] {
  if (!state.guide) return [];
  const represented = new Set(
    state.guide.sections.flatMap((section) => section.targets.map((target) => target.path)),
  );
  return state.resolution.files
    .filter((file) => !represented.has(file.path) && !represented.has(file.previousPath ?? ""))
    .map((file) => {
      const baseline =
        state.fileCheckpoint?.get(file.path) ??
        (file.previousPath ? state.fileCheckpoint?.get(file.previousPath) : undefined);
      const comparison = compareFingerprints(baseline, file.fingerprint);
      const status: FileCheckpointStatus = !state.fileCheckpoint
        ? "unknown"
        : !baseline
          ? "new"
          : comparison === "same"
            ? "unchanged"
            : comparison === "different"
              ? "changed"
              : "unknown";
      return { path: file.path, status };
    });
}

export interface CheckpointSummary {
  changedTargets: number;
  missingTargets: number;
  newTargets: number;
  unknownTargets: number;
  changedFiles: number;
  newFiles: number;
  unknownFiles: number;
}

export function checkpointSummary(state = snapshot): CheckpointSummary {
  const targetStatuses =
    state.guide?.sections.flatMap((section) =>
      section.targets.map((target) => checkpointStatus(target.id, state)),
    ) ?? [];
  const fileStatuses = unrepresentedFiles(state).map((file) => file.status);
  return {
    changedTargets: targetStatuses.filter((status) => status === "changed").length,
    missingTargets: targetStatuses.filter((status) => status === "missing").length,
    newTargets: targetStatuses.filter((status) => status === "new").length,
    unknownTargets: targetStatuses.filter((status) => status === "unknown").length,
    changedFiles: fileStatuses.filter((status) => status === "changed").length,
    newFiles: fileStatuses.filter((status) => status === "new").length,
    unknownFiles: fileStatuses.filter((status) => status === "unknown").length,
  };
}

export interface ReviewFileStateView {
  path: string;
  status: FileCheckpointStatus;
}
