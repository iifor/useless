import { describe, expect, test } from "vitest";

import {
  atlasFrameRect,
  canvasPixelPoint,
  computeAnimationViewport,
  findAlphaBounds,
  horizontalContentAnchor,
  isAlphaHit,
  normalizedContentScale,
  stripFrameRect,
} from "../../src/pet/animation";
import {
  ANIMATIONS,
  PET_POSES,
  contentLongEdgeForPose,
} from "../../src/pet/animations";

describe("frame coordinates", () => {
  test("maps an atlas cell to its source rectangle", () => {
    expect(atlasFrameRect(2, 3, 192, 208)).toEqual({
      x: 576,
      y: 416,
      width: 192,
      height: 208,
    });
  });

  test("splits a horizontal strip into equal frames", () => {
    expect(stripFrameRect(3, 1024, 256, 4)).toEqual({
      x: 768,
      y: 0,
      width: 256,
      height: 256,
    });
  });
});

test("maps CSS pointer coordinates to canvas pixels", () => {
  expect(canvasPixelPoint(30, 50, { left: 10, top: 20 }, 2)).toEqual({ x: 40, y: 60 });
});

test("defines a usable animation for every pet pose", () => {
  expect(Object.keys(ANIMATIONS)).toEqual([...PET_POSES]);
  for (const pose of PET_POSES) {
    const animation = ANIMATIONS[pose];
    expect(animation.source).toMatch(/\.(png|webp)$/);
    expect(animation.frameCount).toBeGreaterThan(0);
    expect(animation.fps).toBeGreaterThan(0);
  }
});

test("alpha hit testing rejects transparent pixels", () => {
  const rgba = new Uint8ClampedArray([
    10, 20, 30, 0,
    10, 20, 30, 255,
  ]);

  expect(isAlphaHit(rgba, 0, 16)).toBe(false);
  expect(isAlphaHit(rgba, 1, 16)).toBe(true);
});

test("uses the upper body as a stable anchor when lower limbs move", () => {
  const firstFrame = alphaRows([
    [0, 255, 255, 0, 0, 0],
    [0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 255, 255],
    [0, 0, 0, 0, 0, 0],
  ]);
  const shiftedFrame = alphaRows([
    [0, 0, 0, 255, 255, 0],
    [0, 0, 0, 0, 0, 0],
    [255, 255, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0],
  ]);

  expect(horizontalContentAnchor(firstFrame, 6, 4)).toBe(2);
  expect(horizontalContentAnchor(shiftedFrame, 6, 4)).toBe(4);
});

test("finds visible content without counting transparent padding", () => {
  const rgba = alphaRows([
    [0, 0, 0, 0, 0],
    [0, 255, 255, 0, 0],
    [0, 255, 0, 0, 0],
    [0, 0, 0, 0, 0],
  ]);

  expect(findAlphaBounds(rgba, 5, 4)).toEqual({
    minX: 1,
    minY: 1,
    maxX: 3,
    maxY: 3,
  });
});

test("uses one scale that normalizes the largest animation frame to 200 pixels", () => {
  expect(normalizedContentScale([
    { minX: 10, minY: 20, maxX: 110, maxY: 170 },
    { minX: 30, minY: 40, maxX: 230, maxY: 120 },
  ])).toBe(1);

  expect(normalizedContentScale([
    { minX: 1, minY: 1, maxX: 101, maxY: 151 },
  ], 180)).toBe(1.2);
});

test("uses one shared visible size for every pet pose", () => {
  expect(new Set(PET_POSES.map(contentLongEdgeForPose))).toEqual(new Set([119]));
});

test("does not include prone, lying, or sleeping poses", () => {
  expect(PET_POSES).not.toEqual(expect.arrayContaining([
    "idle-prone",
    "idle-lie",
    "sleep-side",
  ]));
});

test("crops an animation to the aligned alpha union plus eight pixels of padding", () => {
  expect(computeAnimationViewport([
    { bounds: { minX: 10, minY: 20, maxX: 110, maxY: 170 }, anchorX: 60 },
    { bounds: { minX: 30, minY: 40, maxX: 230, maxY: 120 }, anchorX: 130 },
  ], 1)).toEqual({
    width: 216,
    height: 166,
    originX: 108,
    originY: -12,
  });
});

test("uses one stable viewport for every frame in an animation", () => {
  const viewport = computeAnimationViewport([
    { bounds: { minX: 40, minY: 30, maxX: 140, maxY: 180 }, anchorX: 90 },
    { bounds: { minX: 60, minY: 30, maxX: 160, maxY: 170 }, anchorX: 110 },
  ], 200 / 150, 8);

  expect(viewport.width).toBe(150);
  expect(viewport.height).toBe(216);
});

function alphaRows(rows: number[][]): Uint8ClampedArray {
  return Uint8ClampedArray.from(rows.flatMap((row) => row.flatMap((alpha) => [0, 0, 0, alpha])));
}
