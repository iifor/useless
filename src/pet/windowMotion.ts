import type { Direction } from "./actions";

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Rect extends Point, Size {}

export function clampWindowTarget(
  target: Point,
  workArea: Rect,
  windowSize: Size,
  margin: number,
): Point {
  return {
    x: clamp(target.x, workArea.x + margin, workArea.x + workArea.width - windowSize.width - margin),
    y: clamp(target.y, workArea.y + margin, workArea.y + workArea.height - windowSize.height - margin),
  };
}

export function stepTowards(current: Point, target: Point, distance: number): Point {
  const dx = target.x - current.x;
  const dy = target.y - current.y;
  const remaining = Math.hypot(dx, dy);
  if (remaining <= distance || remaining === 0) return target;

  const scale = distance / remaining;
  return { x: current.x + dx * scale, y: current.y + dy * scale };
}

export function randomWalkTarget(
  current: Point,
  workArea: Rect,
  windowSize: Size,
  scaleFactor: number,
  random = Math.random,
): Point {
  const distance = (120 + random() * 360) * scaleFactor;
  const firstAngle = random() * Math.PI * 2;
  let best = current;
  for (let index = 0; index < 16; index += 1) {
    const angle = firstAngle + index * Math.PI / 8;
    const candidate = clampWindowTarget({
      x: current.x + Math.cos(angle) * distance,
      y: current.y + Math.sin(angle) * distance,
    }, workArea, windowSize, 16 * scaleFactor);
    if (Math.hypot(candidate.x - current.x, candidate.y - current.y)
        > Math.hypot(best.x - current.x, best.y - current.y)) best = candidate;
    if (Math.hypot(candidate.x - current.x, candidate.y - current.y) >= 120 * scaleFactor) {
      return candidate;
    }
  }
  return best;
}

export const directionForMove = (current: Point, target: Point): Direction =>
  target.x < current.x ? "left" : "right";

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(Math.max(value, minimum), maximum);
