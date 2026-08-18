import { PetAction, isActionSupported } from "./actions";
import type { CharacterManifest } from "./characterManifest";
import type { Point, Size } from "./windowMotion";

export const MANUAL_ACTIONS = [
  PetAction.IDLE_STAND,
  PetAction.IDLE_SIT,
  PetAction.IDLE_PRONE,
  PetAction.IDLE_LIE,
  PetAction.WALK_SLOW,
  PetAction.SEARCH_SEAT,
  PetAction.SEARCH_CURRENT_WINDOW,
  PetAction.SEARCH_DESKTOP_ICON,
  PetAction.SEAT_ON_ITEM,
] as const;

export type ManualAction = typeof MANUAL_ACTIONS[number];

const MANUAL_ACTION_LABELS: Record<ManualAction, string> = {
  [PetAction.IDLE_STAND]: "站着",
  [PetAction.IDLE_SIT]: "坐着",
  [PetAction.IDLE_PRONE]: "趴着",
  [PetAction.IDLE_LIE]: "侧躺",
  [PetAction.WALK_SLOW]: "慢慢走",
  [PetAction.SEARCH_SEAT]: "寻找桌面座位",
  [PetAction.SEARCH_CURRENT_WINDOW]: "坐到当前窗口",
  [PetAction.SEARCH_DESKTOP_ICON]: "寻找桌面图标",
  [PetAction.SEAT_ON_ITEM]: "坐在图标上",
};

export type ActionMenuValue = "AUTO" | ManualAction;

export interface ActionMenuItem {
  value: ActionMenuValue;
  label: string;
}

export const actionMenuItemsFor = (character: CharacterManifest): ActionMenuItem[] => [
  { value: "AUTO", label: "自动模式" },
  ...MANUAL_ACTIONS
    .filter((action) => isActionSupported(character, action))
    .map((value) => ({ value, label: MANUAL_ACTION_LABELS[value] })),
];

const ROOT_MENU_ITEMS = [
  { id: "actions", label: "动作" },
  { id: "files", label: "文件" },
  { id: "capabilities", label: "宠物能力" },
] as const;

export type RootMenuItem = typeof ROOT_MENU_ITEMS[number];

export const rootMenuItemsFor = (character: CharacterManifest): RootMenuItem[] =>
  ROOT_MENU_ITEMS.filter((item) => item.id !== "files"
    || character.capabilities.includes("file-eating"));

export const FILE_MENU_ITEMS = [
  { value: "file", label: "吃文件…" },
  { value: "folder", label: "吃文件夹…" },
] as const;

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

export function submenuPlacement(
  rootX: number,
  rootWidth: number,
  submenuWidth: number,
  windowWidth: number,
  margin: number,
): { rootX: number; side: "left" | "right" } {
  const rightRootX = Math.min(
    Math.max(rootX, 0),
    windowWidth - rootWidth - submenuWidth - margin,
  );
  const leftRootX = Math.min(
    Math.max(rootX, submenuWidth + margin),
    windowWidth - rootWidth,
  );
  return Math.abs(rootX - rightRootX) <= Math.abs(rootX - leftRootX)
    ? { rootX: rightRootX, side: "right" }
    : { rootX: leftRootX, side: "left" };
}

export function submenuTop(
  rootY: number,
  itemIndex: number,
  itemHeight: number,
  submenuHeight: number,
  windowHeight: number,
  margin: number,
): number {
  const desiredTop = rootY + itemIndex * itemHeight;
  const windowTop = Math.min(
    Math.max(desiredTop, margin),
    windowHeight - submenuHeight - margin,
  );
  return windowTop - rootY;
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
