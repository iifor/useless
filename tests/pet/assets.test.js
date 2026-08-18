import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { ANIMATIONS, availablePoses } from "../../src/pet/animations";
import { reducedCharacter } from "./characterFixtures";

describe("pet animation assets", () => {
  test("every configured asset exists and is non-empty", () => {
    for (const pose of availablePoses(reducedCharacter)) {
      const animation = ANIMATIONS[pose];
      const asset = join(process.cwd(), "public", animation.source.replace(/^\//, ""));
      expect(existsSync(asset), animation.source).toBe(true);
      expect(statSync(asset).size, animation.source).toBeGreaterThan(0);
    }
  });

  test("keeps a shared superset while the staged reduced role omits optional idle assets", () => {
    expect(Object.keys(ANIMATIONS)).toEqual([
      "idle-stand",
      "idle-sit",
      "idle-prone",
      "idle-lie",
      "walk-slow-left",
      "walk-slow-right",
      "walk-slow-up",
      "walk-slow-down",
      "search-seat",
      "search-current-window",
      "search-desktop-icon",
      "seat-on-item",
      "look-file",
      "ask-confirm",
      "eat-normal",
    ]);
    for (const removed of ["idle-prone.png", "idle-lie.png", "sleep-side.png"]) {
      expect(existsSync(join(process.cwd(), "public/pet/extended-animations", removed))).toBe(false);
    }
    expect(
      readFileSync("public/pet/spritesheet.webp").equals(
        readFileSync("artifacts/uno-yan-hatch/package/spritesheet.webp"),
      ),
    ).toBe(true);
  });
});
