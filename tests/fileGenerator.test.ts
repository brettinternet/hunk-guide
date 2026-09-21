import { describe, expect, test } from "bun:test";

import { loadGuideFile, resolveGuideFile } from "../src/generators/file.ts";

const json = JSON.stringify({
  version: 1,
  id: "fixture",
  sections: [
    {
      id: "section",
      title: "Section",
      targets: [{ id: "target", path: "src/index.ts", startLine: 1 }],
    },
  ],
});

describe("resolveGuideFile", () => {
  test("prefers the environment and resolves it from the review cwd", async () => {
    const source = await resolveGuideFile({
      cwd: "/repo",
      configFile: ".hunk/config-guide.json",
      environmentFile: "agent-guide.json",
    });
    expect(source).toEqual({ path: "/repo/agent-guide.json", origin: "environment" });
  });

  test("keeps repository-controlled config paths inside the review", async () => {
    await expect(resolveGuideFile({ cwd: "/repo", configFile: "../outside.json" })).rejects.toThrow(
      "must remain inside",
    );
  });

  test("prefers the namespaced default and supports the legacy root file", async () => {
    expect(
      await resolveGuideFile({
        cwd: "/repo",
        exists: async () => true,
      }),
    ).toEqual({ path: "/repo/.hunk/guide.json", origin: "default" });
    expect(
      await resolveGuideFile({
        cwd: "/repo",
        exists: async (path) => path.endsWith("hunk-guide.json"),
      }),
    ).toEqual({ path: "/repo/hunk-guide.json", origin: "default" });
    expect(await resolveGuideFile({ cwd: "/repo", exists: async () => false })).toBeNull();
  });
});

describe("loadGuideFile", () => {
  const source = { path: "/repo/guide.json", origin: "environment" as const };

  test("loads validated JSON", async () => {
    const loaded = await loadGuideFile(source, {
      size: async () => json.length,
      read: async () => json,
    });
    expect(loaded.id).toBe("fixture");
  });

  test("rejects malformed generator output", async () => {
    await expect(
      loadGuideFile(source, { size: async () => 1, read: async () => "{" }),
    ).rejects.toThrow("could not parse guide JSON");
  });

  test("rejects oversized input before reading", async () => {
    let read = false;
    await expect(
      loadGuideFile(source, {
        size: async () => 1_000_001,
        read: async () => {
          read = true;
          return json;
        },
      }),
    ).rejects.toThrow("exceeds");
    expect(read).toBeFalse();
  });
});
