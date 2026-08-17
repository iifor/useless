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

export const physicalWindowSize = (logical: Size, scaleFactor: number): Size => ({
  width: Math.round(logical.width * scaleFactor),
  height: Math.round(logical.height * scaleFactor),
});

export const bottomCenter = (position: Point, size: Size): Point => ({
  x: position.x + size.width / 2,
  y: position.y + size.height,
});

export const windowPositionForBottomCenter = (
  anchor: Point,
  size: Size,
  workArea: Rect,
): Point => clampWindowTarget(
  { x: anchor.x - size.width / 2, y: anchor.y - size.height },
  workArea,
  size,
  0,
);

export const windowPositionForSeatAnchor = (
  anchor: Point,
  petSize: Size,
  workArea: Rect,
): Point => windowPositionForBottomCenter(anchor, petSize, workArea);

export const relativeToBottomCenter = (point: Point, size: Size): Point => ({
  x: point.x - size.width / 2,
  y: point.y - size.height,
});

export const fromBottomCenter = (point: Point, size: Size): Point => ({
  x: point.x + size.width / 2,
  y: point.y + size.height,
});

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
  const distance = (240 + random() * 480) * scaleFactor;
  const angle = random() * Math.PI * 2;
  return clampWindowTarget({
    x: current.x + Math.cos(angle) * distance,
    y: current.y + Math.sin(angle) * distance,
  }, workArea, windowSize, 16 * scaleFactor);
}

export function planWalkPath(
  current: Point,
  target: Point,
  workArea: Rect,
  windowSize: Size,
  scaleFactor: number,
): Point[] {
  const safeTarget = clampWindowTarget(target, workArea, windowSize, 0);
  return pointDistance(current, safeTarget) <= 0.5 * scaleFactor ? [] : [safeTarget];
}

export const directionForMove = (current: Point, target: Point): Direction => {
  const dx = target.x - current.x;
  const dy = target.y - current.y;
  if (Math.abs(dy) > Math.abs(dx)) return dy < 0 ? "up" : "down";
  return dx < 0 ? "left" : "right";
};

const pointDistance = (a: Point, b: Point): number => Math.hypot(b.x - a.x, b.y - a.y);

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(Math.max(value, minimum), maximum);
