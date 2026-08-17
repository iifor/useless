import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

import FoodInteraction, {
  beginFoodActivity,
  endFoodActivity,
  runFoodDecision,
  runFoodSelection,
} from "../../src/pet/FoodInteraction";
import { PetAction } from "../../src/pet/actions";
import { runMenuChoice } from "../../src/pet/PetActionMenu";
import {
  advanceToConfirmation,
  beginFakeEat,
  beginFood,
  beginTrash,
  completeTrash,
  failFood,
  finishFood,
  type FoodFlow,
  type FoodTarget,
} from "../../src/pet/foodFlow";

const target = {
  name: "food.txt",
  kind: "file" as const,
  path: "/tmp/food.txt",
  selectionToken: "selection-1",
};

test("advances a selected target through confirmation and real eating", () => {
  const looking = beginFood(target);
  const confirming = advanceToConfirmation(looking);
  const trashing = beginTrash(confirming);
  expect(trashing).toEqual({ stage: "trashing", target });
  expect(completeTrash(trashing)).toEqual({ stage: "eating", target });
});

test("cancel confirmation enters fake eating without a filesystem request state", () => {
  const confirming = advanceToConfirmation(beginFood(target));
  expect(beginFakeEat(confirming)).toEqual({ stage: "fake-eating", target });
  expect(finishFood()).toEqual({ stage: "idle" });
});

test("reports a trash failure without entering eating", () => {
  expect(failFood("没有权限", target)).toEqual({
    stage: "error",
    message: "没有权限",
    target,
  });
});

test("locks confirmation before awaiting so a second confirmation cannot trash twice", async () => {
  let current: FoodFlow = advanceToConfirmation(beginFood(target));
  let releaseTrash = () => {};
  let trashRequests = 0;
  let finished = 0;
  const stages: FoodFlow["stage"][] = [];
  const actions: PetAction[] = [];
  const waits: number[] = [];
  const trashPending = new Promise<void>((resolve) => { releaseTrash = resolve; });
  const effects = {
    finish: () => { finished += 1; },
    setAction: (action: PetAction) => { actions.push(action); },
    setFlow: (flow: FoodFlow) => { stages.push(flow.stage); },
    trash: async (selected: FoodTarget) => {
      expect(selected).toBe(target);
      trashRequests += 1;
      await trashPending;
    },
    wait: async (milliseconds: number) => { waits.push(milliseconds); },
  };

  const first = runFoodDecision("confirm", { get current() { return current; }, set current(flow) { current = flow; } }, effects);
  const second = runFoodDecision("confirm", { get current() { return current; }, set current(flow) { current = flow; } }, effects);

  expect(trashRequests).toBe(1);
  expect(current.stage).toBe("trashing");
  releaseTrash();
  await Promise.all([first, second]);
  expect(stages).toEqual(["trashing", "eating"]);
  expect(actions).toEqual([PetAction.EAT_NORMAL]);
  expect(waits).toEqual([1_000]);
  expect(finished).toBe(1);
});

test("cancel performs fake eating and never sends a trash request", async () => {
  let current: FoodFlow = advanceToConfirmation(beginFood(target));
  let trashRequests = 0;
  let finished = 0;
  const stages: FoodFlow["stage"][] = [];
  const actions: PetAction[] = [];
  const waits: number[] = [];

  await runFoodDecision("cancel", {
    get current() { return current; },
    set current(flow) { current = flow; },
  }, {
    finish: () => { finished += 1; },
    setAction: (action) => { actions.push(action); },
    setFlow: (flow) => { stages.push(flow.stage); },
    trash: async () => { trashRequests += 1; },
    wait: async (milliseconds) => { waits.push(milliseconds); },
  });

  expect(trashRequests).toBe(0);
  expect(stages).toEqual(["fake-eating"]);
  expect(actions).toEqual([PetAction.EAT_NORMAL]);
  expect(waits).toEqual([1_000]);
  expect(finished).toBe(1);
});

test("trash failure shows an error before finishing and never plays successful eating", async () => {
  let current: FoodFlow = advanceToConfirmation(beginFood(target));
  let finished = 0;
  const stages: FoodFlow["stage"][] = [];
  const actions: PetAction[] = [];
  const waits: number[] = [];

  await expect(runFoodDecision("confirm", {
    get current() { return current; },
    set current(flow) { current = flow; },
  }, {
    finish: () => { finished += 1; },
    setAction: (action) => { actions.push(action); },
    setFlow: (flow) => { stages.push(flow.stage); },
    trash: async () => { throw new Error("没有权限"); },
    wait: async (milliseconds) => { waits.push(milliseconds); },
  })).resolves.toBeUndefined();

  expect(stages).toEqual(["trashing", "error"]);
  expect(actions).toEqual([]);
  expect(waits).toEqual([2_000]);
  expect(finished).toBe(1);
});

