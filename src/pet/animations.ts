import { PetAction, type Direction } from "./actions";

export type PetPose =
  | "idle-stand"
  | "idle-sit"
  | "idle-prone"
  | "idle-lie"
  | "sleep-side"
  | "walk-slow-left"
  | "walk-slow-right"
  | "search-seat"
  | "seat-on-item"
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
  "idle-prone",
  "idle-lie",
  "sleep-side",
  "walk-slow-left",
  "walk-slow-right",
  "search-seat",
  "seat-on-item",
  "eat-normal",
] as const satisfies readonly PetPose[];

export const contentLongEdgeForPose = (pose: PetPose): number =>
  pose === "idle-prone" ? 102 : 119;

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
  "idle-prone": strip("/pet/extended-animations/idle-prone.png", 1.5),
  "idle-lie": strip("/pet/extended-animations/idle-lie.png", 1.5),
  "sleep-side": strip("/pet/extended-animations/sleep-side.png", 1),
  "walk-slow-left": strip("/pet/extended-animations/walk-slow-left.png", 5),
  "walk-slow-right": strip("/pet/extended-animations/walk-slow-right.png", 5),
  "search-seat": strip("/pet/extended-animations/search-seat.png", 1.5),
  "seat-on-item": strip("/pet/extended-animations/seat-on-item.png", 2),
  "eat-normal": strip("/pet/extended-animations/eat-normal.png", 4),
};

export function poseForAction(action: PetAction, direction: Direction): PetPose {
  switch (action) {
    case PetAction.IDLE_SIT: return "idle-sit";
    case PetAction.IDLE_PRONE: return "idle-prone";
    case PetAction.IDLE_LIE: return "idle-lie";
    case PetAction.WALK_SLOW: return direction === "left" ? "walk-slow-left" : "walk-slow-right";
    case PetAction.SEARCH_SEAT: return "search-seat";
    case PetAction.SEAT_ON_ITEM: return "seat-on-item";
    case PetAction.LOOK_AT_FILE:
    case PetAction.ASK_CONFIRM: return "idle-stand";
    case PetAction.EAT_NORMAL: return "eat-normal";
    default: return "idle-stand";
  }
}

function strip(source: string, fps: number): AnimationSpec {
  return { source, frameCount: 4, fps, loop: true, layout: "strip" };
}
