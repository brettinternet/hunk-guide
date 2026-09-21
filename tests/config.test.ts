import { expect, test } from "bun:test";

import { readConfig } from "../src/config.ts";

test("configuration validates untrusted Hunk values", () => {
  expect(readConfig()).toEqual({ defaultOpen: true, placement: "right" });
  expect(
    readConfig({ file: " .hunk/guide.json ", default_open: false, placement: "left" }),
  ).toEqual({
    file: ".hunk/guide.json",
    defaultOpen: false,
    placement: "left",
  });
  expect(readConfig({ file: 42, default_open: "yes", placement: "bottom" })).toEqual({
    defaultOpen: true,
    placement: "right",
  });
});
