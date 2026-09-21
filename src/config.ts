import type { ExtensionPanePlacement } from "hunkdiff/extension";

export type GuideDetail = "compact" | "balanced" | "thorough";

export interface GuideConfig {
  file?: string;
  defaultOpen: boolean;
  placement: Extract<ExtensionPanePlacement, "left" | "right">;
  detail: GuideDetail;
  maxSections?: number;
  showVerification: boolean;
  showSupporting: boolean;
  showMechanical: boolean;
}

function isDetail(value: unknown): value is GuideDetail {
  return value === "compact" || value === "balanced" || value === "thorough";
}

export function sectionLimitWarning(sectionCount: number, maxSections?: number): string | null {
  if (maxSections === undefined || sectionCount <= maxSections) return null;
  return `Guide has ${sectionCount} sections, exceeding max_sections = ${maxSections}; no content was removed`;
}

export function readConfig(raw: Record<string, unknown> = {}): GuideConfig {
  const file = typeof raw.file === "string" && raw.file.trim() ? raw.file.trim() : undefined;
  const placement = raw.placement === "left" ? "left" : "right";
  const maxSections =
    typeof raw.max_sections === "number" &&
    Number.isSafeInteger(raw.max_sections) &&
    raw.max_sections > 0
      ? raw.max_sections
      : undefined;

  return {
    file,
    defaultOpen: typeof raw.default_open === "boolean" ? raw.default_open : true,
    placement,
    detail: isDetail(raw.detail) ? raw.detail : "balanced",
    maxSections,
    showVerification: typeof raw.show_verification === "boolean" ? raw.show_verification : true,
    showSupporting: typeof raw.show_supporting === "boolean" ? raw.show_supporting : false,
    showMechanical: typeof raw.show_mechanical === "boolean" ? raw.show_mechanical : false,
  };
}
