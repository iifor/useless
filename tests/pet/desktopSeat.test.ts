import { describe, expect, test } from "vitest";

import {
  arriveThenMaterializeSeat,
  chooseSeatTarget,
  isPendingOwnedSeat,
  materializeOwnedSeatTarget,
  seatTargetChanged,
  shouldRenderSeatMarker,
  type DesktopSeatTarget,
} from "../../src/pet/desktopSeat";
import { windowPositionForSeatAnchor } from "../../src/pet/windowMotion";

const icon = target("file", "file");
const windowSeat = target("window", "window");

describe("desktop seat selection", () => {
  test("prefers the focused window, then an icon, then a deferred owned seat", () => {
    const focused = { ...windowSeat, id: "focused", focused: true };
    expect(chooseSeatTarget([icon, windowSeat, focused], values(0.5, 0.9, 0))).toEqual(focused);
    expect(chooseSeatTarget([icon, windowSeat], values(0.5, 0.9, 0))).toEqual(icon);
    expect(isPendingOwnedSeat(chooseSeatTarget([], values(0)))).toBe(true);
  });

  test("creates an owned seat only after arrival and never after a failed arrival", async () => {
    const pending = chooseSeatTarget([], values(0));
    const events: string[] = [];
    const materialize = (target: DesktopSeatTarget) => materializeOwnedSeatTarget(
      target,
      async () => {
        events.push("create");
        return {
          id: "owned",
          name: "宠物的座位.tmp",
          kind: "owned-temp",
          path: "/Desktop/宠物的座位.tmp",
          focused: false,
          appOwned: true,
          virtualMarker: true,
        };
      },
      async () => [],
      async () => undefined,
    );

    const created = await arriveThenMaterializeSeat(
      pending,
      async () => { events.push("arrive"); },
      materialize,
    );
    expect(events).toEqual(["arrive", "create"]);
    expect(created.path).toBe("/Desktop/宠物的座位.tmp");

    events.length = 0;
    await expect(arriveThenMaterializeSeat(
      pending,
      async () => { throw new Error("walk cancelled"); },
      materialize,
    )).rejects.toThrow("walk cancelled");
    expect(events).toEqual([]);
  });

  test("renders a marker only for virtual targets", () => {
    expect(shouldRenderSeatMarker(icon)).toBe(false);
    expect(shouldRenderSeatMarker({ ...icon, kind: "virtual", virtualMarker: true })).toBe(true);
  });

  test("detects a moved or disappeared window seat", () => {
    expect(seatTargetChanged(windowSeat, { ...windowSeat })).toBe(false);
    expect(seatTargetChanged(windowSeat, {
      ...windowSeat,
      seatAnchor: { x: 101, y: 100 },
    })).toBe(true);
    expect(seatTargetChanged(windowSeat, null)).toBe(true);
  });
});

test("aligns the pet bottom center to a physical seat anchor at 1x and 2x", () => {
  const workArea = { x: 0, y: 0, width: 1600, height: 1000 };
  expect(windowPositionForSeatAnchor(
    { x: 500, y: 400 },
    { width: 120, height: 200 },
    workArea,
  )).toEqual({ x: 440, y: 200 });
  expect(windowPositionForSeatAnchor(
    { x: 1000, y: 800 },
    { width: 240, height: 400 },
    { x: 0, y: 0, width: 3200, height: 2000 },
  )).toEqual({ x: 880, y: 400 });
});

function target(kind: "file" | "window", id: string): DesktopSeatTarget {
  return {
    id,
    name: id,
    kind,
    seatAnchor: { x: 100, y: 100 },
    focused: false,
    appOwned: false,
    virtualMarker: false,
  };
}

function values(...items: number[]): () => number {
  let index = 0;
  return () => items[Math.min(index++, items.length - 1)];
}
