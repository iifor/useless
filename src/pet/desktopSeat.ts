import { invoke } from "@tauri-apps/api/core";

import { PetAction } from "./actions";
import type { Point } from "./windowMotion";

export type SeatKind = "file" | "folder" | "owned-temp" | "window" | "virtual";
export type SeatSearchMode =
  | "auto"
  | "focused-window"
  | "desktop-icon"
  | "desktop-icon-silent";

export interface SeatAnchor extends Point {}

export interface DesktopSeatTarget {
  id: string;
  name: string;
  kind: SeatKind;
  path?: string;
  seatAnchor?: SeatAnchor;
  nativeWindowId?: string;
  focused: boolean;
  appOwned: boolean;
  virtualMarker: boolean;
}

export interface DesktopItemProvider {
  findSeatCandidates(mode: SeatSearchMode): Promise<DesktopSeatTarget[]>;
}

const desktopItemProvider: DesktopItemProvider = {
  findSeatCandidates: (mode) => invoke("find_seat_targets", { mode }),
};

const VIRTUAL_SEAT: DesktopSeatTarget = {
  id: "virtual-seat",
  name: "虚拟座位",
  kind: "virtual",
  focused: false,
  appOwned: false,
  virtualMarker: true,
};

const PENDING_OWNED_SEAT: DesktopSeatTarget = {
  id: "pending-owned-seat",
  name: "宠物的座位.tmp",
  kind: "owned-temp",
  focused: false,
  appOwned: true,
  virtualMarker: false,
};

export function chooseSeatTarget(
  candidates: DesktopSeatTarget[],
  mode: SeatSearchMode,
  random = Math.random,
): DesktopSeatTarget | null {
  if (mode === "focused-window") {
    const windows = candidates.filter(({ kind }) => kind === "window");
    return windows[Math.floor(random() * windows.length)] ?? null;
  }
  const icons = candidates.filter(({ kind }) => kind !== "window");
  if (mode === "desktop-icon" || mode === "desktop-icon-silent") {
    return icons[Math.floor(random() * icons.length)] ?? null;
  }
  const focused = candidates.find(({ kind, focused }) => kind === "window" && focused);
  return focused ?? icons[Math.floor(random() * icons.length)] ?? PENDING_OWNED_SEAT;
}

export const isPendingOwnedSeat = (target: DesktopSeatTarget): boolean =>
  target.kind === "owned-temp" && target.appOwned && !target.path;

export function seatSearchModeForAction(action: PetAction): SeatSearchMode | null {
  if (action === PetAction.SEARCH_SEAT) return "auto";
  if (action === PetAction.SEARCH_CURRENT_WINDOW) return "focused-window";
  if (action === PetAction.SEARCH_DESKTOP_ICON) return "desktop-icon";
  return null;
}

export const seatSearchModeForOwnedMaterialization = (): SeatSearchMode =>
  "desktop-icon-silent";

export const shouldRenderSeatMarker = (target: DesktopSeatTarget | null): boolean =>
  target?.virtualMarker === true;

export const seatTargetChanged = (
  original: DesktopSeatTarget,
  refreshed: DesktopSeatTarget | null,
): boolean => original.kind === "window" && (
  !refreshed?.seatAnchor
  || !original.seatAnchor
  || Math.abs(refreshed.seatAnchor.x - original.seatAnchor.x) > 0.5
  || Math.abs(refreshed.seatAnchor.y - original.seatAnchor.y) > 0.5
);

export async function findSeatTarget(
  mode: SeatSearchMode = "auto",
  random = Math.random,
): Promise<DesktopSeatTarget | null> {
  if (!("__TAURI_INTERNALS__" in window)) return mode === "auto" ? VIRTUAL_SEAT : null;
  let candidates: DesktopSeatTarget[] = [];
  try {
    candidates = await desktopItemProvider.findSeatCandidates(mode);
    return chooseSeatTarget(candidates, mode, random);
  } catch (error) {
    console.warn("桌面座位查找失败", error);
    return mode === "auto" ? VIRTUAL_SEAT : null;
  }
}

export async function materializeOwnedSeatTarget(
  target: DesktopSeatTarget,
  create: () => Promise<DesktopSeatTarget> = () => invoke("create_owned_seat_file"),
  find: (mode: SeatSearchMode) => Promise<DesktopSeatTarget[]> = (mode) =>
    desktopItemProvider.findSeatCandidates(mode),
  sleep: (milliseconds: number) => Promise<void> = (milliseconds) =>
    new Promise((resolve) => window.setTimeout(resolve, milliseconds)),
): Promise<DesktopSeatTarget> {
  if (!isPendingOwnedSeat(target)) return target;
  try {
    const owned = await create();
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await sleep(500);
      const discovered = await find(seatSearchModeForOwnedMaterialization())
        .then((targets) => targets.find(({ path }) => path === owned.path))
        .catch(() => undefined);
      if (discovered?.seatAnchor) {
        return {
          ...discovered,
          id: owned.id,
          kind: "owned-temp",
          appOwned: true,
          virtualMarker: false,
        };
      }
    }
    return owned;
  } catch (error) {
    console.warn("创建桌面座位失败，已降级为虚拟目标", error);
    return VIRTUAL_SEAT;
  }
}

export async function arriveThenMaterializeSeat(
  target: DesktopSeatTarget,
  arrive: () => Promise<void>,
  materialize: (target: DesktopSeatTarget) => Promise<DesktopSeatTarget> =
    materializeOwnedSeatTarget,
): Promise<DesktopSeatTarget> {
  await arrive();
  return materialize(target);
}

export async function refreshWindowSeat(
  target: DesktopSeatTarget,
): Promise<DesktopSeatTarget | null> {
  if (target.kind !== "window" || !target.nativeWindowId || !("__TAURI_INTERNALS__" in window)) {
    return target;
  }
  return invoke("refresh_window_seat", { nativeWindowId: target.nativeWindowId });
}

export async function releaseSeatTarget(target: DesktopSeatTarget | null): Promise<void> {
  if (!target?.appOwned || !target.path || !("__TAURI_INTERNALS__" in window)) return;
  try {
    await invoke("trash_owned_seat_file", { path: target.path });
  } catch (error) {
    console.warn("应用座位文件未通过安全回收验证，已保留原处", error);
  }
}
