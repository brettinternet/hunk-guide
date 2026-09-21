import type {
  ExtensionCommandContext,
  ExtensionContext,
  ExtensionEventContext,
  HunkExtensionAPI,
} from "hunkdiff/extension";

import { readConfig } from "./config.ts";
import { loadGuideFile, resolveGuideFile, type GuideFileSource } from "./generators/file.ts";
import { generateGuide, validateGeneratedGuide } from "./generators/external.ts";
import { ProviderFailure } from "./generators/command.ts";
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
  setProviderConfigured,
  setProviderStatus,
  setSectionVisibility,
  showOverview,
  targetResolution,
  toggleCurrentReviewed,
  toggleCurrentSectionReviewed,
  toggleMechanicalSections,
  toggleScope,
  toggleSupportingSections,
  toggleVerificationSections,
} from "./state.ts";
import { GuidePane } from "./tourPane.tsx";

function errorMessage(error: unknown) {
  if (error instanceof ProviderFailure) return `${error.category}: ${error.message}`;
  return error instanceof Error ? error.message : "unknown guide error";
}

function commandBasename(command: readonly string[]) {
  return command[0]!.split(/[\\/]/).pop() ?? command[0]!;
}

export default function registerHunkGuide(hunk: HunkExtensionAPI) {
  const config = readConfig(hunk.config);
  const providerName = config.command ? commandBasename(config.command.argv) : null;
  setProviderConfigured(
    config.command !== null || config.commandError !== undefined,
    providerName ?? config.commandError ?? null,
  );
  setSectionVisibility(config.showVerification, config.showSupporting, config.showMechanical);
  let source: GuideFileSource | null = null;
  let hasLoadedChangeset = false;
  let latestChangeset: Parameters<typeof reconcileChangeset>[0] | null = null;
  let activeGeneration: AbortController | null = null;
  let generationEpoch = 0;
  let guideOpen = config.defaultOpen;

  function cancelGeneration(status: "cancelled" | "idle" = "cancelled") {
    generationEpoch += 1;
    activeGeneration?.abort();
    activeGeneration = null;
    if (config.command)
      setProviderStatus(
        status,
        status === "cancelled" ? `${providerName} · generation cancelled` : providerName,
      );
  }

  async function generate(ctx: ExtensionCommandContext) {
    if (!config.command) {
      ctx.notify(config.commandError ?? "No HUNK_GUIDE_COMMAND configured", "warning");
      setProviderStatus("failed", config.commandError ?? "No command configured");
      return;
    }
    if (activeGeneration) {
      ctx.notify("Guide generation is already active", "warning");
      return;
    }
    if (!latestChangeset) {
      ctx.notify("Guide generation is unavailable until the review loads", "warning");
      return;
    }
    const review = ctx.review.snapshot();
    if (!review) {
      ctx.notify("Guide generation is unavailable while the review is reloading", "warning");
      return;
    }
    const epoch = generationEpoch;
    const controller = new AbortController();
    activeGeneration = controller;
    const startedAt = Date.now();
    setProviderStatus("running", `Generating with ${providerName}…`, {
      startedAt,
      timeoutSeconds: config.providerTimeoutSeconds,
    });
    const captured = latestChangeset;
    try {
      const result = await generateGuide(
        { changeset: captured, review, density: config.density },
        {
          command: config.command,
          cwd: ctx.cwd,
          timeoutSeconds: config.providerTimeoutSeconds,
          signal: controller.signal,
        },
      );
      if (epoch !== generationEpoch || activeGeneration !== controller || controller.signal.aborted)
        return;
      const current = latestChangeset;
      if (!current) throw new Error("review reloaded before generation completed");
      validateGeneratedGuide(result.guide, captured, current);
      setGuide(result.guide, "[external command]");
      const targetCount = result.guide.sections.reduce(
        (count, section) => count + section.targets.length,
        0,
      );
      setProviderStatus(
        "succeeded",
        `Generated ${result.guide.sections.length} sections · ${targetCount} targets · ${Math.round((Date.now() - startedAt) / 1000)}s`,
      );
      ctx.notify("Guide generated");
    } catch (error) {
      if (epoch !== generationEpoch || activeGeneration !== controller || controller.signal.aborted)
        return;
      const message = errorMessage(error);
      setProviderStatus("failed", message);
      ctx.notify(`Guide unchanged: ${message}`, "warning");
    } finally {
      if (activeGeneration === controller) activeGeneration = null;
    }
  }

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
      const guide = await loadGuideFile(source);
      setGuide(guide, source.path);
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
    if (guideOpen) ctx.panes.close("guide");
    else ctx.panes.open("guide");
    guideOpen = !guideOpen;
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
    guideOpen = true;
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
      enrichFromReviewSnapshot(ctx.review.snapshot());
      if (!toggleScope()) {
        ctx.notify("Set a guide checkpoint before showing changed targets", "warning");
        return;
      }
      if (currentTarget()) navigateCurrent(ctx);
    },
  );
  hunk.registerCommand(
    { id: "toggle-verification", title: "Guide: toggle verification sections" },
    (ctx) => {
      const visible = toggleVerificationSections();
      ctx.notify(`Guide verification sections ${visible ? "shown" : "hidden"}`);
      if (currentTarget()) navigateCurrent(ctx);
    },
  );
  hunk.registerCommand(
    { id: "toggle-supporting", title: "Guide: toggle supporting sections" },
    (ctx) => {
      const visible = toggleSupportingSections();
      ctx.notify(`Guide supporting sections ${visible ? "shown" : "hidden"}`);
      if (currentTarget()) navigateCurrent(ctx);
    },
  );
  hunk.registerCommand(
    { id: "toggle-mechanical", title: "Guide: toggle mechanical sections" },
    (ctx) => {
      const visible = toggleMechanicalSections();
      ctx.notify(`Guide mechanical sections ${visible ? "shown" : "hidden"}`);
      if (currentTarget()) navigateCurrent(ctx);
    },
  );
  hunk.registerCommand(
    { id: "generate", title: "Guide: generate with external command", key: "alt+y" },
    (ctx) => generate(ctx),
  );
  hunk.registerCommand(
    { id: "cancel-generation", title: "Guide: cancel generation", key: "alt+shift+y" },
    (ctx) => {
      if (activeGeneration) {
        cancelGeneration("idle");
        ctx.notify("Guide generation cancelled");
      }
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
    cancelGeneration("idle");
    latestChangeset = changeset;
    reconcileChangeset(changeset, !hasLoadedChangeset);
    hasLoadedChangeset = true;
  });
  hunk.on("session_reload", ({ changeset }) => {
    cancelGeneration("idle");
    latestChangeset = changeset;
    reconcileChangeset(changeset, false);
  });
  hunk.on("shutdown", (_event, _ctx: ExtensionEventContext) => {
    cancelGeneration();
    source = null;
    latestChangeset = null;
  });
}
