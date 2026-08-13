export type FoodTarget = {
  name: string;
  kind: "file" | "folder";
  path: string;
  selectionToken: string;
};

type LookingFood = { stage: "looking"; target: FoodTarget };
type ConfirmingFood = { stage: "confirming"; target: FoodTarget };
type TrashingFood = { stage: "trashing"; target: FoodTarget };

export type FoodFlow =
  | { stage: "idle" }
  | LookingFood
  | ConfirmingFood
  | TrashingFood
  | { stage: "eating"; target: FoodTarget }
  | { stage: "fake-eating"; target: FoodTarget }
  | { stage: "error"; message: string; target?: FoodTarget };

export const beginFood = (target: FoodTarget): LookingFood => ({ stage: "looking", target });

export const advanceToConfirmation = (flow: LookingFood): ConfirmingFood => ({
  stage: "confirming",
  target: flow.target,
});

export const beginTrash = (flow: ConfirmingFood): TrashingFood => ({
  stage: "trashing",
  target: flow.target,
});

export const completeTrash = (flow: TrashingFood): FoodFlow => ({
  stage: "eating",
  target: flow.target,
});

export const beginFakeEat = (flow: ConfirmingFood): FoodFlow => ({
  stage: "fake-eating",
  target: flow.target,
});

export const failFood = (message: string, target?: FoodTarget): FoodFlow => (
  target ? { stage: "error", message, target } : { stage: "error", message }
);

export const finishFood = (): FoodFlow => ({ stage: "idle" });
