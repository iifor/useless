import { useEffect, useState, type PointerEvent } from "react";

import {
  ACTION_MENU_ITEMS,
  clampMenuPosition,
  type ActionMenuValue,
  FILE_MENU_ITEMS,
  type FoodPickerKind,
  ROOT_MENU_ITEMS,
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
  point: Point;
  selection: ActionMenuValue;
  onSelect: (value: ActionMenuValue) => void;
  onChooseFood: (kind: FoodPickerKind) => void | Promise<void>;
  onClose: () => void;
}

export const runMenuChoice = (
  choose: () => void | Promise<void>,
): Promise<void> => Promise.resolve().then(choose).catch((error) => console.error(error));

export default function PetActionMenu({
  point,
  selection,
  onSelect,
  onChooseFood,
  onClose,
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
      aria-label="宠物动作"
      className="action-menu"
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={keepOpen}
      role="menu"
      style={{ left: submenu.rootX, top: position.y }}
    >
      {ROOT_MENU_ITEMS.map((item) => (
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
          style={{ top: topFor(0, ACTION_MENU_ITEMS.length) }}
        >
          {ACTION_MENU_ITEMS.map((item) => (
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
          style={{ top: topFor(1, FILE_MENU_ITEMS.length) }}
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
          style={{ top: topFor(2, 1) }}
        >
          <button className="action-menu-item" disabled role="menuitem" type="button">
            暂无能力
          </button>
        </div>
      )}
    </nav>
  );
}
