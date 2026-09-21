import type {
  ExtensionCommandContext,
  ExtensionContext,
  ExtensionEventContext,
  HunkExtensionAPI,
} from "hunkdiff/extension";

import { readConfig } from "./config.ts";
import { loadGuideFile, resolveGuideFile, type GuideFileSource } from "./generators/file.ts";
import { targetHighlights } from "./highlight.ts";
import { revealTarget } from "./navigation.ts";
import {
  currentTarget,
  enrichFromReviewSnapshot,
  getGuideSnapshot,
  nextSection,
  nextTarget,
  previousSection,
  previousTarget,
  reconcileChangeset,
  setCheckpoint,
  setGuide,
  setGuideError,
  setHighlightActive,
  showOverview,
  targetResolution,
  toggleCurrentReviewed,
  toggleCurrentSectionReviewed,
  toggleScope,
} from "./state.ts";
import { GuidePane } from "./tourPane.tsx";

const HIGHLIGHTER_ID = "current-target";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "unknown guide error";
}

export default function registerHunkGuide(hunk: HunkExtensionAPI) {
  const config = readConfig(hunk.config);
  let source: GuideFileSource | null = null;
  let hasLoadedChangeset = false;

  async function reloadGuide(ctx: ExtensionContext) {
    try {
      source = await resolveGuideFile({
        cwd: ctx.cwd,
        configFile: config.file,
        environmentFile: process.env.HUNK_GUIDE_FILE,
      });
      if (!source) {
        setGuideError("No guide file found");
        return false;
      }
      setGuide(await loadGuideFile(source), source.path);
      return true;
    } catch (error) {
      const message = errorMessage(error);
      setGuideError(message);
      ctx.notify(`Guide unchanged: ${message}`, "warning");
      return false;
    }
  }

  function refreshCurrentHighlight(ctx: ExtensionCommandContext) {
    ctx.highlights.refresh(HIGHLIGHTER_ID);
  }

  function navigateCurrent(ctx: ExtensionCommandContext) {
    enrichFromReviewSnapshot(ctx.review.snapshot());
    const target = currentTarget();
    if (!target || !revealTarget(target, targetResolution(target.id), ctx.navigation)) {
      ctx.notify("Current guide target is unavailable in this changeset", "warning");
      return false;
    }
    refreshCurrentHighlight(ctx);
    return true;
  }

  function moveAndNavigate(ctx: ExtensionCommandContext, move: () => void) {
    enrichFromReviewSnapshot(ctx.review.snapshot());
    move();
    navigateCurrent(ctx);
  }

  setHighlightActive(config.defaultOpen);

  hunk.registerPane({
    id: "guide",
    title: "Guide",
    placement: config.placement,
    width: { preferred: 36, min: 24, max: 52 },
    defaultOpen: config.defaultOpen,
    component: GuidePane,
  });

  hunk.registerLineHighlighter({
    id: HIGHLIGHTER_ID,
    highlight({ file }) {
      const state = getGuideSnapshot();
      const target = state.highlightActive ? currentTarget(state) : null;
      return target ? targetHighlights(file, target) : null;
    },
  });

  hunk.registerCommand({ id: "toggle", title: "Toggle Guide pane", key: "f6" }, (ctx) => {
    const opening = !ctx.panes.isOpen("guide");
    if (opening) ctx.panes.open("guide");
    else ctx.panes.close("guide");
    setHighlightActive(opening);
    refreshCurrentHighlight(ctx);
  });
  hunk.registerCommand({ id: "next-section", title: "Guide: next section", key: "f7" }, (ctx) =>
    moveAndNavigate(ctx, nextSection),
  );
  hunk.registerCommand(
    { id: "previous-section", title: "Guide: previous section", key: "shift+f7" },
    (ctx) => moveAndNavigate(ctx, previousSection),
  );
  hunk.registerCommand({ id: "next-target", title: "Guide: next target", key: "f8" }, (ctx) =>
    moveAndNavigate(ctx, nextTarget),
  );
  hunk.registerCommand(
    { id: "previous-target", title: "Guide: previous target", key: "shift+f8" },
    (ctx) => moveAndNavigate(ctx, previousTarget),
  );
  hunk.registerCommand({ id: "overview", title: "Guide: show overview" }, (ctx) => {
    showOverview();
    ctx.panes.open("guide");
  });
  hunk.registerCommand({ id: "toggle-reviewed", title: "Guide: toggle target reviewed" }, (ctx) => {
    enrichFromReviewSnapshot(ctx.review.snapshot());
    if (!toggleCurrentReviewed())
      ctx.notify("Current guide target cannot be marked reviewed", "warning");
  });
  hunk.registerCommand(
    { id: "toggle-section-reviewed", title: "Guide: toggle section reviewed" },
    (ctx) => {
      enrichFromReviewSnapshot(ctx.review.snapshot());
      if (!toggleCurrentSectionReviewed()) {
        ctx.notify("Current guide section has no resolvable targets", "warning");
      }
    },
  );
  hunk.registerCommand({ id: "checkpoint", title: "Guide: set change checkpoint" }, (ctx) => {
    enrichFromReviewSnapshot(ctx.review.snapshot());
    setCheckpoint();
    ctx.notify("Guide checkpoint set");
  });
  hunk.registerCommand({ id: "toggle-scope", title: "Guide: toggle all/changed scope" }, (ctx) => {
    if (!toggleScope()) {
      ctx.notify("Set a guide checkpoint before showing changed targets", "warning");
      return;
    }
    if (currentTarget()) navigateCurrent(ctx);
  });
  hunk.registerCommand({ id: "reload", title: "Guide: reload guide file" }, async (ctx) => {
    if (await reloadGuide(ctx)) {
      enrichFromReviewSnapshot(ctx.review.snapshot());
      ctx.highlights.refresh(HIGHLIGHTER_ID);
      ctx.notify(`Guide reloaded${source ? ` from ${source.path}` : ""}`);
    }
  });

  hunk.on("startup", async (_event, ctx) => {
    await reloadGuide(ctx);
  });
  hunk.on("changeset_loaded", ({ changeset }) => {
    reconcileChangeset(changeset, !hasLoadedChangeset);
    hasLoadedChangeset = true;
  });
  hunk.on("session_reload", ({ changeset }) => {
    reconcileChangeset(changeset, false);
  });
  hunk.on("shutdown", (_event, _ctx: ExtensionEventContext) => {
    source = null;
  });
}
