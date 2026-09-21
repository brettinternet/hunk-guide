import { expect, test } from "bun:test";

import { readConfig, sectionLimitWarning } from "../src/config.ts";

test("configuration validates untrusted Hunk values", () => {
  expect(readConfig()).toEqual({
    defaultOpen: true,
    placement: "right",
    detail: "balanced",
  });
  expect(
    readConfig({
      file: " .hunk/guide.json ",
      default_open: false,
      placement: "left",
      detail: "thorough",
      max_sections: 9,
    }),
  ).toEqual({
    file: ".hunk/guide.json",
    defaultOpen: false,
    placement: "left",
    detail: "thorough",
    maxSections: 9,
  });
  expect(
    readConfig({
      file: 42,
      default_open: "yes",
      placement: "bottom",
      detail: "verbose",
      max_sections: 0,
    }),
  ).toEqual({
    defaultOpen: true,
    placement: "right",
    detail: "balanced",
  });
});

test("max_sections must be a positive safe integer", () => {
  for (const max_sections of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, "7"]) {
    expect(readConfig({ max_sections }).maxSections).toBeUndefined();
  }
  expect(readConfig({ max_sections: 1 }).maxSections).toBe(1);
});

test("section limits warn without changing guide content", () => {
  expect(sectionLimitWarning(7, 7)).toBeNull();
  expect(sectionLimitWarning(40)).toBeNull();
  expect(sectionLimitWarning(8, 7)).toBe(
    "Guide has 8 sections, exceeding max_sections = 7; no content was removed",
  );
});
