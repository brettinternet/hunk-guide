import type { ExtensionPanePlacement } from "hunkdiff/extension";

export interface GuideConfig {
  file?: string;
  defaultOpen: boolean;
  placement: Extract<ExtensionPanePlacement, "left" | "right">;
}

export function readConfig(raw: Record<string, unknown> = {}): GuideConfig {
  const file = typeof raw.file === "string" && raw.file.trim() ? raw.file.trim() : undefined;
  const placement = raw.placement === "left" ? "left" : "right";

  return {
    file,
    defaultOpen: typeof raw.default_open === "boolean" ? raw.default_open : true,
    placement,
  };
}
