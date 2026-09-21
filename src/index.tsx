import type {
  ExtensionCommandContext,
  ExtensionContext,
  ExtensionEventContext,
  HunkExtensionAPI,
} from "hunkdiff/extension";

import { readConfig } from "./config.ts";
import { loadGuideFile, resolveGuideFile, type GuideFileSource } from "./generators/file.ts";
import { revealTarget } from "./navigation.ts";
import {
  currentTarget,
  enrichFromReviewSnapshot,
  nextSection,
  nextTarget,
  previousSection,
  previousTarget,
  reconcileChangeset,
  setCheckpoint,
  setGuide,
  setGuideError,
  showOverview,
  targetResolution,
  toggleCurrentReviewed,
  toggleCurrentSectionReviewed,
  toggleScope,
} from "./state.ts";
import { GuidePane } from "./tourPane.tsx";

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

  function navigateCurrent(ctx: ExtensionCommandContext) {
    enrichFromReviewSnapshot(ctx.review.snapshot());
    const target = currentTarget();
    if (!target || !revealTarget(target, targetResolution(target.id), ctx.navigation)) {
      ctx.notify("Current guide target is unavailable in this changeset", "warning");
      return false;
    }
    return true;
  }

  function moveAndNavigate(ctx: ExtensionCommandContext, move: () => void) {
    enrichFromReviewSnapshot(ctx.review.snapshot());
    move();
    navigateCurrent(ctx);
  }

  hunk.registerPane({
    id: "guide",
    title: "Guide",
    placement: config.placement,
    width: { preferred: 36, min: 24, max: 52 },
    defaultOpen: config.defaultOpen,
    component: GuidePane,
  });

  hunk.registerCommand({ id: "toggle", title: "Toggle Guide pane", key: "alt+g" }, (ctx) => {
    if (ctx.panes.isOpen("guide")) ctx.panes.close("guide");
    else ctx.panes.open("guide");
  });
  hunk.registerCommand({ id: "next-section", title: "Guide: next section", key: "alt+j" }, (ctx) =>
    moveAndNavigate(ctx, nextSection),
  );
  hunk.registerCommand(
    { id: "previous-section", title: "Guide: previous section", key: "alt+k" },
    (ctx) => moveAndNavigate(ctx, previousSection),
  );
  hunk.registerCommand({ id: "next-target", title: "Guide: next target", key: "alt+l" }, (ctx) =>
    moveAndNavigate(ctx, nextTarget),
  );
  hunk.registerCommand(
    { id: "previous-target", title: "Guide: previous target", key: "alt+h" },
    (ctx) => moveAndNavigate(ctx, previousTarget),
  );
  hunk.registerCommand({ id: "overview", title: "Guide: show overview", key: "alt+o" }, (ctx) => {
    showOverview();
    ctx.panes.open("guide");
  });
  hunk.registerCommand(
    { id: "toggle-reviewed", title: "Guide: toggle target reviewed", key: "alt+r" },
    (ctx) => {
      enrichFromReviewSnapshot(ctx.review.snapshot());
      if (!toggleCurrentReviewed())
        ctx.notify("Current guide target cannot be marked reviewed", "warning");
    },
  );
  hunk.registerCommand(
    { id: "toggle-section-reviewed", title: "Guide: toggle section reviewed", key: "alt+R" },
    (ctx) => {
      enrichFromReviewSnapshot(ctx.review.snapshot());
      if (!toggleCurrentSectionReviewed()) {
        ctx.notify("Current guide section has no resolvable targets", "warning");
      }
    },
  );
  hunk.registerCommand(
    { id: "checkpoint", title: "Guide: set change checkpoint", key: "alt+c" },
    (ctx) => {
      enrichFromReviewSnapshot(ctx.review.snapshot());
      setCheckpoint();
      ctx.notify("Guide checkpoint set");
    },
  );
  hunk.registerCommand(
    { id: "toggle-scope", title: "Guide: toggle all/changed scope", key: "alt+v" },
    (ctx) => {
      if (!toggleScope()) {
        ctx.notify("Set a guide checkpoint before showing changed targets", "warning");
        return;
      }
      if (currentTarget()) navigateCurrent(ctx);
    },
  );
  hunk.registerCommand({ id: "reload", title: "Guide: reload guide file" }, async (ctx) => {
    if (await reloadGuide(ctx)) {
      enrichFromReviewSnapshot(ctx.review.snapshot());
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
