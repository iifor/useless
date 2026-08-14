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

export interface ContentBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface AnimationFrameLayout {
  bounds: ContentBounds | null;
  anchorX: number;
}

export interface AnimationViewport {
  width: number;
  height: number;
  originX: number;
  originY: number;
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

export function findAlphaBounds(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  threshold = 16,
): ContentBounds | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if ((rgba[(y * width + x) * 4 + 3] ?? 0) < threshold) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return maxX < minX ? null : { minX, minY, maxX: maxX + 1, maxY: maxY + 1 };
}

export function normalizedContentScale(
  bounds: readonly (ContentBounds | null)[],
  targetLongEdge = 200,
): number {
  const longest = bounds.reduce((maximum, item) => item
    ? Math.max(maximum, item.maxX - item.minX, item.maxY - item.minY)
    : maximum, 0);
  return longest > 0 ? targetLongEdge / longest : 1;
}

export function computeAnimationViewport(
  frames: readonly AnimationFrameLayout[],
  scale: number,
  padding = 8,
): AnimationViewport {
  const visible = frames.filter(
    (frame): frame is AnimationFrameLayout & { bounds: ContentBounds } => frame.bounds !== null,
  );
  if (visible.length === 0) {
    return { width: padding * 2, height: padding * 2, originX: padding, originY: padding };
  }

  const contentBottom = Math.max(...visible.map(({ bounds }) => bounds.maxY));
  const minX = Math.floor(Math.min(...visible.map(({ bounds, anchorX }) => bounds.minX - anchorX)) * scale);
  const maxX = Math.ceil(Math.max(...visible.map(({ bounds, anchorX }) => bounds.maxX - anchorX)) * scale);
  const minY = Math.floor(Math.min(...visible.map(({ bounds }) => bounds.minY - contentBottom)) * scale);
  const maxY = Math.ceil(Math.max(...visible.map(({ bounds }) => bounds.maxY - contentBottom)) * scale);

  return {
    width: maxX - minX + padding * 2,
    height: maxY - minY + padding * 2,
    originX: padding - minX,
    originY: padding - minY - contentBottom * scale,
  };
}

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
