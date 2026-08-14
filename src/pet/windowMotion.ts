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
  const angle = (random() - 0.5) * Math.PI / 3;
  const direction = random() < 0.5 ? -1 : 1;
  const angles = [angle, -angle, 0, Math.PI / 12, -Math.PI / 12, Math.PI / 6, -Math.PI / 6];
  const candidates: Point[] = [];

  for (const horizontalDirection of [direction, -direction]) {
    for (const candidateAngle of angles) {
      const candidate = clampWindowTarget({
        x: current.x + horizontalDirection * Math.cos(candidateAngle) * distance,
        y: current.y + Math.sin(candidateAngle) * distance,
      }, workArea, windowSize, 16 * scaleFactor);
      if (isLowSlope(current, candidate, 30)) candidates.push(candidate);
    }
  }

  const minimumDistance = 240 * scaleFactor;
  return candidates
    .filter((candidate) => pointDistance(current, candidate) >= minimumDistance)
    .sort((a, b) => Math.abs(pointDistance(current, a) - distance)
      - Math.abs(pointDistance(current, b) - distance))[0]
    ?? candidates.sort((a, b) => pointDistance(current, b) - pointDistance(current, a))[0]
    ?? current;
}

export function planWalkPath(
  current: Point,
  target: Point,
  workArea: Rect,
  windowSize: Size,
  scaleFactor: number,
  maxVerticalAngleDeg = 30,
): Point[] {
  const safeTarget = clampWindowTarget(target, workArea, windowSize, 0);
  if (pointDistance(current, safeTarget) <= 0.5 * scaleFactor) return [];
  if (isLowSlope(current, safeTarget, maxVerticalAngleDeg)) return [safeTarget];

  const minX = workArea.x;
  const maxX = workArea.x + workArea.width - windowSize.width;
  if (maxX <= minX) return [];

  const slope = Math.tan(maxVerticalAngleDeg * Math.PI / 180);
  const path: Point[] = [];
  let from = current;
  for (let index = 0; index < 16; index += 1) {
    if (isLowSlope(from, safeTarget, maxVerticalAngleDeg)) return [...path, safeTarget];

    const edgeX = Math.abs(from.x - minX) > Math.abs(maxX - from.x) ? minX : maxX;
    const dx = Math.abs(edgeX - from.x);
    if (dx <= 0.5 * scaleFactor) return [];
    const remainingY = safeTarget.y - from.y;
    const waypoint = {
      x: edgeX,
      y: from.y + Math.sign(remainingY) * Math.min(Math.abs(remainingY), dx * slope),
    };
    path.push(waypoint);
    from = waypoint;
  }
  return [];
}

export const directionForMove = (current: Point, target: Point): Direction =>
  target.x < current.x ? "left" : "right";

const pointDistance = (a: Point, b: Point): number => Math.hypot(b.x - a.x, b.y - a.y);

const isLowSlope = (from: Point, to: Point, maxAngleDeg: number): boolean => {
  const dx = Math.abs(to.x - from.x);
  const dy = Math.abs(to.y - from.y);
  return dy <= Math.tan(maxAngleDeg * Math.PI / 180) * dx + 1e-9;
};

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(Math.max(value, minimum), maximum);
