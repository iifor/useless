import { PetAction } from "./actions";
import type { Point, Size } from "./windowMotion";

export const ACTION_MENU_ITEMS = [
  { value: "AUTO", label: "自动模式" },
  { value: PetAction.IDLE_STAND, label: "站着" },
  { value: PetAction.IDLE_SIT, label: "坐着" },
  { value: PetAction.IDLE_PRONE, label: "趴着" },
  { value: PetAction.IDLE_LIE, label: "侧躺" },
  { value: PetAction.WALK_SLOW, label: "慢慢走" },
  { value: PetAction.SEARCH_SEAT, label: "寻找桌面座位" },
  { value: PetAction.SEAT_ON_ITEM, label: "坐在图标上" },
] as const;

export const ROOT_MENU_ITEMS = [
  { id: "actions", label: "动作" },
  { id: "files", label: "文件" },
  { id: "capabilities", label: "宠物能力" },
] as const;

export const FILE_MENU_ITEMS = [
  { value: "file", label: "吃文件…" },
  { value: "folder", label: "吃文件夹…" },
] as const;

export type ActionMenuValue = typeof ACTION_MENU_ITEMS[number]["value"];
export type FoodPickerKind = typeof FILE_MENU_ITEMS[number]["value"];

export function submenuSide(
  rootX: number,
  rootWidth: number,
  submenuWidth: number,
  windowWidth: number,
  margin: number,
): "left" | "right" {
  return rootX + rootWidth + submenuWidth + margin <= windowWidth ? "right" : "left";
}

export function clampMenuPosition(
  point: Point,
  menuSize: Size,
  windowSize: Size,
  margin: number,
): Point {
  return {
    x: Math.min(Math.max(point.x, margin), windowSize.width - menuSize.width - margin),
    y: Math.min(Math.max(point.y, margin), windowSize.height - menuSize.height - margin),
  };
}
