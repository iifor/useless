import { useEffect, useState, type PointerEvent } from "react";

import {
  ACTION_MENU_ITEMS,
  clampMenuPosition,
  type ActionMenuValue,
  FILE_MENU_ITEMS,
  type FoodPickerKind,
  ROOT_MENU_ITEMS,
  submenuSide,
} from "./actionMenu";
import type { Point } from "./windowMotion";

const MENU_SIZE = { width: 132, height: 96 };
const SUBMENU_WIDTH = 168;
const WINDOW_SIZE = { width: 280, height: 320 };

interface PetActionMenuProps {
  point: Point;
  selection: ActionMenuValue;
  onSelect: (value: ActionMenuValue) => void;
  onChooseFood?: (kind: FoodPickerKind) => void;
  onClose: () => void;
}

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
  const side = submenuSide(position.x, MENU_SIZE.width, SUBMENU_WIDTH, WINDOW_SIZE.width, 8);

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
      style={{ left: position.x, top: position.y }}
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
        <div className="action-menu action-submenu" data-side={side} role="menu">
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
        <div className="action-menu action-submenu" data-side={side} role="menu">
          {FILE_MENU_ITEMS.map((item) => (
            <button
              className="action-menu-item"
              key={item.value}
              onClick={() => onChooseFood?.(item.value)}
              role="menuitem"
              type="button"
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
      {openSubmenu === "capabilities" && (
        <div className="action-menu action-submenu" data-side={side} role="menu">
          <button className="action-menu-item" disabled role="menuitem" type="button">
            暂无能力
          </button>
        </div>
      )}
    </nav>
  );
}
