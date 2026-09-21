import { useSyncExternalStore, type ReactNode } from "react";
import type { ExtensionPaneProps } from "hunkdiff/extension";

import {
  changedUnrepresentedFiles,
  checkpointStatus,
  currentSection,
  currentTarget,
  getGuideSnapshot,
  guideProgress,
  reviewStatus,
  selectSection,
  selectTarget,
  showOverview,
  subscribeGuide,
  targetResolution,
  toggleCurrentReviewed,
  toggleCurrentSectionReviewed,
  visibleSections,
} from "./state.ts";

function fit(text: string, width: number) {
  if (text.length <= width) return text;
  return width <= 1 ? text.slice(0, width) : `${text.slice(0, width - 1)}…`;
}

function wrap(text: string, width: number): readonly string[] {
  const lines: string[] = [];
  let current = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= width) {
      current = next;
    } else {
      if (current) lines.push(current);
      current = fit(word, width);
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [""];
}

function sectionGlyph(sectionId: string) {
  const state = getGuideSnapshot();
  const section = state.guide?.sections.find((candidate) => candidate.id === sectionId);
  if (!section) return " ";
  if (section.id === state.sectionId) return "→";
  const statuses = section.targets.map((target) => reviewStatus(target.id, state));
  if (statuses.every((status) => status === "reviewed")) return "✓";
  if (statuses.some((status) => status === "stale-reviewed")) return "⚠";
  if (section.targets.some((target) => targetResolution(target.id, state)?.status !== "resolved")) {
    return "?";
  }
  if (section.targets.some((target) => checkpointStatus(target.id, state) === "changed"))
    return "●";
  return " ";
}

function targetGlyph(targetId: string) {
  const state = getGuideSnapshot();
  if (targetId === state.targetId) return "→";
  if (targetResolution(targetId, state)?.status !== "resolved") return "?";
  const reviewed = reviewStatus(targetId, state);
  if (reviewed === "reviewed") return "✓";
  if (reviewed === "stale-reviewed") return "⚠";
  return checkpointStatus(targetId, state) === "changed" ? "●" : " ";
}

