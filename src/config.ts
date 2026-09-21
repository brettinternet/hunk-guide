import type { ExtensionPanePlacement } from "hunkdiff/extension";

export type GuideDensity = "compact" | "balanced" | "thorough";

export interface GuideConfig {
  file?: string;
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

export function readConfig(raw: Record<string, unknown> = {}): GuideConfig {
  const file = typeof raw.file === "string" && raw.file.trim() ? raw.file.trim() : undefined;
  const placement = raw.placement === "left" ? "left" : "right";
  return {
    file,
    defaultOpen: typeof raw.default_open === "boolean" ? raw.default_open : true,
    placement,
    density: isDensity(raw.density) ? raw.density : "balanced",
    showVerification: typeof raw.show_verification === "boolean" ? raw.show_verification : true,
    showSupporting: typeof raw.show_supporting === "boolean" ? raw.show_supporting : false,
    showMechanical: typeof raw.show_mechanical === "boolean" ? raw.show_mechanical : false,
  };
}
