// Hunk main has API 30, but the latest npm release (0.23.0) still has API 29.
// Keep this declaration bridge until API 30 ships; it adds no runtime fallback.
// Source: modem-dev/hunk@d2e85a0847fcee8911ce386ea7b03888586049e4
import "hunkdiff/extension";

declare module "hunkdiff/extension" {
  export interface ExtensionReviewPresentationScopeFile {
    readonly fileId: string;
    readonly hunkIndexes: readonly number[];
  }

  export interface ExtensionReviewPresentationScope {
    readonly generation: string;
    readonly files: readonly ExtensionReviewPresentationScopeFile[];
  }

  export interface ExtensionReviewPresentationControls {
    setPresentationScope(scope: ExtensionReviewPresentationScope): boolean;
    clearPresentationScope(): void;
  }

  export interface ExtensionReviewControls extends ExtensionReviewPresentationControls {}

  export interface ExtensionPaneActions extends ExtensionReviewPresentationControls {}

  export interface ExtensionPaneProps {
    readonly reviewGeneration: string | null;
  }
}