export function GuidePane({
  width,
  height,
  theme,
  keybindings,
  actions,
}: ExtensionPaneProps): ReactNode {
  const state = useSyncExternalStore(subscribeGuide, getGuideSnapshot);
  const innerWidth = Math.max(8, width - 2);
  const sections = visibleSections(state);
  const section = currentSection(state);
  const target = currentTarget(state);
  const sectionIndex = section
    ? sections.findIndex((candidate) => candidate.id === section.id)
    : -1;
  const progress = guideProgress(state);
  const visibilityFiltered = progress.visibleTargetCount !== progress.targetCount;
  const unrepresented = changedUnrepresentedFiles(state).filter(
    (file) => state.scope === "all" || file.changed,
  );
  const previousSectionKey = keybindings.getKeys("hunk-guide.previous-section")[0] ?? "menu";
  const nextSectionKey = keybindings.getKeys("hunk-guide.next-section")[0] ?? "menu";
  const previousTargetKey = keybindings.getKeys("hunk-guide.previous-target")[0] ?? "menu";
  const nextTargetKey = keybindings.getKeys("hunk-guide.next-target")[0] ?? "menu";
  const targetReviewedKey = keybindings.getKeys("hunk-guide.toggle-reviewed")[0] ?? "menu";
  const sectionReviewedKey = keybindings.getKeys("hunk-guide.toggle-section-reviewed")[0] ?? "menu";
  const toggleKey = keybindings.getKeys("hunk-guide.toggle")[0] ?? "menu";
  const targetReviewed = target ? reviewStatus(target.id, state) === "reviewed" : false;
  const sectionReviewed =
    section?.targets.every((entry) => reviewStatus(entry.id, state) === "reviewed") ?? false;

  function reveal(targetId: string) {
    const selected = selectTarget(targetId);
    const resolution = targetResolution(targetId);
    if (selected && resolution?.status === "resolved") {
      actions.revealLine(resolution.runtimeId, selected.side, selected.startLine);
    } else {
      actions.notify("Guide target is unavailable in this changeset", "warning");
    }
  }

  function revealSection(sectionId: string) {
    const selected = selectSection(sectionId);
    if (selected) reveal(selected.id);
  }

  return (
    <scrollbox
      width="100%"
      height={height}
      scrollY={true}
      focused={false}
      rootOptions={{ backgroundColor: theme.panel }}
      wrapperOptions={{ backgroundColor: theme.panel }}
      viewportOptions={{ backgroundColor: theme.panel }}
      contentOptions={{ backgroundColor: theme.panel }}
      verticalScrollbarOptions={{ visible: false }}
      horizontalScrollbarOptions={{ visible: false }}
    >
      <box style={{ width: "100%", flexDirection: "column", backgroundColor: theme.panel }}>
        <text
          content={fit(" ◆ GUIDE", innerWidth)}
          style={{ fg: theme.accent, bg: theme.panel }}
          onMouseDown={(event) => {
            if (event.button === 0) showOverview();
          }}
        />
        {state.guide ? (
          <>
            <text
              content={fit(
                ` ${state.guide.title ?? "Guided review"}  ${sectionIndex >= 0 ? `${sectionIndex + 1}/${sections.length}` : "overview"}`,
                innerWidth,
              )}
              style={{ fg: theme.text, bg: theme.panel }}
            />
            <text
              content={fit(
                visibilityFiltered
                  ? ` ${progress.visibleReviewedCount}/${progress.visibleTargetCount} visible · ${progress.reviewedCount}/${progress.targetCount} total · ${state.scope}`
                  : ` ${progress.reviewedCount}/${progress.targetCount} targets reviewed · ${state.scope}`,
                innerWidth,
              )}
              style={{ fg: theme.accentMuted, bg: theme.panel }}
            />
            {progress.hiddenKinds.length > 0 && (
              <text
                content={fit(` hidden: ${progress.hiddenKinds.join(", ")}`, innerWidth)}
                style={{ fg: theme.accentMuted, bg: theme.panel }}
              />
            )}
            <text content=" " style={{ bg: theme.panel }} />
            {sections.map((entry, index) => (
              <text
                key={entry.id}
                content={fit(` ${sectionGlyph(entry.id)} ${index + 1}. ${entry.title}`, innerWidth)}
                style={{
                  fg: entry.id === state.sectionId ? theme.accent : theme.text,
                  bg: theme.panel,
                }}
                onMouseDown={(event) => {
                  if (event.button === 0) revealSection(entry.id);
                }}
              />
            ))}
            {sections.length === 0 && (
              <text
                content={
                  state.scope === "changed"
                    ? " No targets changed since checkpoint."
                    : " All sections are hidden by filters."
                }
                style={{ fg: theme.muted }}
              />
            )}
            <text content=" " style={{ bg: theme.panel }} />
            {state.overview ? (
              wrap(
                state.guide.summary ?? "Choose a section to continue the guided review.",
                innerWidth - 1,
              ).map((line, index) => (
                <text
                  key={`summary:${index}`}
                  content={fit(` ${line}`, innerWidth)}
                  style={{ fg: theme.muted, bg: theme.panel }}
                />
              ))
            ) : section ? (
              <>
                {wrap(section.title, innerWidth - 1).map((line, index) => (
                  <text
                    key={`section-title:${index}`}
                    content={fit(` ${line}`, innerWidth)}
                    style={{ fg: theme.accent, bg: theme.panel }}
                  />
                ))}
                {wrap(section.explanation ?? "Review the targets in order.", innerWidth - 1).map(
                  (line, index) => (
                    <text
                      key={`explanation:${index}`}
                      content={fit(` ${line}`, innerWidth)}
                      style={{ fg: theme.muted, bg: theme.panel }}
                    />
                  ),
                )}
                <text content=" " style={{ bg: theme.panel }} />
                <text content=" Targets" style={{ fg: theme.text, bg: theme.panel }} />
                {section.targets
                  .filter(
                    (entry) =>
                      state.scope === "all" || checkpointStatus(entry.id, state) !== "unchanged",
                  )
                  .map((entry) => (
                    <text
                      key={entry.id}
                      content={fit(
                        ` ${targetGlyph(entry.id)} ${entry.path}:${entry.startLine}${entry.endLine === entry.startLine ? "" : `-${entry.endLine}`}`,
                        innerWidth,
                      )}
                      style={{
                        fg: entry.id === target?.id ? theme.accent : theme.text,
                        bg: theme.panel,
                      }}
                      onMouseDown={(event) => {
                        if (event.button === 0) reveal(entry.id);
                      }}
                    />
                  ))}
                <text content=" " style={{ bg: theme.panel }} />
                <text
                  content={fit(` [${targetReviewed ? "✓" : " "}] target reviewed`, innerWidth)}
                  style={{ fg: targetReviewed ? theme.badgeAdded : theme.text, bg: theme.panel }}
                  onMouseDown={(event) => {
                    if (event.button === 0 && !toggleCurrentReviewed()) {
                      actions.notify("Current guide target cannot be marked reviewed", "warning");
                    }
                  }}
                />
                <text
                  content={fit(` [${sectionReviewed ? "✓" : " "}] section reviewed`, innerWidth)}
                  style={{ fg: sectionReviewed ? theme.badgeAdded : theme.text, bg: theme.panel }}
                  onMouseDown={(event) => {
                    if (event.button === 0 && !toggleCurrentSectionReviewed()) {
                      actions.notify("Current guide section has no resolvable targets", "warning");
                    }
                  }}
                />
              </>
            ) : null}
            {unrepresented.length > 0 && (
              <>
                <text content=" " style={{ bg: theme.panel }} />
                <text
                  content={fit(` ● ${unrepresented.length} file(s) outside this guide`, innerWidth)}
                  style={{ fg: theme.badgeNeutral, bg: theme.panel }}
                />
              </>
            )}
            {state.lastError && (
              <text
                content={fit(` ⚠ ${state.lastError}`, innerWidth)}
                style={{ fg: theme.badgeRemoved, bg: theme.panel }}
              />
            )}
            <text content=" " style={{ bg: theme.panel }} />
            <text
              content={fit(` sections  ${previousSectionKey} / ${nextSectionKey}`, innerWidth)}
              style={{ fg: theme.muted, bg: theme.panel }}
            />
            <text
              content={fit(` targets   ${previousTargetKey} / ${nextTargetKey}`, innerWidth)}
              style={{ fg: theme.muted, bg: theme.panel }}
            />
            <text
              content={fit(` review target   ${targetReviewedKey}`, innerWidth)}
              style={{ fg: theme.muted, bg: theme.panel }}
            />
            <text
              content={fit(` review section  ${sectionReviewedKey}`, innerWidth)}
              style={{ fg: theme.muted, bg: theme.panel }}
            />
            <text
              content={fit(` ${toggleKey} toggle`, innerWidth)}
              style={{ fg: theme.muted, bg: theme.panel }}
            />
            <text content=" more: Extensions menu" style={{ fg: theme.muted, bg: theme.panel }} />
          </>
        ) : (
          <>
            <text content=" No guide loaded." style={{ fg: theme.muted, bg: theme.panel }} />
            {state.lastError && (
              <text
                content={fit(` ${state.lastError}`, innerWidth)}
                style={{ fg: theme.badgeRemoved, bg: theme.panel }}
              />
            )}
            <text
              content=" Set HUNK_GUIDE_FILE or create hunk-guide.json."
              style={{ fg: theme.muted, bg: theme.panel }}
            />
          </>
        )}
      </box>
    </scrollbox>
  );
}
