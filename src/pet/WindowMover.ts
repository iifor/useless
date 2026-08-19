import { LogicalSize, PhysicalPosition } from "@tauri-apps/api/dpi";
import { emitTo } from "@tauri-apps/api/event";
import { currentMonitor, getCurrentWindow, Window } from "@tauri-apps/api/window";

import type { Direction } from "./actions";
import {
  clampWindowTarget,
  directionForMove,
  petAnchor,
  physicalWindowSize,
  planWalkPath,
  randomWalkTarget,
  stepTowards,
  windowPositionForBottomCenter,
  windowPositionForPetAnchor,
  windowPositionForSeatAnchor,
  type Point,
  type PetViewport,
  type Size,
} from "./windowMotion";

const SPEED_CSS_PX_PER_SECOND = 36;
export const INTERACTION_WINDOW_SIZE = { width: 280, height: 320 };
let seatBubbleOwner = 0;
let savedCompactAnchor: Point | null = null;
let activeCompactViewport: PetViewport = { width: 216, height: 216, originX: 108 };
let layoutQueue: Promise<void> = Promise.resolve();
let pendingViewportLayout: Promise<void> = Promise.resolve();
let layoutRequest = 0;

export type PetWindowMode = "compact" | "interaction";

export function beginPetViewportLayout(): () => void {
  let finish: () => void = () => {};
  pendingViewportLayout = new Promise<void>((resolve) => { finish = resolve; });
  return finish;
}

export function setPetWindowLayout(compactSize: PetViewport, mode: PetWindowMode): Promise<void> {
  const request = ++layoutRequest;
  layoutQueue = layoutQueue.catch(() => undefined).then(async () => {
    if (request !== layoutRequest) return;
    if (!("__TAURI_INTERNALS__" in window)) return;
    const petWindow = getCurrentWindow();
    const [position, currentSize, monitor] = await Promise.all([
      petWindow.outerPosition(),
      petWindow.outerSize(),
      currentMonitor(),
    ]);
    if (!monitor) return;

    const desiredLogicalSize = mode === "interaction" ? INTERACTION_WINDOW_SIZE : compactSize;
    const desiredPhysicalSize = physicalWindowSize(desiredLogicalSize, monitor.scaleFactor);
    const anchor = savedCompactAnchor
      ?? petAnchor(position, currentSize, activeCompactViewport, monitor.scaleFactor);
    if (mode === "interaction" && savedCompactAnchor === null) savedCompactAnchor = anchor;
    const targetPosition = windowPositionForPetAnchor(
      anchor,
      desiredPhysicalSize,
      compactSize,
      monitor.scaleFactor,
      { ...monitor.workArea.position, ...monitor.workArea.size },
    );

    await petWindow.setSize(new LogicalSize(desiredLogicalSize.width, desiredLogicalSize.height));
    await petWindow.setPosition(new PhysicalPosition(
      Math.round(targetPosition.x),
      Math.round(targetPosition.y),
    ));
    activeCompactViewport = compactSize;
    if (mode === "compact") savedCompactAnchor = null;
  });
  return layoutQueue;
}

export async function waitForPetWindowLayout(): Promise<void> {
  await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
  await pendingViewportLayout;
  await layoutQueue;
}

export const claimSeatTargetBubble = (): number => ++seatBubbleOwner;

export async function randomWindowDestination(random = Math.random): Promise<Point> {
  if (!("__TAURI_INTERNALS__" in window)) return { x: 0, y: 0 };
  const petWindow = getCurrentWindow();
  const [position, size, monitor] = await Promise.all([
    petWindow.outerPosition(),
    petWindow.outerSize(),
    currentMonitor(),
  ]);
  if (!monitor) return position;
  return randomWalkTarget(
    position,
    { ...monitor.workArea.position, ...monitor.workArea.size },
    size,
    monitor.scaleFactor,
    random,
  );
}

export async function containCurrentWindow(): Promise<void> {
  if (!("__TAURI_INTERNALS__" in window)) return;
  const petWindow = getCurrentWindow();
  const [position, size, monitor] = await Promise.all([
    petWindow.outerPosition(),
    petWindow.outerSize(),
    currentMonitor(),
  ]);
  if (!monitor) return;
  const target = clampWindowTarget(
    position,
    { ...monitor.workArea.position, ...monitor.workArea.size },
    size,
    0,
  );
  if (target.x !== position.x || target.y !== position.y) {
    await petWindow.setPosition(new PhysicalPosition(target.x, target.y));
  }
}

export async function seatWindowDestination(
  anchor: Point,
  verticalOffsetCss = 0,
): Promise<Point> {
  if (!("__TAURI_INTERNALS__" in window)) return anchor;
  const petWindow = getCurrentWindow();
  const [size, monitor] = await Promise.all([petWindow.outerSize(), currentMonitor()]);
  if (!monitor) return petWindow.outerPosition();
  return windowPositionForSeatAnchor(
    anchor,
    size,
    { ...monitor.workArea.position, ...monitor.workArea.size },
    verticalOffsetCss * monitor.scaleFactor,
  );
}

export async function moveWindowTo(
  target: Point,
  signal: AbortSignal,
  onDirection: (direction: Direction) => void,
): Promise<void> {
  if (!("__TAURI_INTERNALS__" in window)) return;
  await waitForPetWindowLayout();
  const petWindow = getCurrentWindow();
  const [size, monitor] = await Promise.all([petWindow.outerSize(), currentMonitor()]);
  if (!monitor) return;

  let current: Point = await petWindow.outerPosition();
  const waypoints = planWalkPath(
    current,
    target,
    { ...monitor.workArea.position, ...monitor.workArea.size },
    size,
    monitor.scaleFactor,
  );

  for (const waypoint of waypoints) {
    if (signal.aborted) return;
    onDirection(directionForMove(current, waypoint));
    let last = performance.now();
    while (!signal.aborted && Math.hypot(waypoint.x - current.x, waypoint.y - current.y) > 0.5) {
      const now = performance.now();
      const distance = SPEED_CSS_PX_PER_SECOND * monitor.scaleFactor * (now - last) / 1000;
      current = stepTowards(current, waypoint, distance);
      await petWindow.setPosition(new PhysicalPosition(Math.round(current.x), Math.round(current.y)));
      last = now;
      await delay(33, signal);
    }
    if (!signal.aborted) {
      current = waypoint;
      await petWindow.setPosition(new PhysicalPosition(Math.round(current.x), Math.round(current.y)));
    }
  }
}

export async function showSeatTargetBubble(
  owner: number,
  target: Point,
  kind: "file" | "folder" | "owned-temp" | "window" | "virtual",
) {
  if (!("__TAURI_INTERNALS__" in window)) return;
  const bubble = await Window.getByLabel("seat-target");
  if (!bubble || owner !== seatBubbleOwner) return;
  const size = await getCurrentWindow().outerSize();
  await bubble.setPosition(new PhysicalPosition(
    Math.round(target.x + size.width / 2 - 38),
    Math.round(target.y + size.height - 84),
  ));
  if (owner !== seatBubbleOwner) return;
  await emitTo("seat-target", "seat-target:update", { kind });
  if (owner !== seatBubbleOwner) return;
  await bubble.show();
}

export async function hideSeatTargetBubble(owner?: number) {
  if (owner !== undefined && owner !== seatBubbleOwner) return;
  const effectiveOwner = owner ?? ++seatBubbleOwner;
  if (!("__TAURI_INTERNALS__" in window)) return;
  const bubble = await Window.getByLabel("seat-target");
  if (effectiveOwner !== seatBubbleOwner) return;
  await bubble?.hide();
}

export function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
