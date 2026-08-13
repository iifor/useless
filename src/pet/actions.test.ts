import { describe, expect, test } from "vitest";

import {
  PetAction,
  actionDurationMs,
  dragResumeAction,
  foodResumeAction,
  manualAction,
  nextAction,
  resumeAutomatic,
  shouldClearSeatAfterAction,
  shouldCreateSeat,
  shouldResumeAfterDrag,
} from "./actions";
import {
  clampWindowTarget,
  directionForMove,
  randomWalkTarget,
  stepTowards,
} from "./windowMotion";
import { ANIMATIONS, poseForAction } from "./animations";

describe("action scheduling", () => {
  test("keeps stationary actions between 30 seconds and 5 minutes", () => {
    expect(actionDurationMs(PetAction.IDLE_SIT, () => 0)).toBe(30_000);
    expect(actionDurationMs(PetAction.IDLE_LIE, () => 0.999)).toBeLessThanOrEqual(300_000);
  });

  test("selects the seat action below the 8 percent boundary", () => {
    const random = values(0.079);
    expect(nextAction(PetAction.IDLE_STAND, random)).toBe(PetAction.SEARCH_SEAT);
  });

  test("does not immediately repeat the current stationary action", () => {
    const random = values(0.08, 0);
    expect(nextAction(PetAction.IDLE_STAND, random)).not.toBe(PetAction.IDLE_STAND);
  });

  test("does not immediately repeat the seat search action", () => {
    expect(nextAction(PetAction.SEARCH_SEAT, values(0.01, 0))).not.toBe(PetAction.SEARCH_SEAT);
  });

  test("creates a seat when desktop is empty or the 10 percent roll wins", () => {
    expect(shouldCreateSeat(0, () => 0.99)).toBe(true);
    expect(shouldCreateSeat(3, () => 0.099)).toBe(true);
    expect(shouldCreateSeat(3, () => 0.1)).toBe(false);
  });

  test("manual selection pauses scheduling and automatic mode resumes standing", () => {
    expect(manualAction(PetAction.IDLE_PRONE)).toEqual({ auto: false, action: PetAction.IDLE_PRONE });
    expect(resumeAutomatic()).toEqual({ auto: true, action: PetAction.IDLE_STAND });
  });

  test("keeps the visible automatic action after dragging", () => {
    expect(dragResumeAction(true, PetAction.IDLE_PRONE, PetAction.IDLE_STAND))
      .toBe(PetAction.IDLE_PRONE);
  });

  test("keeps the selected manual action after dragging", () => {
    expect(dragResumeAction(false, PetAction.WALK_SLOW, PetAction.IDLE_LIE))
      .toBe(PetAction.IDLE_LIE);
  });

  test("does not let a drag continuation restart scheduling while the picker is pending", () => {
    expect(shouldResumeAfterDrag(true)).toBe(false);
    expect(shouldResumeAfterDrag(false)).toBe(true);
  });

  test("automatic food completion resumes from standing", () => {
    expect(foodResumeAction(true, PetAction.IDLE_LIE)).toBe(PetAction.IDLE_STAND);
    expect(foodResumeAction(false, PetAction.IDLE_LIE)).toBe(PetAction.IDLE_LIE);
  });

  test("clears the seat after an automatic seated action completes", () => {
    expect(shouldClearSeatAfterAction(true, PetAction.SEAT_ON_ITEM)).toBe(true);
  });

  test("keeps the seat for a manual seated action", () => {
    expect(shouldClearSeatAfterAction(false, PetAction.SEAT_ON_ITEM)).toBe(false);
  });

  test("maps every action to a valid animation pose", () => {
    for (const action of Object.values(PetAction)) {
      expect(poseForAction(action, "left")).toBeTruthy();
      expect(poseForAction(action, "right")).toBeTruthy();
    }
  });

  test("maps food actions to valid poses", () => {
    expect(poseForAction(PetAction.LOOK_AT_FILE, "right")).toBe("idle-stand");
    expect(poseForAction(PetAction.ASK_CONFIRM, "right")).toBe("idle-stand");
    expect(poseForAction(PetAction.EAT_NORMAL, "right")).toBe("eat-normal");
    expect(ANIMATIONS["eat-normal"].frameCount).toBe(4);
  });
});

describe("window movement", () => {
  test("clamps a target inside the monitor work area", () => {
    expect(clampWindowTarget(
      { x: 5, y: 900 },
      { x: 0, y: 24, width: 1440, height: 876 },
      { width: 280, height: 320 },
      16,
    )).toEqual({ x: 16, y: 564 });
  });

  test("moves toward a target without overshooting it", () => {
    const step = stepTowards({ x: 0, y: 0 }, { x: 3, y: 4 }, 2);
    expect(step.x).toBeCloseTo(1.2);
    expect(step.y).toBeCloseTo(1.6);
    expect(stepTowards({ x: 1, y: 1 }, { x: 2, y: 1 }, 5)).toEqual({ x: 2, y: 1 });
  });

  test("faces the dominant horizontal direction", () => {
    expect(directionForMove({ x: 10, y: 0 }, { x: 2, y: 20 })).toBe("left");
    expect(directionForMove({ x: 2, y: 20 }, { x: 10, y: 0 })).toBe("right");
  });

  test("selects a clamped walk target 120 to 480 CSS pixels away", () => {
    const target = randomWalkTarget(
      { x: 500, y: 400 },
      { x: 0, y: 24, width: 1440, height: 876 },
      { width: 280, height: 320 },
      2,
      values(0.5, 0),
    );
    expect(target).toEqual({ x: 1100, y: 400 });
  });

  test("keeps the minimum walk distance when starting at a monitor edge", () => {
    const current = { x: 16, y: 24 };
    const target = randomWalkTarget(
      current,
      { x: 0, y: 0, width: 1440, height: 900 },
      { width: 280, height: 320 },
      1,
      values(0, 0.5),
    );
    expect(Math.hypot(target.x - current.x, target.y - current.y)).toBeGreaterThanOrEqual(120);
  });
});

function values(...items: number[]): () => number {
  let index = 0;
  return () => items[Math.min(index++, items.length - 1)];
}
