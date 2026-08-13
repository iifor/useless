import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useRef, type MouseEvent, type PointerEvent } from "react";

import {
  atlasFrameRect,
  canvasPixelPoint,
  horizontalContentAnchor,
  isAlphaHit,
  stripFrameRect,
} from "./animation";
import { ANIMATIONS, type PetPose } from "./animations";
import type { Point } from "./windowMotion";

const WIDTH = 260;
const HEIGHT = 300;
const ATLAS_CELL_WIDTH = 192;
const ATLAS_CELL_HEIGHT = 208;

export interface PetRendererProps {
  pose: PetPose;
  scale: number;
  onDragStart?: () => void;
  onDragEnd?: () => void | Promise<void>;
  onBodyContextMenu?: (point: Point) => void;
}

export default function PetRenderer({
  pose,
  scale,
  onDragStart,
  onDragEnd,
  onBodyContextMenu,
}: PetRendererProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = WIDTH * dpr;
    canvas.height = HEIGHT * dpr;
    canvas.style.width = `${WIDTH}px`;
    canvas.style.height = `${HEIGHT}px`;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.imageSmoothingEnabled = false;

    const spec = ANIMATIONS[pose];
    const image = new Image();
    let frame = 0;
    let frameOffsets: number[] = [];

    const sourceFor = (index: number) => spec.layout === "atlas"
      ? atlasFrameRect(spec.atlasRow ?? 0, index, ATLAS_CELL_WIDTH, ATLAS_CELL_HEIGHT)
      : stripFrameRect(index, image.width, image.height, spec.frameCount);

    const draw = () => {
      const source = sourceFor(frame);
      const fit = Math.min(WIDTH / source.width, HEIGHT / source.height) * scale;
      const width = source.width * fit;
      const height = source.height * fit;

      context.clearRect(0, 0, WIDTH, HEIGHT);
      context.drawImage(
        image,
        source.x,
        source.y,
        source.width,
        source.height,
        (WIDTH - width) / 2 + (frameOffsets[frame] ?? 0) * fit,
        HEIGHT - height,
        width,
        height,
      );
      frame = spec.loop ? (frame + 1) % spec.frameCount : Math.min(frame + 1, spec.frameCount - 1);
    };

    let timer = 0;
    image.onload = () => {
      const analysis = document.createElement("canvas");
      const analysisContext = analysis.getContext("2d", { willReadFrequently: true });
      if (analysisContext) {
        const anchors = Array.from({ length: spec.frameCount }, (_, index) => {
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
          return horizontalContentAnchor(
            analysisContext.getImageData(0, 0, source.width, source.height).data,
            source.width,
            source.height,
          );
        });
        const reference = anchors[0] ?? 0;
        frameOffsets = anchors.map((anchor) => reference - anchor);
      }
      draw();
      timer = window.setInterval(draw, 1000 / spec.fps);
    };
    image.src = spec.source;

    return () => {
      image.onload = null;
      window.clearInterval(timer);
    };
  }, [pose, scale]);

  const isBodyHit = (clientX: number, clientY: number): boolean => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d", { willReadFrequently: true });
    if (!canvas || !context) return false;

    const bounds = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const point = canvasPixelPoint(clientX, clientY, bounds, dpr);
    const pixel = context.getImageData(point.x, point.y, 1, 1).data;
    return isAlphaHit(pixel, 0);
  };

  const startDragging = async (event: PointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0 || !("__TAURI_INTERNALS__" in window)) return;

    if (!isBodyHit(event.clientX, event.clientY)) return;
    onDragStart?.();
    try {
      await getCurrentWindow().startDragging();
    } finally {
      await onDragEnd?.();
    }
  };

  const openContextMenu = (event: MouseEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    if (isBodyHit(event.clientX, event.clientY)) {
      onBodyContextMenu?.({ x: event.clientX, y: event.clientY });
    }
  };

  return (
    <canvas
      aria-label="UNO"
      className="pet-canvas"
      onContextMenu={openContextMenu}
      onPointerDown={(event) => { void startDragging(event); }}
      ref={canvasRef}
    />
  );
}
