import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useRef, type MouseEvent, type PointerEvent } from "react";

import {
  atlasFrameRect,
  computeAnimationViewport,
  findAlphaBounds,
  horizontalContentAnchor,
  normalizedContentScale,
  stripFrameRect,
  type AnimationViewport,
  type ContentBounds,
} from "./animation";
import { ANIMATIONS, contentLongEdgeForPose, type PetPose } from "./animations";
import { beginPetViewportLayout } from "./WindowMover";
import { canStartPetDrag, petContextMenuPoint } from "./petInput";
import type { Point } from "./windowMotion";

const ATLAS_CELL_WIDTH = 192;
const ATLAS_CELL_HEIGHT = 208;
const CONTENT_PADDING = 8;
const DEFAULT_VIEWPORT_SIZE = 216;

export interface PetRendererProps {
  displayName: string;
  pose: PetPose;
  scale: number;
  onDragStart?: () => void;
  onDragEnd?: () => void | Promise<void>;
  onBodyContextMenu?: (point: Point) => void;
  onViewportChange?: (viewport: AnimationViewport) => void | Promise<void>;
  dragDisabled?: boolean;
}

export default function PetRenderer({
  displayName,
  pose,
  scale,
  onDragStart,
  onDragEnd,
  onBodyContextMenu,
  onViewportChange,
  dragDisabled = false,
}: PetRendererProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewportCallbackRef = useRef(onViewportChange);
  const lastViewportRef = useRef<AnimationViewport | null>(null);
  viewportCallbackRef.current = onViewportChange;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return;

    const spec = ANIMATIONS[pose];
    const targetLongEdge = contentLongEdgeForPose(pose);
    const image = new Image();
    const finishViewportLayout = beginPetViewportLayout();
    let frame = 0;
    let frameAnchors: number[] = [];
    let contentScale = 1;
    let originX = CONTENT_PADDING;
    let originY = CONTENT_PADDING;

    const sourceFor = (index: number) => spec.layout === "atlas"
      ? atlasFrameRect(spec.atlasRow ?? 0, index, ATLAS_CELL_WIDTH, ATLAS_CELL_HEIGHT)
      : stripFrameRect(index, image.width, image.height, spec.frameCount);

    const draw = () => {
      const source = sourceFor(frame);
      const fit = contentScale * scale;
      const width = source.width * fit;
      const height = source.height * fit;

      context.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
      context.drawImage(
        image,
        source.x,
        source.y,
        source.width,
        source.height,
        originX - (frameAnchors[frame] ?? source.width / 2) * fit,
        originY,
        width,
        height,
      );
      frame = spec.loop ? (frame + 1) % spec.frameCount : Math.min(frame + 1, spec.frameCount - 1);
    };

    let timer = 0;
    image.onload = async () => {
      const analysis = document.createElement("canvas");
      const analysisContext = analysis.getContext("2d", { willReadFrequently: true });
      let frames: Array<{ anchor: number; bounds: ContentBounds | null }>;
      if (analysisContext) {
        frames = Array.from({ length: spec.frameCount }, (_, index) => {
          const source = sourceFor(index);
          analysis.width = source.width;
          analysis.height = source.height;
          analysisContext.clearRect(0, 0, source.width, source.height);
          analysisContext.drawImage(
            image,
            source.x,
            source.y,
            source.width,
            source.height,
            0,
            0,
            source.width,
            source.height,
          );
          const pixels = analysisContext.getImageData(0, 0, source.width, source.height).data;
          return {
            anchor: horizontalContentAnchor(pixels, source.width, source.height),
            bounds: findAlphaBounds(pixels, source.width, source.height),
          };
        });
        frameAnchors = frames.map(({ anchor }) => anchor);
        contentScale = normalizedContentScale(
          frames.map(({ bounds }) => bounds),
          targetLongEdge,
        );
      } else {
        const source = sourceFor(0);
        frames = Array.from({ length: spec.frameCount }, () => ({
          anchor: source.width / 2,
          bounds: { minX: 0, minY: 0, maxX: source.width, maxY: source.height },
        }));
        frameAnchors = frames.map(({ anchor }) => anchor);
        contentScale = targetLongEdge / Math.max(source.width, source.height);
      }

      const viewport = computeAnimationViewport(
        frames.map(({ anchor, bounds }) => ({ anchorX: anchor, bounds })),
        contentScale * scale,
        CONTENT_PADDING,
      );
      const dpr = window.devicePixelRatio || 1;
      canvas.width = viewport.width * dpr;
      canvas.height = viewport.height * dpr;
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.imageSmoothingEnabled = false;
      originX = viewport.originX;
      originY = viewport.originY;
      if (lastViewportRef.current?.width !== viewport.width
          || lastViewportRef.current?.height !== viewport.height
          || lastViewportRef.current?.originX !== viewport.originX) {
        lastViewportRef.current = viewport;
        try {
          await viewportCallbackRef.current?.(lastViewportRef.current);
        } catch (error) {
          console.error("宠物窗口尺寸调整失败", error);
        }
      }
      draw();
      timer = window.setInterval(draw, 1000 / spec.fps);
      finishViewportLayout();
    };
    image.onerror = finishViewportLayout;
    image.src = spec.source;

    return () => {
      image.onload = null;
      image.onerror = null;
      window.clearInterval(timer);
      finishViewportLayout();
    };
  }, [pose, scale]);

  const startDragging = async (event: PointerEvent<HTMLCanvasElement>) => {
    if (!canStartPetDrag(
      dragDisabled,
      event.button,
      "__TAURI_INTERNALS__" in window,
    )) return;

    onDragStart?.();
    try {
      await getCurrentWindow().startDragging();
    } finally {
      await onDragEnd?.();
    }
  };

  const openContextMenu = (event: MouseEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    onBodyContextMenu?.(petContextMenuPoint(event.clientX, event.clientY));
  };

  return (
    <canvas
      aria-label={displayName}
      className="pet-canvas"
      height={DEFAULT_VIEWPORT_SIZE}
      onContextMenu={openContextMenu}
      onPointerDown={(event) => { void startDragging(event); }}
      ref={canvasRef}
      width={DEFAULT_VIEWPORT_SIZE}
    />
  );
}
