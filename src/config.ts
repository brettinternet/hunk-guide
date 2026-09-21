import type { ExtensionPanePlacement } from "hunkdiff/extension";

import {
  DEFAULT_PROVIDER_TIMEOUT_SECONDS,
  MAX_PROVIDER_TIMEOUT_SECONDS,
  MIN_PROVIDER_TIMEOUT_SECONDS,
  parseCommandSpec,
  type CommandSpec,
} from "./generators/command.ts";

export type GuideDensity = "compact" | "balanced" | "thorough";

export interface GuideConfig {
  file?: string;
  command: CommandSpec | null;
  providerTimeoutSeconds: number;
  commandError?: string;
  defaultOpen: boolean;
  placement: Extract<ExtensionPanePlacement, "left" | "right">;
  density: GuideDensity;
  showVerification: boolean;
  showSupporting: boolean;
  showMechanical: boolean;
}

function isDensity(value: unknown): value is GuideDensity {
  return value === "compact" || value === "balanced" || value === "thorough";
}

function boundedTimeout(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_PROVIDER_TIMEOUT_SECONDS;
  return Math.min(
    MAX_PROVIDER_TIMEOUT_SECONDS,
    Math.max(MIN_PROVIDER_TIMEOUT_SECONDS, Math.floor(value)),
  );
}

export function readConfig(
  raw: Record<string, unknown> = {},
  environmentCommand = process.env.HUNK_GUIDE_COMMAND,
): GuideConfig {
  const file = typeof raw.file === "string" && raw.file.trim() ? raw.file.trim() : undefined;
  const placement = raw.placement === "left" ? "left" : "right";
  let command: CommandSpec | null = null;
  let commandError: string | undefined;
  try {
    command = parseCommandSpec(environmentCommand);
  } catch (error) {
    commandError = error instanceof Error ? error.message : "invalid guide command";
  }
  const configuredTimeout = raw.provider_timeout_seconds;
  return {
    file,
    command,
    ...(commandError ? { commandError } : {}),
    providerTimeoutSeconds: boundedTimeout(configuredTimeout),
    defaultOpen: typeof raw.default_open === "boolean" ? raw.default_open : true,
    placement,
    density: isDensity(raw.density) ? raw.density : "balanced",
    showVerification: typeof raw.show_verification === "boolean" ? raw.show_verification : true,
    showSupporting: typeof raw.show_supporting === "boolean" ? raw.show_supporting : false,
    showMechanical: typeof raw.show_mechanical === "boolean" ? raw.show_mechanical : false,
  };
}
