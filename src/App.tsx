import { useEffect, useRef, useState } from "react";

import { PetAction, actionDurationMs, nextAction } from "./pet/actions";
import { poseForAction } from "./pet/animations";
import PetActionMenu from "./pet/PetActionMenu";
import type { ActionMenuValue } from "./pet/actionMenu";
import { findSeatTarget, releaseSeatTarget, type DesktopSeatTarget } from "./pet/desktopSeat";
import PetRenderer from "./pet/PetRenderer";
import { SeatIcon } from "./pet/SeatIcon";
import {
  delay,
  claimSeatTargetBubble,
  hideSeatTargetBubble,
  moveWindowTo,
  randomWindowDestination,
  showSeatTargetBubble,
} from "./pet/WindowMover";
import type { Point } from "./pet/windowMotion";

export default function App() {
  const [action, setAction] = useState(PetAction.IDLE_STAND);
  const [direction, setDirection] = useState<"left" | "right">("right");
  const [seat, setSeat] = useState<DesktopSeatTarget | null>(null);
  const [automatic, setAutomatic] = useState(true);
  const [manual, setManual] = useState(PetAction.IDLE_STAND);
  const [revision, setRevision] = useState(0);
  const [menuPoint, setMenuPoint] = useState<Point | null>(null);
  const active = useRef<AbortController | null>(null);

  useEffect(() => {
    setMenuPoint(null);
  }, [action]);

  useEffect(() => {
    const controller = new AbortController();
    active.current = controller;
    const signal = controller.signal;
    const isCurrent = () => active.current === controller && !signal.aborted;
    const bubbleOwner = claimSeatTargetBubble();
    void hideSeatTargetBubble(bubbleOwner);

    const walk = async () => {
      if (isCurrent()) setAction(PetAction.WALK_SLOW);
      await moveWindowTo(await randomWindowDestination(), signal, (value) => {
        if (isCurrent()) setDirection(value);
      });
    };

    const seatSequence = async () => {
      let target: DesktopSeatTarget | null = null;
      try {
        if (isCurrent()) setAction(PetAction.SEARCH_SEAT);
        await delay(actionDurationMs(PetAction.SEARCH_SEAT), signal);
        target = await findSeatTarget();
        if (!isCurrent()) return;
        const destination = target.screenPosition ?? await randomWindowDestination();
        if (!isCurrent()) return;
        if (!target.screenPosition) await showSeatTargetBubble(bubbleOwner, destination, target.kind);
        if (!isCurrent()) return;
        setAction(PetAction.WALK_SLOW);
        await moveWindowTo(destination, signal, (value) => {
          if (isCurrent()) setDirection(value);
        });
        if (!isCurrent()) return;
        await hideSeatTargetBubble(bubbleOwner);
        if (!isCurrent()) return;
        setSeat(target);
        setAction(PetAction.SEAT_ON_ITEM);
        await delay(actionDurationMs(PetAction.SEAT_ON_ITEM), signal);
      } finally {
        if (isCurrent()) {
          await hideSeatTargetBubble(bubbleOwner).catch(() => undefined);
          setSeat(null);
        }
        await releaseSeatTarget(target);
      }
    };

    const run = async () => {
      if (!automatic) {
        setAction(manual);
        if (manual === PetAction.WALK_SLOW) {
          await walk();
          if (isCurrent()) setAction(PetAction.IDLE_STAND);
        }
        if (manual === PetAction.SEARCH_SEAT) {
          await seatSequence();
          if (isCurrent()) setAction(PetAction.IDLE_STAND);
        }
        if (manual === PetAction.SEAT_ON_ITEM) setSeat({ id: "manual", name: "测试座位", kind: "virtual", appOwned: false });
        return;
      }

      let current = PetAction.IDLE_STAND;
      while (!signal.aborted) {
        try {
          setAction(current);
          if (current === PetAction.WALK_SLOW) await walk();
          else if (current === PetAction.SEARCH_SEAT) await seatSequence();
          else await delay(actionDurationMs(current), signal);
          current = nextAction(current);
        } catch (error) {
          if (signal.aborted) throw error;
          console.error("宠物动作失败，恢复站立后继续调度", error);
          current = PetAction.IDLE_STAND;
          setAction(current);
          await delay(1_000, signal);
        }
      }
    };

    void run().catch((error) => {
      if (!(error instanceof DOMException && error.name === "AbortError")) console.error(error);
    });
    return () => {
      controller.abort();
      void hideSeatTargetBubble();
    };
  }, [automatic, manual, revision]);

  const selectMode = (value: ActionMenuValue) => {
    setMenuPoint(null);
    active.current?.abort();
    void hideSeatTargetBubble();
    setSeat(null);
    if (value === "AUTO") {
      setAutomatic(true);
      setAction(PetAction.IDLE_STAND);
    } else {
      setAutomatic(false);
      setManual(value as PetAction);
    }
    setRevision((value) => value + 1);
  };

  const dragStart = () => {
    setMenuPoint(null);
    active.current?.abort();
    void hideSeatTargetBubble();
  };
  const dragEnd = () => {
    setSeat(null);
    setAutomatic(true);
    setAction(PetAction.IDLE_STAND);
    setRevision((value) => value + 1);
  };

  return (
    <main onPointerDown={() => setMenuPoint(null)}>
      <div className="pet-stage">
        {seat && <SeatIcon kind={seat.kind} />}
        <PetRenderer
          onBodyContextMenu={setMenuPoint}
          onDragEnd={dragEnd}
          onDragStart={dragStart}
          pose={poseForAction(action, direction)}
          scale={1}
        />
      </div>
      {menuPoint && (
        <PetActionMenu
          onClose={() => setMenuPoint(null)}
          onSelect={selectMode}
          point={menuPoint}
          selection={automatic ? "AUTO" : manual}
        />
      )}
    </main>
  );
}
