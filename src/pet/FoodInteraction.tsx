import { PetAction } from "./actions";
import type { ReactNode } from "react";
import {
  advanceToConfirmation,
  beginFakeEat,
  beginFood,
  beginTrash,
  completeTrash,
  failFood,
  type FoodFlow,
  type FoodTarget,
} from "./foodFlow";
import type { FoodPickerKind } from "./foodPicker";

export type FoodFlowRef = { current: FoodFlow };
export type FoodActivityRef = { current: boolean };

export function beginFoodActivity(active: FoodActivityRef): boolean {
  if (active.current) return false;
  active.current = true;
  return true;
}

export const endFoodActivity = (active: FoodActivityRef): void => {
  active.current = false;
};

export interface FoodDecisionEffects {
  finish: () => void;
  setAction: (action: PetAction) => void;
  setFlow: (flow: FoodFlow) => void;
  trash: (target: FoodTarget) => Promise<void>;
  wait: (milliseconds: number) => Promise<void>;
}

export interface FoodSelectionEffects {
  finish: () => void;
  pick: (kind: FoodPickerKind) => Promise<FoodTarget | null>;
  setAction: (action: PetAction) => void;
  setFlow: (flow: FoodFlow) => void;
  wait: (milliseconds: number) => Promise<void>;
}

interface FoodInteractionProps {
  flow: FoodFlow;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function FoodInteraction(
  { flow, onConfirm, onCancel }: FoodInteractionProps,
): ReactNode {
  if (flow.stage === "idle") return null;
  const target = flow.target;
  if (!target) {
    const message = flow.stage === "error" ? flow.message : "";
    return <aside className="food-interaction food-error" role="alert">{message}</aside>;
  }
  const asksForDecision = flow.stage === "confirming" || flow.stage === "trashing";
  const disabled = flow.stage === "trashing";
  const eatingClass = flow.stage === "fake-eating"
    ? " is-eating is-fake-eating"
    : flow.stage === "eating" ? " is-eating" : "";

  return (
    <aside aria-live="polite" className="food-interaction">
      <div className={`food-target${eatingClass}`}>
        <span aria-hidden="true" className={`food-target-icon ${target.kind}`} />
        <span className="food-target-name">{target.name}</span>
      </div>
      {flow.stage === "error" && <p className="food-error" role="alert">{flow.message}</p>}
      {asksForDecision && (
        <>
          <p>是这个吗？</p>
          <div className="food-actions">
            <button disabled={disabled} onClick={onConfirm} type="button">确认</button>
            <button disabled={disabled} onClick={onCancel} type="button">取消</button>
          </div>
        </>
      )}
    </aside>
  );
}

export async function runFoodSelection(
  kind: FoodPickerKind,
  flowRef: FoodFlowRef,
  effects: FoodSelectionEffects,
): Promise<void> {
  let target: FoodTarget | null;
  try {
    target = await effects.pick(kind);
  } catch (error) {
    const failed = failFood(error instanceof Error ? error.message : String(error));
    flowRef.current = failed;
    effects.setFlow(failed);
    await effects.wait(2_000);
    effects.finish();
    return;
  }
  if (target === null) {
    effects.finish();
    return;
  }
  const looking = beginFood(target);
  flowRef.current = looking;
  effects.setFlow(looking);
  effects.setAction(PetAction.LOOK_AT_FILE);
  await effects.wait(1_000);
  const confirming = advanceToConfirmation(looking);
  flowRef.current = confirming;
  effects.setFlow(confirming);
  effects.setAction(PetAction.ASK_CONFIRM);
}

export async function runFoodDecision(
  decision: "confirm" | "cancel",
  flowRef: FoodFlowRef,
  effects: FoodDecisionEffects,
): Promise<void> {
  const flow = flowRef.current;
  if (flow.stage !== "confirming") return;

  if (decision === "cancel") {
    const fakeEating = beginFakeEat(flow);
    flowRef.current = fakeEating;
    effects.setFlow(fakeEating);
    effects.setAction(PetAction.EAT_NORMAL);
    await effects.wait(1_000);
    effects.finish();
    return;
  }

  const trashing = beginTrash(flow);
  flowRef.current = trashing;
  effects.setFlow(trashing);
  try {
    await effects.trash(trashing.target);
  } catch (error) {
    const failed = failFood(
      error instanceof Error ? error.message : String(error),
      trashing.target,
    );
    flowRef.current = failed;
    effects.setFlow(failed);
    await effects.wait(2_000);
    effects.finish();
    return;
  }
  const eating = completeTrash(trashing);
  flowRef.current = eating;
  effects.setFlow(eating);
  effects.setAction(PetAction.EAT_NORMAL);
  await effects.wait(1_000);
  effects.finish();
}
