import { expect, test } from "vitest";

import { PetAction } from "../../src/pet/actions";
import {
  ACTION_MENU_ITEMS,
  clampMenuPosition,
  FILE_MENU_ITEMS,
  MANUAL_ACTIONS,
  ROOT_MENU_ITEMS,
  submenuPlacement,
  submenuSide,
  submenuTop,
} from "../../src/pet/actionMenu";

test("offers automatic mode and every manual action", () => {
  expect(ACTION_MENU_ITEMS.map((item) => item.value)).toEqual([
    "AUTO",
    ...MANUAL_ACTIONS,
  ]);
  expect(ACTION_MENU_ITEMS.map((item) => item.value)).not.toContain(PetAction.LOOK_AT_FILE);
  expect(ACTION_MENU_ITEMS.map((item) => item.value)).not.toContain(PetAction.ASK_CONFIRM);
  expect(ACTION_MENU_ITEMS.map((item) => item.value)).not.toContain(PetAction.EAT_NORMAL);
  expect(ACTION_MENU_ITEMS).toContainEqual({
    value: PetAction.SEARCH_CURRENT_WINDOW,
    label: "坐到当前窗口",
  });
  expect(ACTION_MENU_ITEMS).toContainEqual({
    value: PetAction.SEARCH_DESKTOP_ICON,
    label: "寻找桌面图标",
  });
});

test("groups actions and food under nested root menu items", () => {
  expect(ROOT_MENU_ITEMS.map((item) => item.id)).toEqual([
    "actions",
    "files",
    "capabilities",
  ]);
  expect(ACTION_MENU_ITEMS.map((item) => item.value)).toEqual([
    "AUTO",
    ...MANUAL_ACTIONS,
  ]);
  expect(FILE_MENU_ITEMS).toEqual([
    { value: "file", label: "吃文件…" },
    { value: "folder", label: "吃文件夹…" },
  ]);
});

test("opens a submenu toward available horizontal space", () => {
  expect(submenuSide(8, 132, 136, 280, 4)).toBe("right");
  expect(submenuSide(140, 132, 136, 280, 4)).toBe("left");
});

test("keeps the root and submenu inside the window from a middle anchor", () => {
  expect(submenuPlacement(8, 132, 136, 280, 4)).toEqual({ rootX: 8, side: "right" });
  expect(submenuPlacement(100, 132, 136, 280, 4)).toEqual({ rootX: 140, side: "left" });
  expect(submenuPlacement(140, 132, 136, 280, 4)).toEqual({ rootX: 140, side: "left" });

  const placement = submenuPlacement(100, 132, 136, 280, 4);
  expect([placement.rootX - 4 - 136, placement.rootX + 132]).toEqual([0, 272]);
});

test("keeps the action menu inside the pet window", () => {
  expect(clampMenuPosition(
    { x: 270, y: 310 },
    { width: 168, height: 244 },
    { width: 280, height: 320 },
    8,
  )).toEqual({ x: 104, y: 68 });
});

test("moves a tall submenu upward when the root opens near the bottom", () => {
  const top = submenuTop(216, 0, 28, 238, 320, 8);

  expect(top).toBe(-142);
  expect(216 + top).toBe(74);
  expect(216 + top + 238).toBe(312);
});
