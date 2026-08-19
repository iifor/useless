import { describe, expect, test } from "vitest";

import {
  canStartPetDrag,
  petContextMenuPoint,
  shouldEnableDebugMenu,
} from "../../src/pet/petInput";

describe("pet canvas input", () => {
  test("enables the debug menu only in development builds", () => {
    expect(shouldEnableDebugMenu("development")).toBe(true);
    expect(shouldEnableDebugMenu("production")).toBe(false);
    expect(shouldEnableDebugMenu("test")).toBe(false);
  });

  test("starts dragging only for an enabled primary-button Tauri event", () => {
    expect(canStartPetDrag(false, 0, true)).toBe(true);
    expect(canStartPetDrag(true, 0, true)).toBe(false);
    expect(canStartPetDrag(false, 2, true)).toBe(false);
    expect(canStartPetDrag(false, 0, false)).toBe(false);
  });

  test("uses the canvas event coordinates for the custom context menu", () => {
    expect(petContextMenuPoint(73, 119)).toEqual({ x: 73, y: 119 });
  });
});
