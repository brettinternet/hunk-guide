import { expect, test } from "bun:test";

import { readConfig } from "../src/config.ts";

test("configuration validates untrusted Hunk values", () => {
  expect(readConfig()).toEqual({
    defaultOpen: true,
    placement: "right",
    density: "balanced",
    showVerification: true,
    showSupporting: false,
    showMechanical: false,
  });
  expect(
    readConfig({
      file: " .hunk/guide.json ",
      default_open: false,
      placement: "left",
      density: "thorough",
      show_verification: false,
      show_supporting: true,
      show_mechanical: true,
    }),
  ).toEqual({
    file: ".hunk/guide.json",
    defaultOpen: false,
    placement: "left",
    density: "thorough",
    showVerification: false,
    showSupporting: true,
    showMechanical: true,
  });
  expect(
    readConfig({
      file: 42,
      default_open: "yes",
      placement: "bottom",
      density: "verbose",
      show_verification: "no",
      show_supporting: 0,
      show_mechanical: "yes",
    }),
  ).toEqual({
    defaultOpen: true,
    placement: "right",
    density: "balanced",
    showVerification: true,
    showSupporting: false,
    showMechanical: false,
  });
});