test("picker cancellation resumes without changing the food flow", async () => {
  let current: FoodFlow = finishFood();
  let finished = 0;
  const stages: FoodFlow["stage"][] = [];
  const actions: PetAction[] = [];
  const waits: number[] = [];

  await runFoodSelection("file", {
    get current() { return current; },
    set current(flow) { current = flow; },
  }, {
    finish: () => { finished += 1; },
    pick: async () => null,
    setAction: (action) => { actions.push(action); },
    setFlow: (flow) => { stages.push(flow.stage); },
    wait: async (milliseconds) => { waits.push(milliseconds); },
  });

  expect(current.stage).toBe("idle");
  expect(stages).toEqual([]);
  expect(actions).toEqual([]);
  expect(waits).toEqual([]);
  expect(finished).toBe(1);
});

test("selected food looks at the target before asking for confirmation", async () => {
  let current: FoodFlow = finishFood();
  let finished = 0;
  const stages: FoodFlow["stage"][] = [];
  const actions: PetAction[] = [];
  const waits: number[] = [];

  await runFoodSelection("file", {
    get current() { return current; },
    set current(flow) { current = flow; },
  }, {
    finish: () => { finished += 1; },
    pick: async () => target,
    setAction: (action) => { actions.push(action); },
    setFlow: (flow) => { stages.push(flow.stage); },
    wait: async (milliseconds) => { waits.push(milliseconds); },
  });

  expect(current.stage).toBe("confirming");
  expect(stages).toEqual(["looking", "confirming"]);
  expect(actions).toEqual([PetAction.LOOK_AT_FILE, PetAction.ASK_CONFIRM]);
  expect(waits).toEqual([1_000]);
  expect(finished).toBe(0);
});

test("rejected food inspection shows an error for two seconds and resumes", async () => {
  let current: FoodFlow = finishFood();
  let finished = 0;
  const stages: FoodFlow["stage"][] = [];
  const actions: PetAction[] = [];
  const waits: number[] = [];

  await expect(runFoodSelection("folder", {
    get current() { return current; },
    set current(flow) { current = flow; },
  }, {
    finish: () => { finished += 1; },
    pick: async () => { throw new Error("不能选择此文件夹"); },
    setAction: (action) => { actions.push(action); },
    setFlow: (flow) => { stages.push(flow.stage); },
    wait: async (milliseconds) => { waits.push(milliseconds); },
  })).resolves.toBeUndefined();

  expect(current).toEqual({ stage: "error", message: "不能选择此文件夹" });
  expect(stages).toEqual(["error"]);
  expect(actions).toEqual([]);
  expect(waits).toEqual([2_000]);
  expect(finished).toBe(1);
});

test("confirmation renders only a generic target, basename, and real decision buttons", () => {
  const flow = advanceToConfirmation(beginFood(target));
  const markup = renderToStaticMarkup(createElement(FoodInteraction, {
    flow,
    onCancel: () => {},
    onConfirm: () => {},
  }));

  expect(markup).toContain("food-target-icon file");
  expect(markup).toContain("food.txt");
  expect(markup).toContain("是这个吗？");
  expect(markup).toContain("<button");
  expect(markup).not.toContain("/tmp/food.txt");
});

test("trashing keeps both decision buttons visible and disabled", () => {
  const flow = beginTrash(advanceToConfirmation(beginFood(target)));
  const markup = renderToStaticMarkup(createElement(FoodInteraction, {
    flow,
    onCancel: () => {},
    onConfirm: () => {},
  }));

  expect(markup).toContain("food.txt");
  expect(markup.match(/disabled=""/g)).toHaveLength(2);
});

test("real and fake eating mark the runtime icon for their distinct animations", () => {
  const confirming = advanceToConfirmation(beginFood(target));
  const props = { onCancel: () => {}, onConfirm: () => {} };
  const eating = renderToStaticMarkup(createElement(FoodInteraction, {
    ...props,
    flow: completeTrash(beginTrash(confirming)),
  }));
  const fakeEating = renderToStaticMarkup(createElement(FoodInteraction, {
    ...props,
    flow: beginFakeEat(confirming),
  }));

  expect(eating).toContain("food-target is-eating");
  expect(fakeEating).toContain("food-target is-eating is-fake-eating");
});

test("error state renders the returned message without a target icon", () => {
  const markup = renderToStaticMarkup(createElement(FoodInteraction, {
    flow: failFood("没有权限"),
    onCancel: () => {},
    onConfirm: () => {},
  }));

  expect(markup).toContain("没有权限");
  expect(markup).not.toContain("food-target-icon");
});

test("trash error keeps the generic target visible with its basename", () => {
  const markup = renderToStaticMarkup(createElement(FoodInteraction, {
    flow: failFood("没有权限", target),
    onCancel: () => {},
    onConfirm: () => {},
  }));

  expect(markup).toContain("没有权限");
  expect(markup).toContain("food-target-icon file");
  expect(markup).toContain("food.txt");
  expect(markup).not.toContain("/tmp/food.txt");
});

test("food activity locks synchronously until the flow finishes", () => {
  const active = { current: false };

  expect(beginFoodActivity(active)).toBe(true);
  expect(beginFoodActivity(active)).toBe(false);
  endFoodActivity(active);
  expect(beginFoodActivity(active)).toBe(true);
});

test("menu choice consumes a rejected async callback", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    await expect(runMenuChoice(async () => { throw new Error("picker failed"); }))
      .resolves.toBeUndefined();
  } finally {
    log.mockRestore();
  }
});
