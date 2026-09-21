import { describe, expect, test } from "bun:test";

import { GuideValidationError, parseGuide } from "../src/model.ts";

const valid = {
  version: 1,
  id: "guide",
  title: "A guide",
  sections: [
    {
      id: "model",
      title: "Model",
      targets: [{ id: "types", path: "src/types.ts", startLine: 3 }],
    },
  ],
};

describe("parseGuide", () => {
  test("normalizes defaults without reordering sections or targets", () => {
    const parsed = parseGuide({
      ...valid,
      sections: [
        valid.sections[0],
        {
          id: "tests",
          title: "Tests",
          targets: [
            { id: "second", path: "tests/two.ts", side: "old", startLine: 8, endLine: 10 },
            { id: "first", path: "tests/one.ts", startLine: 2 },
          ],
        },
      ],
    });

    expect(parsed.sections.map((section) => section.id)).toEqual(["model", "tests"]);
    expect(parsed.sections[1]!.targets.map((target) => target.id)).toEqual(["second", "first"]);
    expect(parsed.sections[0]!.targets[0]).toMatchObject({ side: "new", startLine: 3, endLine: 3 });
  });

  test.each([
    [{ ...valid, version: 2 }, "guide.version"],
    [{ ...valid, extra: true }, "guide.extra"],
    [{ ...valid, sections: [] }, "guide.sections"],
    [
      {
        ...valid,
        sections: [
          ...valid.sections,
          { id: "other", title: "Other", targets: [{ ...valid.sections[0]!.targets[0] }] },
        ],
      },
      "duplicate target id",
    ],
    [
      {
        ...valid,
        sections: [
          {
            ...valid.sections[0],
            targets: [{ ...valid.sections[0]!.targets[0], startLine: 5, endLine: 4 }],
          },
        ],
      },
      "endLine",
    ],
  ])("rejects malformed guides", (value, message) => {
    expect(() => parseGuide(value)).toThrow(GuideValidationError);
    expect(() => parseGuide(value)).toThrow(String(message));
  });
});
