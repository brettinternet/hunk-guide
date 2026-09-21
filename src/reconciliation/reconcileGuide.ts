import type { TargetFingerprint } from "../navigation.ts";

export type Comparison = "same" | "different" | "unknown";

export function compareFingerprints(
  previous: TargetFingerprint | undefined,
  current: TargetFingerprint | undefined,
): Comparison {
  if (!previous || !current) return "unknown";
  if (previous.definition !== current.definition) return "different";
  if (previous.content !== undefined && current.content !== undefined) {
    return previous.content === current.content ? "same" : "different";
  }
  if (previous.patch !== undefined && current.patch !== undefined) {
    return previous.patch === current.patch ? "same" : "different";
  }
  return "unknown";
}
