import { useEffect, useState, type PointerEvent } from "react";

import {
  type ActionMenuItem,
  clampMenuPosition,
  type ActionMenuValue,
  FILE_MENU_ITEMS,
  type FoodPickerKind,
  type RootMenuItem,
  submenuPlacement,
  submenuTop,
} from "./actionMenu";
import type { Point } from "./windowMotion";

const MENU_SIZE = { width: 132, height: 96 };
const SUBMENU_WIDTH = 136;
const WINDOW_SIZE = { width: 280, height: 320 };
const ITEM_HEIGHT = 28;
const MENU_CHROME_HEIGHT = 14;
const SUBMENU_MAX_HEIGHT = 304;

interface PetActionMenuProps {
  actionItems: ActionMenuItem[];
  displayName: string;
  point: Point;
  selection: ActionMenuValue;
  onSelect: (value: ActionMenuValue) => void;
  onChooseFood: (kind: FoodPickerKind) => void | Promise<void>;
  onClose: () => void;
  rootItems: RootMenuItem[];
}

export const runMenuChoice = (
  choose: () => void | Promise<void>,
): Promise<void> => Promise.resolve().then(choose).catch((error) => console.error(error));

export default function PetActionMenu({
  actionItems,
  displayName,
  point,
  selection,
  onSelect,
  onChooseFood,
  onClose,
  rootItems,
}: PetActionMenuProps) {
  const position = clampMenuPosition(point, MENU_SIZE, WINDOW_SIZE, 8);
  const [openSubmenu, setOpenSubmenu] = useState<
    "actions" | "files" | "capabilities" | null
  >(null);
  const submenu = submenuPlacement(
    position.x,
    MENU_SIZE.width,
    SUBMENU_WIDTH,
    WINDOW_SIZE.width,
    4,
  );
  const topFor = (itemIndex: number, itemCount: number) => submenuTop(
    position.y,
    itemIndex,
    ITEM_HEIGHT,
    Math.min(itemCount * ITEM_HEIGHT + MENU_CHROME_HEIGHT, SUBMENU_MAX_HEIGHT),
    WINDOW_SIZE.height,
    8,
  );
  const rootIndex = (id: RootMenuItem["id"]) => rootItems.findIndex((item) => item.id === id);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  const keepOpen = (event: PointerEvent<HTMLElement>) => event.stopPropagation();

  return (
    <nav
      aria-label={`${displayName} 动作菜单`}
      className="action-menu"
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={keepOpen}
      role="menu"
      style={{ left: submenu.rootX, top: position.y }}
    >
      {rootItems.map((item) => (
        <button
          className="action-menu-item"
          key={item.id}
          onClick={() => setOpenSubmenu(item.id)}
          onPointerEnter={() => setOpenSubmenu(item.id)}
          role="menuitem"
          type="button"
        >
          {item.label}
        </button>
      ))}
      {openSubmenu === "actions" && (
        <div
          className="action-menu action-submenu"
          data-side={submenu.side}
          role="menu"
          style={{ top: topFor(rootIndex("actions"), actionItems.length) }}
        >
          {actionItems.map((item) => (
            <button
              aria-checked={selection === item.value}
              className="action-menu-item"
              key={item.value}
              onClick={() => onSelect(item.value)}
              role="menuitemradio"
              type="button"
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
      {openSubmenu === "files" && (
        <div
          className="action-menu action-submenu"
          data-side={submenu.side}
          role="menu"
          style={{ top: topFor(rootIndex("files"), FILE_MENU_ITEMS.length) }}
        >
          {FILE_MENU_ITEMS.map((item) => (
            <button
              className="action-menu-item"
              key={item.value}
              onClick={() => { void runMenuChoice(() => onChooseFood(item.value)); }}
              role="menuitem"
              type="button"
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
      {openSubmenu === "capabilities" && (
        <div
          className="action-menu action-submenu"
          data-side={submenu.side}
          role="menu"
          style={{ top: topFor(rootIndex("capabilities"), 1) }}
        >
          <button className="action-menu-item" disabled role="menuitem" type="button">
            暂无能力
          </button>
        </div>
      )}
    </nav>
  );
}
