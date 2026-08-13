import { PhysicalPosition } from "@tauri-apps/api/dpi";
import { emitTo } from "@tauri-apps/api/event";
import { currentMonitor, getCurrentWindow, Window } from "@tauri-apps/api/window";

import type { Direction } from "./actions";
import { directionForMove, randomWalkTarget, stepTowards, type Point } from "./windowMotion";

const SPEED_CSS_PX_PER_SECOND = 36;
let seatBubbleOwner = 0;

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

export async function moveWindowTo(
  target: Point,
  signal: AbortSignal,
  onDirection: (direction: Direction) => void,
): Promise<void> {
  if (!("__TAURI_INTERNALS__" in window)) return;
  const petWindow = getCurrentWindow();
  const monitor = await currentMonitor();
  if (!monitor) return;

  let current: Point = await petWindow.outerPosition();
  onDirection(directionForMove(current, target));
  let last = performance.now();
  while (!signal.aborted && Math.hypot(target.x - current.x, target.y - current.y) > 0.5) {
    const now = performance.now();
    const distance = SPEED_CSS_PX_PER_SECOND * monitor.scaleFactor * (now - last) / 1000;
    current = stepTowards(current, target, distance);
    await petWindow.setPosition(new PhysicalPosition(Math.round(current.x), Math.round(current.y)));
    last = now;
    await delay(33, signal);
  }
}

export async function showSeatTargetBubble(
  owner: number,
  target: Point,
  kind: "file" | "folder" | "owned-temp" | "virtual",
) {
  if (!("__TAURI_INTERNALS__" in window)) return;
  const bubble = await Window.getByLabel("seat-target");
  if (!bubble || owner !== seatBubbleOwner) return;
  await bubble.setPosition(new PhysicalPosition(Math.round(target.x + 102), Math.round(target.y + 236)));
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
