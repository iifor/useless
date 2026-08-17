import { PetAction, type Direction } from "./actions";

export type PetPose =
  | "idle-stand"
  | "idle-sit"
  | "walk-slow-left"
  | "walk-slow-right"
  | "walk-slow-up"
  | "walk-slow-down"
  | "search-seat"
  | "search-current-window"
  | "search-desktop-icon"
  | "seat-on-item"
  | "look-file"
  | "ask-confirm"
  | "eat-normal";

export interface AnimationSpec {
  source: string;
  frameCount: number;
  fps: number;
  loop: boolean;
  layout: "atlas" | "strip";
  atlasRow?: number;
}

export const PET_POSES = [
  "idle-stand",
  "idle-sit",
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
] as const satisfies readonly PetPose[];

export const contentLongEdgeForPose = (_pose: PetPose): number => 119;

export const ANIMATIONS: Record<PetPose, AnimationSpec> = {
  "idle-stand": {
    source: "/pet/spritesheet.webp",
    frameCount: 6,
    fps: 2,
    loop: true,
    layout: "atlas",
    atlasRow: 0,
  },
  "idle-sit": strip("/pet/extended-animations/idle-sit.png", 2),
  "walk-slow-left": strip("/pet/extended-animations/walk-slow-left.png", 5),
  "walk-slow-right": strip("/pet/extended-animations/walk-slow-right.png", 5),
  "walk-slow-up": strip("/pet/extended-animations/walk-slow-up.png", 5),
  "walk-slow-down": strip("/pet/extended-animations/walk-slow-down.png", 5),
  "search-seat": strip("/pet/extended-animations/search-seat.png", 1.5),
  "search-current-window": strip("/pet/extended-animations/search-current-window.png", 1.5),
  "search-desktop-icon": strip("/pet/extended-animations/search-desktop-icon.png", 1.5),
  "seat-on-item": strip("/pet/extended-animations/seat-on-item.png", 2),
  "look-file": strip("/pet/extended-animations/look-file.png", 4),
  "ask-confirm": strip("/pet/extended-animations/ask-confirm.png", 2),
  "eat-normal": strip("/pet/extended-animations/eat-normal.png", 4),
};

export function poseForAction(action: PetAction, direction: Direction): PetPose {
  switch (action) {
    case PetAction.IDLE_SIT: return "idle-sit";
    case PetAction.WALK_SLOW: return `walk-slow-${direction}`;
    case PetAction.SEARCH_SEAT: return "search-seat";
    case PetAction.SEARCH_CURRENT_WINDOW: return "search-current-window";
    case PetAction.SEARCH_DESKTOP_ICON: return "search-desktop-icon";
    case PetAction.SEAT_ON_ITEM: return "seat-on-item";
    case PetAction.LOOK_AT_FILE: return "look-file";
    case PetAction.ASK_CONFIRM: return "ask-confirm";
    case PetAction.EAT_NORMAL: return "eat-normal";
    default: return "idle-stand";
  }
}

function strip(source: string, fps: number): AnimationSpec {
  return { source, frameCount: 4, fps, loop: true, layout: "strip" };
}
