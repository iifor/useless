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
} from "../../src/pet/actions";
import {
  bottomCenter,
  clampWindowTarget,
  directionForMove,
  fromBottomCenter,
  physicalWindowSize,
  planWalkPath,
  randomWalkTarget,
  relativeToBottomCenter,
  stepTowards,
  windowPositionForBottomCenter,
} from "../../src/pet/windowMotion";
import { ANIMATIONS, poseForAction } from "../../src/pet/animations";

describe("action scheduling", () => {
  test("keeps stationary actions between 30 seconds and 5 minutes", () => {
    expect(actionDurationMs(PetAction.IDLE_SIT, () => 0)).toBe(30_000);
    expect(actionDurationMs(PetAction.IDLE_LIE, () => 0.999)).toBeLessThanOrEqual(300_000);
  });

  test("plays the seat-search animation for two to four seconds", () => {
    expect(actionDurationMs(PetAction.SEARCH_SEAT, () => 0)).toBe(2_000);
    expect(actionDurationMs(PetAction.SEARCH_SEAT, () => 0.999)).toBeLessThanOrEqual(4_000);
    expect(actionDurationMs(PetAction.SEARCH_SEAT, () => 0.999)).toBeGreaterThan(2_000);
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

  test("uses a dedicated four-frame animation while searching for a seat", () => {
    expect(poseForAction(PetAction.SEARCH_SEAT, "right")).toBe("search-seat");
    expect(ANIMATIONS["search-seat"].frameCount).toBe(4);
  });
});

describe("window movement", () => {
  test("keeps the same bottom-center anchor when a compact window expands", () => {
    const anchor = bottomCenter({ x: 400, y: 300 }, { width: 100, height: 216 });
    const expandedPosition = windowPositionForBottomCenter(
      anchor,
      { width: 280, height: 320 },
      { x: 0, y: 0, width: 1440, height: 900 },
    );

    expect(anchor).toEqual({ x: 450, y: 516 });
    expect(expandedPosition).toEqual({ x: 310, y: 196 });
    expect(bottomCenter(expandedPosition, { width: 280, height: 320 })).toEqual(anchor);
  });

  test("clamps an expanded window at the screen edge without losing the saved compact anchor", () => {
    const anchor = bottomCenter({ x: 880, y: 560 }, { width: 100, height: 216 });

    expect(windowPositionForBottomCenter(
      anchor,
      { width: 280, height: 320 },
      { x: 0, y: 0, width: 1000, height: 800 },
    )).toEqual({ x: 720, y: 456 });
    expect(windowPositionForBottomCenter(
      anchor,
      { width: 100, height: 216 },
      { x: 0, y: 0, width: 1000, height: 800 },
    )).toEqual({ x: 880, y: 560 });
  });

  test("converts logical viewport sizes for standard and Retina monitors", () => {
    expect(physicalWindowSize({ width: 108, height: 216 }, 1)).toEqual({ width: 108, height: 216 });
    expect(physicalWindowSize({ width: 108, height: 216 }, 2)).toEqual({ width: 216, height: 432 });
  });

  test("maps a body-relative context-menu point into the expanded window", () => {
    const relative = relativeToBottomCenter(
      { x: 80, y: 120 },
      { width: 100, height: 216 },
    );

    expect(relative).toEqual({ x: 30, y: -96 });
    expect(fromBottomCenter(relative, { width: 280, height: 320 })).toEqual({ x: 170, y: 224 });
  });

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

  test("varies random walk distance continuously from 240 to 720 CSS pixels", () => {
    const workArea = { x: 0, y: 0, width: 2200, height: 1200 };
    const windowSize = { width: 280, height: 320 };
    const current = { x: 800, y: 400 };

    const short = randomWalkTarget(current, workArea, windowSize, 1, values(0, 0.5, 0.75));
    const middle = randomWalkTarget(current, workArea, windowSize, 1, values(0.5, 0.5, 0.75));
    const long = randomWalkTarget(current, workArea, windowSize, 1, values(1, 0.5, 0.75));

    expect(Math.hypot(short.x - current.x, short.y - current.y)).toBeCloseTo(240);
    expect(Math.hypot(middle.x - current.x, middle.y - current.y)).toBeCloseTo(480);
    expect(Math.hypot(long.x - current.x, long.y - current.y)).toBeCloseTo(720);
  });

  test("keeps the actual random walk angle within 30 degrees after clamping", () => {
    const current = { x: 16, y: 300 };
    const target = randomWalkTarget(
      current,
      { x: 0, y: 0, width: 1440, height: 900 },
      { width: 280, height: 320 },
      1,
      values(0.5, 1, 0.25),
    );
    const angle = Math.atan2(Math.abs(target.y - current.y), Math.abs(target.x - current.x));

    expect(angle).toBeLessThanOrEqual(Math.PI / 6 + 1e-9);
    expect(target.x).toBeGreaterThanOrEqual(16);
    expect(target.y).toBeGreaterThanOrEqual(16);
  });

  test("plans low-slope waypoints for a vertically aligned target", () => {
    const current = { x: 500, y: 100 };
    const target = { x: 500, y: 500 };
    const path = planWalkPath(
      current,
      target,
      { x: 0, y: 0, width: 1440, height: 900 },
      { width: 280, height: 320 },
      1,
    );
    expect(path.at(-1)).toEqual(target);

    let start = current;
    for (const waypoint of path) {
      const angle = Math.atan2(
        Math.abs(waypoint.y - start.y),
        Math.abs(waypoint.x - start.x),
      );
      expect(angle).toBeLessThanOrEqual(Math.PI / 6 + 1e-9);
      start = waypoint;
    }
  });

  test("uses one segment for a target already within 30 degrees", () => {
    expect(planWalkPath(
      { x: 100, y: 100 },
      { x: 500, y: 200 },
      { x: 0, y: 0, width: 1440, height: 900 },
      { width: 280, height: 320 },
      1,
    )).toEqual([{ x: 500, y: 200 }]);
  });

  test("does not attempt a pure vertical move without horizontal room", () => {
    expect(planWalkPath(
      { x: 0, y: 100 },
      { x: 0, y: 400 },
      { x: 0, y: 0, width: 280, height: 900 },
      { width: 280, height: 320 },
      1,
    )).toEqual([]);
  });
});

function values(...items: number[]): () => number {
  let index = 0;
  return () => items[Math.min(index++, items.length - 1)];
}
