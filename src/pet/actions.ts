export enum PetAction {
  IDLE_STAND = "IDLE_STAND",
  IDLE_SIT = "IDLE_SIT",
  WALK_SLOW = "WALK_SLOW",
  SEARCH_SEAT = "SEARCH_SEAT",
  SEARCH_CURRENT_WINDOW = "SEARCH_CURRENT_WINDOW",
  SEARCH_DESKTOP_ICON = "SEARCH_DESKTOP_ICON",
  SEAT_ON_ITEM = "SEAT_ON_ITEM",
  LOOK_AT_FILE = "LOOK_AT_FILE",
  ASK_CONFIRM = "ASK_CONFIRM",
  EAT_NORMAL = "EAT_NORMAL",
}

export type Direction = "left" | "right" | "up" | "down";

export interface ActionSelection {
  auto: boolean;
  action: PetAction;
}

const REGULAR_ACTIONS = [
  PetAction.IDLE_STAND,
  PetAction.IDLE_SIT,
  PetAction.WALK_SLOW,
] as const;

export function nextAction(current: PetAction, random = Math.random): PetAction {
  if (current !== PetAction.SEARCH_SEAT && random() < 0.08) return PetAction.SEARCH_SEAT;

  const candidates = REGULAR_ACTIONS.filter((action) => action !== current);
  return candidates[Math.floor(random() * candidates.length)] ?? PetAction.IDLE_STAND;
}

export function actionDurationMs(action: PetAction, random = Math.random): number {
  if (action === PetAction.SEAT_ON_ITEM) return 30_000 + random() * 60_000;
  if (
    action === PetAction.SEARCH_SEAT
    || action === PetAction.SEARCH_CURRENT_WINDOW
    || action === PetAction.SEARCH_DESKTOP_ICON
  ) return 2_000 + random() * 2_000;
  if (action === PetAction.WALK_SLOW) return 0;
  return 30_000 + random() * 270_000;
}

export const shouldCreateSeat = (
  candidateCount: number,
  random = Math.random,
): boolean => candidateCount === 0 || random() < 0.1;

export const manualAction = (action: PetAction): ActionSelection => ({ auto: false, action });

export const dragResumeAction = (
  automatic: boolean,
  current: PetAction,
  manual: PetAction,
): PetAction => automatic ? current : manual;

export const shouldResumeAfterDrag = (foodActive: boolean): boolean => !foodActive;

export const foodResumeAction = (
  automatic: boolean,
  manual: PetAction,
): PetAction => automatic ? PetAction.IDLE_STAND : manual;

export const shouldClearSeatAfterAction = (
  automatic: boolean,
  action: PetAction,
): boolean => automatic && action === PetAction.SEAT_ON_ITEM;

export const resumeAutomatic = (): ActionSelection => ({
  auto: true,
  action: PetAction.IDLE_STAND,
});
