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
