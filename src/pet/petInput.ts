import type { Point } from "./windowMotion";

export const canStartPetDrag = (
  dragDisabled: boolean,
  button: number,
  tauriAvailable: boolean,
): boolean => !dragDisabled && button === 0 && tauriAvailable;

export const petContextMenuPoint = (
  clientX: number,
  clientY: number,
): Point => ({ x: clientX, y: clientY });

export const shouldEnableDebugMenu = (mode: string): boolean => mode === "development";
