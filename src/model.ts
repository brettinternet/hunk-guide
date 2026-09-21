export const GUIDE_VERSION = 1 as const;

const LIMITS = {
  sections: 50,
  targets: 500,
  id: 120,
  title: 240,
  explanation: 4_000,
  path: 1_024,
  symbol: 512,
  schema: 2_048,
} as const;

export type GuideSide = "old" | "new";
export type GuideSectionKind = "change" | "verification" | "supporting" | "mechanical";

export interface GuideTarget {
  id: string;
  path: string;
  side: GuideSide;
  startLine: number;
  endLine: number;
  symbol?: string;
}

export interface GuideSection {
  id: string;
  kind?: GuideSectionKind;
  title: string;
  explanation?: string;
  targets: readonly GuideTarget[];
}

export interface GuideDocument {
  version: typeof GUIDE_VERSION;
  id: string;
  title?: string;
  summary?: string;
  sections: readonly GuideSection[];
}

export class GuideValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GuideValidationError";
  }
}

function fail(path: string, message: string): never {
  throw new GuideValidationError(`${path}: ${message}`);
}

function objectAt(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(path, "expected an object");
  }
  return value as Record<string, unknown>;
}

function stringAt(
  value: unknown,
  path: string,
  options: { max: number; optional?: boolean },
): string | undefined {
  if (value === undefined && options.optional) return undefined;
  if (typeof value !== "string") fail(path, "expected a string");
  const normalized = value.trim();
  if (!normalized) fail(path, "must not be empty");
  if (normalized.length > options.max) fail(path, `must be at most ${options.max} characters`);
  return normalized;
}

function lineAt(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    fail(path, "expected a positive integer");
  }
  return value as number;
}

function assertKeys(value: Record<string, unknown>, path: string, allowed: readonly string[]) {
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown) fail(`${path}.${unknown}`, "unknown field");
}

function parseTarget(value: unknown, path: string): GuideTarget {
  const target = objectAt(value, path);
  assertKeys(target, path, ["id", "path", "side", "startLine", "endLine", "symbol"]);

  const id = stringAt(target.id, `${path}.id`, { max: LIMITS.id })!;
  const targetPath = stringAt(target.path, `${path}.path`, { max: LIMITS.path })!;
  const side = target.side ?? "new";
  if (side !== "old" && side !== "new") fail(`${path}.side`, 'expected "old" or "new"');
  const startLine = lineAt(target.startLine, `${path}.startLine`);
  const endLine =
    target.endLine === undefined ? startLine : lineAt(target.endLine, `${path}.endLine`);
  if (endLine < startLine) fail(`${path}.endLine`, "must be greater than or equal to startLine");

  return {
    id,
    path: targetPath,
    side,
    startLine,
    endLine,
    symbol: stringAt(target.symbol, `${path}.symbol`, { max: LIMITS.symbol, optional: true }),
  };
}

function parseSection(value: unknown, path: string): GuideSection {
  const section = objectAt(value, path);
  assertKeys(section, path, ["id", "kind", "title", "explanation", "targets"]);
  if (!Array.isArray(section.targets)) fail(`${path}.targets`, "expected an array");
  if (section.targets.length === 0) fail(`${path}.targets`, "must contain at least one target");

  const kind = section.kind ?? "change";
  if (!["change", "verification", "supporting", "mechanical"].includes(kind as string)) {
    fail(`${path}.kind`, 'expected "change", "verification", "supporting", or "mechanical"');
  }

  return {
    id: stringAt(section.id, `${path}.id`, { max: LIMITS.id })!,
    kind: kind as GuideSectionKind,
    title: stringAt(section.title, `${path}.title`, { max: LIMITS.title })!,
    explanation: stringAt(section.explanation, `${path}.explanation`, {
      max: LIMITS.explanation,
      optional: true,
    }),
    targets: section.targets.map((target, index) =>
      parseTarget(target, `${path}.targets[${index}]`),
    ),
  };
}

export function parseGuide(value: unknown): GuideDocument {
  const guide = objectAt(value, "guide");
  assertKeys(guide, "guide", ["$schema", "version", "id", "title", "summary", "sections"]);
  stringAt(guide.$schema, "guide.$schema", { max: LIMITS.schema, optional: true });
  if (guide.version !== GUIDE_VERSION) fail("guide.version", `expected ${GUIDE_VERSION}`);
  if (!Array.isArray(guide.sections)) fail("guide.sections", "expected an array");
  if (guide.sections.length === 0) fail("guide.sections", "must contain at least one section");
  if (guide.sections.length > LIMITS.sections) {
    fail("guide.sections", `must contain at most ${LIMITS.sections} sections`);
  }

  const sections = guide.sections.map((section, index) =>
    parseSection(section, `guide.sections[${index}]`),
  );
  const targetCount = sections.reduce((count, section) => count + section.targets.length, 0);
  if (targetCount > LIMITS.targets)
    fail("guide.sections", `must contain at most ${LIMITS.targets} targets`);

  const sectionIds = new Set<string>();
  const targetIds = new Set<string>();
  for (const section of sections) {
    if (sectionIds.has(section.id)) fail("guide.sections", `duplicate section id "${section.id}"`);
    sectionIds.add(section.id);
    for (const target of section.targets) {
      if (targetIds.has(target.id)) fail("guide.sections", `duplicate target id "${target.id}"`);
      targetIds.add(target.id);
    }
  }

  return {
    version: GUIDE_VERSION,
    id: stringAt(guide.id, "guide.id", { max: LIMITS.id })!,
    title: stringAt(guide.title, "guide.title", { max: LIMITS.title, optional: true }),
    summary: stringAt(guide.summary, "guide.summary", {
      max: LIMITS.explanation,
      optional: true,
    }),
    sections,
  };
}

export function guideTargetDefinition(target: GuideTarget): string {
  return [target.path, target.side, target.startLine, target.endLine, target.symbol ?? ""].join(
    "\u0000",
  );
}
