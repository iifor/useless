import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

import type { FoodTarget } from "./foodFlow";

export type FoodPickerKind = FoodTarget["kind"];

export async function pickFood(kind: FoodPickerKind): Promise<FoodTarget | null> {
  const path = await open({ multiple: false, directory: kind === "folder" });
  return path === null ? null : invoke<FoodTarget>("inspect_user_food", { path });
}

export const trashFood = (target: FoodTarget): Promise<void> =>
  invoke<void>("trash_user_food", {
    path: target.path,
    selectionToken: target.selectionToken,
  });
