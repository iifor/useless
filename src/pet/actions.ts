import type { CharacterManifest, IdlePose } from "./characterManifest";

export enum PetAction {
  IDLE_STAND = "IDLE_STAND",
  IDLE_SIT = "IDLE_SIT",
  IDLE_PRONE = "IDLE_PRONE",
  IDLE_LIE = "IDLE_LIE",
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

const IDLE_ACTIONS: Record<IdlePose, PetAction> = {
  "idle-stand": PetAction.IDLE_STAND,
  "idle-sit": PetAction.IDLE_SIT,
  "idle-prone": PetAction.IDLE_PRONE,
  "idle-lie": PetAction.IDLE_LIE,
};

const ALL_ACTIONS = [
  ...Object.values(IDLE_ACTIONS),
  PetAction.WALK_SLOW,
  PetAction.SEARCH_SEAT,
  PetAction.SEARCH_CURRENT_WINDOW,
  PetAction.SEARCH_DESKTOP_ICON,
  PetAction.SEAT_ON_ITEM,
  PetAction.LOOK_AT_FILE,
  PetAction.ASK_CONFIRM,
  PetAction.EAT_NORMAL,
] as const;

const SEAT_ACTIONS = new Set<PetAction>([
  PetAction.SEARCH_SEAT,
  PetAction.SEARCH_CURRENT_WINDOW,
  PetAction.SEARCH_DESKTOP_ICON,
  PetAction.SEAT_ON_ITEM,
]);

const FOOD_ACTIONS = new Set<PetAction>([
  PetAction.LOOK_AT_FILE,
  PetAction.ASK_CONFIRM,
  PetAction.EAT_NORMAL,
]);

export const hasCapability = (
  character: CharacterManifest,
  capability: CharacterManifest["capabilities"][number],
): boolean => character.capabilities.includes(capability);

export function isActionSupported(character: CharacterManifest, action: PetAction): boolean {
  const idlePose = Object.entries(IDLE_ACTIONS)
    .find(([, idleAction]) => idleAction === action)?.[0] as IdlePose | undefined;
  if (idlePose) return character.idlePoses.includes(idlePose);
  if (action === PetAction.WALK_SLOW) return true;
  if (SEAT_ACTIONS.has(action)) return hasCapability(character, "desktop-seat");
  if (FOOD_ACTIONS.has(action)) return hasCapability(character, "file-eating");
  return false;
}

export const actionsForCharacter = (character: CharacterManifest): PetAction[] =>
  ALL_ACTIONS.filter((action) => isActionSupported(character, action));

export const regularActionsForCharacter = (character: CharacterManifest): PetAction[] => [
  ...character.idlePoses.map((pose) => IDLE_ACTIONS[pose]),
  PetAction.WALK_SLOW,
];

export function nextAction(
  character: CharacterManifest,
  current: PetAction,
  random = Math.random,
): PetAction {
  const seatRoll = random();
  if (
    isActionSupported(character, PetAction.SEARCH_SEAT)
    && current !== PetAction.SEARCH_SEAT
    && seatRoll < 0.08
  ) return PetAction.SEARCH_SEAT;

  const candidates = regularActionsForCharacter(character)
    .filter((action) => action !== current);
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
