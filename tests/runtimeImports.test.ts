import { expect, test } from "bun:test";
import { dirname, relative, resolve, sep } from "node:path";

test("host runtime imports stay inside Hunk's extension source boundary", async () => {
  const entry = resolve(import.meta.dir, "../hunk-guide/index.tsx");
  const runtimeImports: string[] = [];
  const result = await Bun.build({
    entrypoints: [entry],
    target: "bun",
    plugins: [
      {
        name: "check-host-runtime-boundary",
        setup(build) {
          build.onResolve(
            { filter: /^(?:react(?:\/|$)|@opentui\/|hunkdiff\/extension$)/ },
            (args) => {
              runtimeImports.push(args.importer);
              return { path: args.path, external: true };
            },
          );
        },
      },
    ],
  });

  expect(result.success, result.logs.map(String).join("\n")).toBeTrue();
  expect(runtimeImports.length).toBeGreaterThan(0);
  for (const importer of runtimeImports) {
    const path = relative(dirname(entry), importer);
    expect(path.startsWith(`..${sep}`), importer).toBeFalse();
  }
});
