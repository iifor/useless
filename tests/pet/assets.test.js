import { existsSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { ANIMATIONS } from "../../src/pet/animations";

describe("pet animation assets", () => {
  test("every configured asset exists and is non-empty", () => {
    for (const animation of Object.values(ANIMATIONS)) {
      const asset = join(process.cwd(), "public", animation.source.replace(/^\//, ""));
      expect(existsSync(asset), animation.source).toBe(true);
      expect(statSync(asset).size, animation.source).toBeGreaterThan(0);
    }
  });
});
