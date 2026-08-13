import { expect, test } from "vitest";

import { PetAction } from "./actions";
import {
  ACTION_MENU_ITEMS,
  clampMenuPosition,
  FILE_MENU_ITEMS,
  ROOT_MENU_ITEMS,
  submenuSide,
} from "./actionMenu";

test("offers automatic mode and every pet action", () => {
  expect(ACTION_MENU_ITEMS.map((item) => item.value)).toEqual([
    "AUTO",
    ...Object.values(PetAction),
  ]);
});

test("groups actions and food under nested root menu items", () => {
  expect(ROOT_MENU_ITEMS.map((item) => item.id)).toEqual([
    "actions",
    "files",
    "capabilities",
  ]);
  expect(ACTION_MENU_ITEMS.map((item) => item.value)).toEqual([
    "AUTO",
    ...Object.values(PetAction),
  ]);
  expect(FILE_MENU_ITEMS).toEqual([
    { value: "file", label: "吃文件…" },
    { value: "folder", label: "吃文件夹…" },
  ]);
});

test("opens a submenu toward available horizontal space", () => {
  expect(submenuSide(8, 132, 168, 280, 8)).toBe("right");
  expect(submenuSide(140, 132, 168, 280, 8)).toBe("left");
});

test("keeps the action menu inside the pet window", () => {
  expect(clampMenuPosition(
    { x: 270, y: 310 },
    { width: 168, height: 244 },
    { width: 280, height: 320 },
    8,
  )).toEqual({ x: 104, y: 68 });
});
