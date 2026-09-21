import { expect, test } from "bun:test";

import { readConfig } from "../src/config.ts";

test("configuration validates untrusted Hunk values", () => {
  expect(readConfig(undefined, undefined)).toEqual({
    command: null,
    providerTimeoutSeconds: 300,
    defaultOpen: true,
    placement: "right",
    density: "balanced",
    showVerification: true,
    showSupporting: false,
    showMechanical: false,
  });
  expect(
    readConfig(
      {
        file: " .hunk/guide.json ",
        default_open: false,
        placement: "left",
        density: "thorough",
        show_verification: false,
        show_supporting: true,
        show_mechanical: true,
        provider_timeout_seconds: 1,
      },
      "generator",
    ),
  ).toEqual({
    file: ".hunk/guide.json",
    command: { argv: ["generator"] },
    providerTimeoutSeconds: 10,
    defaultOpen: false,
    placement: "left",
    density: "thorough",
    showVerification: false,
    showSupporting: true,
    showMechanical: true,
  });
  expect(readConfig({ provider_timeout_seconds: 9999 }, undefined).providerTimeoutSeconds).toBe(
    1800,
  );
});
