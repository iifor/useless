export type IdlePose = "idle-stand" | "idle-sit" | "idle-prone" | "idle-lie";

export type CharacterCapability = "desktop-seat" | "file-eating";

export type AnimationOverrideId =
  | "idle-sit"
  | "idle-prone"
  | "idle-lie"
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

export interface AnimationOverride {
  frameCount: number;
  fps: number;
}

export interface CharacterManifest {
  schemaVersion: 1;
  id: string;
  displayName: string;
  version: string;
  bundleId: string;
  description: string;
  idlePoses: IdlePose[];
  capabilities: CharacterCapability[];
  animationOverrides?: Partial<Record<AnimationOverrideId, AnimationOverride>>;
}
