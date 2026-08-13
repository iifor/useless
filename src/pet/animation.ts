export interface FrameRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PixelPoint {
  x: number;
  y: number;
}

export const atlasFrameRect = (
  row: number,
  column: number,
  cellWidth: number,
  cellHeight: number,
): FrameRect => ({
  x: column * cellWidth,
  y: row * cellHeight,
  width: cellWidth,
  height: cellHeight,
});

export const stripFrameRect = (
  frame: number,
  imageWidth: number,
  imageHeight: number,
  frameCount: number,
): FrameRect => {
  const width = imageWidth / frameCount;
  return { x: frame * width, y: 0, width, height: imageHeight };
};

export const isAlphaHit = (
  rgba: Uint8ClampedArray,
  pixelIndex: number,
  threshold = 16,
): boolean => (rgba[pixelIndex * 4 + 3] ?? 0) >= threshold;

export function horizontalContentAnchor(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  threshold = 16,
): number {
  let minY = height;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if ((rgba[(y * width + x) * 4 + 3] ?? 0) < threshold) continue;
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxY < minY) return width / 2;

  let minX = width;
  let maxX = -1;
  const anchorHeight = Math.max(1, Math.ceil((maxY - minY + 1) / 4));
  for (let y = minY; y < minY + anchorHeight; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if ((rgba[(y * width + x) * 4 + 3] ?? 0) < threshold) continue;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
    }
  }
  return maxX < minX ? width / 2 : (minX + maxX + 1) / 2;
}

export const canvasPixelPoint = (
  clientX: number,
  clientY: number,
  bounds: Pick<DOMRect, "left" | "top">,
  dpr: number,
): PixelPoint => ({
  x: Math.floor((clientX - bounds.left) * dpr),
  y: Math.floor((clientY - bounds.top) * dpr),
});
