import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { ANIMATIONS, availablePoses } from "../../src/pet/animations";

const characterIds = ["uno", "uno-pangyu", "uno-yan"];

const readCharacter = (id) => JSON.parse(readFileSync(
  join(process.cwd(), "characters", id, "character.json"),
  "utf8",
));

describe("pet animation assets", () => {
  test("every character has every configured asset it can use", () => {
    for (const id of characterIds) {
      for (const pose of availablePoses(readCharacter(id))) {
        const animation = ANIMATIONS[pose];
        const asset = join(process.cwd(), "characters", id, animation.source.replace(/^\//, ""));
        expect(existsSync(asset), `${id}${animation.source}`).toBe(true);
        expect(statSync(asset).size, `${id}${animation.source}`).toBeGreaterThan(0);
      }
    }
  });

  test("keeps a shared superset while reduced characters omit optional idle assets", () => {
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
    for (const id of ["uno-pangyu", "uno-yan"]) {
      for (const removed of ["idle-prone.png", "idle-lie.png", "sleep-side.png"]) {
        expect(existsSync(join(
          process.cwd(), "characters", id, "pet/extended-animations", removed,
        ))).toBe(false);
      }
    }
  });
});
