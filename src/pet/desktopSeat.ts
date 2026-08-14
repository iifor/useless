import { invoke } from "@tauri-apps/api/core";

import type { Point } from "./windowMotion";

export type SeatKind = "file" | "folder" | "owned-temp" | "window" | "virtual";

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
  findSeatCandidates(): Promise<DesktopSeatTarget[]>;
}

const desktopItemProvider: DesktopItemProvider = {
  findSeatCandidates: () => invoke("find_seat_targets"),
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
  random = Math.random,
): DesktopSeatTarget {
  const focused = candidates.find(({ kind, focused }) => kind === "window" && focused);
  if (focused) return focused;
  const icons = candidates.filter(({ kind }) => kind !== "window");
  return icons[Math.floor(random() * icons.length)] ?? PENDING_OWNED_SEAT;
}

export const isPendingOwnedSeat = (target: DesktopSeatTarget): boolean =>
  target.kind === "owned-temp" && target.appOwned && !target.path;

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

export async function findSeatTarget(random = Math.random): Promise<DesktopSeatTarget> {
  if (!("__TAURI_INTERNALS__" in window)) return VIRTUAL_SEAT;
  let candidates: DesktopSeatTarget[] = [];
  try {
    candidates = await desktopItemProvider.findSeatCandidates();
    return chooseSeatTarget(candidates, random);
  } catch (error) {
    console.warn("桌面座位已降级为虚拟目标", error);
    return VIRTUAL_SEAT;
  }
}

export async function materializeOwnedSeatTarget(
  target: DesktopSeatTarget,
  create: () => Promise<DesktopSeatTarget> = () => invoke("create_owned_seat_file"),
  find: () => Promise<DesktopSeatTarget[]> = desktopItemProvider.findSeatCandidates,
  sleep: (milliseconds: number) => Promise<void> = (milliseconds) =>
    new Promise((resolve) => window.setTimeout(resolve, milliseconds)),
): Promise<DesktopSeatTarget> {
  if (!isPendingOwnedSeat(target)) return target;
  try {
    const owned = await create();
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await sleep(500);
      const discovered = await find()
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
