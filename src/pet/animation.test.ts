import { describe, expect, test } from "vitest";

import {
  atlasFrameRect,
  canvasPixelPoint,
  horizontalContentAnchor,
  isAlphaHit,
  stripFrameRect,
} from "./animation";
import { ANIMATIONS, PET_POSES } from "./animations";

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
  expect(PET_POSES).toHaveLength(8);
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

function alphaRows(rows: number[][]): Uint8ClampedArray {
  return Uint8ClampedArray.from(rows.flatMap((row) => row.flatMap((alpha) => [0, 0, 0, alpha])));
}
