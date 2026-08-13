import { invoke } from "@tauri-apps/api/core";

import { shouldCreateSeat } from "./actions";
import type { Point } from "./windowMotion";

export interface DesktopSeatTarget {
  id: string;
  name: string;
  kind: "file" | "folder" | "owned-temp" | "virtual";
  path?: string;
  screenPosition?: Point;
  appOwned: boolean;
}

export interface DesktopItemProvider {
  findSeatCandidates(): Promise<DesktopSeatTarget[]>;
}

const desktopItemProvider: DesktopItemProvider = {
  findSeatCandidates: () => invoke("find_seat_candidates"),
};

const VIRTUAL_SEAT: DesktopSeatTarget = {
  id: "virtual-seat",
  name: "虚拟座位",
  kind: "virtual",
  appOwned: false,
};

export async function findSeatTarget(random = Math.random): Promise<DesktopSeatTarget> {
  if (!("__TAURI_INTERNALS__" in window)) return VIRTUAL_SEAT;
  let candidates: DesktopSeatTarget[] = [];
  try {
    candidates = await desktopItemProvider.findSeatCandidates();
    if (!shouldCreateSeat(candidates.length, random)) {
      return candidates[Math.floor(random() * candidates.length)] ?? VIRTUAL_SEAT;
    }
    return await invoke("create_owned_seat_file");
  } catch (error) {
    console.warn("桌面座位已降级为虚拟目标", error);
    return VIRTUAL_SEAT;
  }
}

export async function releaseSeatTarget(target: DesktopSeatTarget | null): Promise<void> {
  if (!target?.appOwned || !target.path || !("__TAURI_INTERNALS__" in window)) return;
  try {
    await invoke("trash_owned_seat_file", { path: target.path });
  } catch (error) {
    console.warn("应用座位文件未通过安全回收验证，已保留原处", error);
  }
}
