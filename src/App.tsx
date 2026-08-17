import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import {
  PetAction,
  actionDurationMs,
  dragResumeAction,
  foodResumeAction,
  nextAction,
  shouldClearSeatAfterAction,
  shouldResumeAfterDrag,
  type Direction,
} from "./pet/actions";
import { poseForAction } from "./pet/animations";
import FoodInteraction, {
  beginFoodActivity,
  endFoodActivity,
  runFoodDecision,
  runFoodSelection,
} from "./pet/FoodInteraction";
import { finishFood, type FoodFlow } from "./pet/foodFlow";
import { pickFood, trashFood, type FoodPickerKind } from "./pet/foodPicker";
import PetActionMenu from "./pet/PetActionMenu";
import type { ActionMenuValue, ManualAction } from "./pet/actionMenu";
import {
  arriveThenMaterializeSeat,
  findSeatTarget,
  isPendingOwnedSeat,
  materializeOwnedSeatTarget,
  refreshWindowSeat,
  releaseSeatTarget,
  seatSearchModeForAction,
  seatTargetChanged,
  shouldRenderSeatMarker,
  type DesktopSeatTarget,
  type SeatSearchMode,
} from "./pet/desktopSeat";
import PetRenderer from "./pet/PetRenderer";
import { SeatIcon } from "./pet/SeatIcon";
import {
  INTERACTION_WINDOW_SIZE,
  delay,
  claimSeatTargetBubble,
  containCurrentWindow,
  hideSeatTargetBubble,
  moveWindowTo,
  randomWindowDestination,
  seatWindowDestination,
  setPetWindowLayout,
  showSeatTargetBubble,
  waitForPetWindowLayout,
  type PetWindowMode,
} from "./pet/WindowMover";
import {
  fromBottomCenter,
  relativeToBottomCenter,
  type Point,
  type Size,
} from "./pet/windowMotion";
import {
  runAutomaticUpdater,
  type UpdateBackend,
  type UpdateMetadata,
} from "./update/updateScheduler";

const waitForFood = (milliseconds: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));

export default function App() {
  const [action, setAction] = useState(PetAction.IDLE_STAND);
  const [direction, setDirection] = useState<Direction>("right");
  const [seat, setSeat] = useState<DesktopSeatTarget | null>(null);
  const [automatic, setAutomatic] = useState(true);
  const [manual, setManual] = useState<ManualAction>(PetAction.IDLE_STAND);
  const [revision, setRevision] = useState(0);
  const [menuPoint, setMenuPoint] = useState<Point | null>(null);
  const [foodFlow, setFoodFlow] = useState<FoodFlow>(finishFood);
  const [windowMode, setWindowMode] = useState<PetWindowMode>("compact");
  const active = useRef<AbortController | null>(null);
  const dragResume = useRef<PetAction | null>(null);
  const foodFlowRef = useRef<FoodFlow>(finishFood());
  const foodActive = useRef(false);
  const compactSize = useRef<Size>({ width: 216, height: 216 });
  const windowModeRef = useRef<PetWindowMode>("compact");
  const menuRequest = useRef(0);
  const menuOpen = useRef(false);
  const dragging = useRef(false);

  useEffect(() => {
    if (import.meta.env.DEV || !("__TAURI_INTERNALS__" in window)) return;
    const controller = new AbortController();
    const backend: UpdateBackend = {
      prepare: () => invoke<UpdateMetadata | null>("prepare_update"),
      idleSeconds: () => invoke<number>("system_idle_seconds"),
      install: () => invoke("install_pending_update"),
    };
    void runAutomaticUpdater({
      backend,
      isBusy: () => menuOpen.current || dragging.current || foodActive.current,
      onBeforeInstall: () => {
        active.current?.abort();
        void hideSeatTargetBubble();
        setSeat(null);
        setAction(PetAction.IDLE_STAND);
      },
      onError: (error) => console.error("自动更新失败，将在下个周期重试", error),
      signal: controller.signal,
      sleep: delay,
    }).catch((error) => {
      if (!controller.signal.aborted) console.error("自动更新调度失败", error);
    });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    active.current = controller;
    const signal = controller.signal;
    const isCurrent = () => active.current === controller && !signal.aborted;
    const bubbleOwner = claimSeatTargetBubble();
    void hideSeatTargetBubble(bubbleOwner);

    const walk = async () => {
      if (isCurrent()) setAction(PetAction.WALK_SLOW);
      await waitForPetWindowLayout();
      if (!isCurrent()) return;
      const destination = await randomWindowDestination();
      await moveWindowTo(destination, signal, (value) => {
        if (isCurrent()) setDirection(value);
      });
    };

    const seatSequence = async (searchAction: PetAction = PetAction.SEARCH_SEAT) => {
      const mode: SeatSearchMode | null = seatSearchModeForAction(searchAction);
      if (!mode) return;
      let target: DesktopSeatTarget | null = null;
      try {
        if (isCurrent()) setAction(searchAction);
        await delay(actionDurationMs(searchAction), signal);
        target = await findSeatTarget(mode);
        if (!target || !isCurrent()) return;
        setAction(PetAction.WALK_SLOW);
        await waitForPetWindowLayout();
        if (!isCurrent()) return;
        let destination = target.seatAnchor
          ? await seatWindowDestination(target.seatAnchor)
          : await randomWindowDestination();
        if (!isCurrent()) return;
        if (shouldRenderSeatMarker(target)) {
          await showSeatTargetBubble(bubbleOwner, destination, target.kind);
        }
        if (!isCurrent()) return;
        const wasPendingOwnedSeat = isPendingOwnedSeat(target);
        target = await arriveThenMaterializeSeat(target, () =>
          moveWindowTo(destination, signal, (value) => {
            if (isCurrent()) setDirection(value);
          }), materializeOwnedSeatTarget);
        if (!isCurrent()) return;
        if (wasPendingOwnedSeat) {
          if (target.seatAnchor) {
            destination = await seatWindowDestination(target.seatAnchor);
            await moveWindowTo(destination, signal, (value) => {
              if (isCurrent()) setDirection(value);
            });
          } else if (shouldRenderSeatMarker(target)) {
            await showSeatTargetBubble(bubbleOwner, destination, target.kind);
          }
        }
        if (!isCurrent()) return;
        if (target.kind === "window") {
          const refreshed = await refreshWindowSeat(target);
          if (!refreshed?.seatAnchor) return;
          if (seatTargetChanged(target, refreshed)) {
            target = refreshed;
            await moveWindowTo(
              await seatWindowDestination(refreshed.seatAnchor),
              signal,
              (value) => { if (isCurrent()) setDirection(value); },
            );
          } else {
            target = refreshed;
          }
        }
        if (!isCurrent()) return;
        await hideSeatTargetBubble(bubbleOwner);
        if (!isCurrent()) return;
        setSeat(target);
        setAction(PetAction.SEAT_ON_ITEM);
        const seatedUntil = performance.now() + actionDurationMs(PetAction.SEAT_ON_ITEM);
        while (performance.now() < seatedUntil) {
          await delay(Math.min(1_000, seatedUntil - performance.now()), signal);
          if (target.kind !== "window") continue;
          const refreshed = await refreshWindowSeat(target);
          if (!refreshed || seatTargetChanged(target, refreshed)) {
            setAction(PetAction.IDLE_STAND);
            return;
          }
          target = refreshed;
        }
      } finally {
        if (isCurrent()) {
          await hideSeatTargetBubble(bubbleOwner).catch(() => undefined);
          setSeat(null);
        }
        await releaseSeatTarget(target);
      }
    };

    const run = async () => {
      const resumedAction = dragResume.current;
      dragResume.current = null;
      if (!automatic) {
        setAction(manual);
        if (manual === PetAction.WALK_SLOW) {
          await walk();
          if (isCurrent()) setAction(PetAction.IDLE_STAND);
        }
        const seatMode = seatSearchModeForAction(manual);
        if (seatMode) {
          await seatSequence(manual);
          if (isCurrent()) setAction(PetAction.IDLE_STAND);
        }
        if (manual === PetAction.SEAT_ON_ITEM) setSeat({
          id: "manual",
          name: "测试座位",
          kind: "virtual",
          focused: false,
          appOwned: false,
          virtualMarker: true,
        });
        return;
      }

      let current = resumedAction ?? PetAction.IDLE_STAND;
      while (!signal.aborted) {
        try {
          setAction(current);
          if (current === PetAction.WALK_SLOW) await walk();
          else if (current === PetAction.SEARCH_SEAT) await seatSequence();
          else {
            await delay(actionDurationMs(current), signal);
            if (isCurrent() && shouldClearSeatAfterAction(automatic, current)) setSeat(null);
          }
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

  const applyWindowMode = async (mode: PetWindowMode) => {
    windowModeRef.current = mode;
    if (mode === "interaction") setWindowMode(mode);
    try {
      await setPetWindowLayout(compactSize.current, mode);
      if (mode === "compact") setWindowMode(mode);
    } catch (error) {
      console.error("宠物窗口布局切换失败", error);
    }
  };

  const closeMenu = () => {
    if (menuPoint === null && windowModeRef.current !== "interaction") return;
    menuRequest.current += 1;
    menuOpen.current = false;
    setMenuPoint(null);
    void applyWindowMode("compact").then(() => {
      if (!foodActive.current) setRevision((value) => value + 1);
    });
  };

  const openMenu = (point: Point) => {
    if (foodActive.current) return;
    menuOpen.current = true;
    const request = ++menuRequest.current;
    dragResume.current = dragResumeAction(automatic, action, manual);
    active.current?.abort();
    void hideSeatTargetBubble();
    const relativePoint = relativeToBottomCenter(point, compactSize.current);
    void applyWindowMode("interaction").then(() => {
      if (menuRequest.current === request) setMenuPoint(relativePoint);
    });
  };

  const selectMode = (value: ActionMenuValue) => {
    if (foodActive.current) return;
    menuRequest.current += 1;
    menuOpen.current = false;
    setMenuPoint(null);
    active.current?.abort();
    void hideSeatTargetBubble();
    setSeat(null);
    dragResume.current = null;
    if (value === "AUTO") {
      setAutomatic(true);
      setAction(PetAction.IDLE_STAND);
    } else {
      setAutomatic(false);
      setManual(value);
    }
    void applyWindowMode("compact").then(() => setRevision((value) => value + 1));
  };

  const resumeAfterFood = () => {
    const idle = finishFood();
    foodFlowRef.current = idle;
    setFoodFlow(idle);
    void applyWindowMode("compact").then(() => {
      endFoodActivity(foodActive);
      setAction(foodResumeAction(automatic, manual));
      setRevision((value) => value + 1);
    });
  };

  const setInteractiveFoodFlow = (flow: FoodFlow) => {
    if (windowModeRef.current === "interaction") {
      setFoodFlow(flow);
      return;
    }
    void applyWindowMode("interaction").then(() => setFoodFlow(flow));
  };

  const foodEffects = {
    finish: resumeAfterFood,
    setAction,
    setFlow: setInteractiveFoodFlow,
    wait: waitForFood,
  };

  const chooseFood = async (kind: FoodPickerKind): Promise<void> => {
    if (!beginFoodActivity(foodActive)) return Promise.resolve();
    menuRequest.current += 1;
    menuOpen.current = false;
    dragResume.current = null;
    setMenuPoint(null);
    active.current?.abort();
    void hideSeatTargetBubble();
    setSeat(null);
    await applyWindowMode("compact");
    return runFoodSelection(kind, foodFlowRef, { ...foodEffects, pick: pickFood });
  };

  const decideFood = (decision: "confirm" | "cancel") => {
    void runFoodDecision(decision, foodFlowRef, { ...foodEffects, trash: trashFood });
  };

  const dragStart = () => {
    if (!shouldResumeAfterDrag(foodActive.current)) return;
    dragging.current = true;
    dragResume.current = dragResumeAction(automatic, action, manual);
    active.current?.abort();
    void hideSeatTargetBubble();
  };
  const dragEnd = async () => {
    try {
      await containCurrentWindow();
    } catch (error) {
      console.error("拖动后窗口归位失败", error);
    } finally {
      dragging.current = false;
      if (shouldResumeAfterDrag(foodActive.current)) setRevision((value) => value + 1);
    }
  };

  return (
    <main onPointerDown={() => { if (menuPoint) closeMenu(); }}>
      <div className="pet-stage">
        {shouldRenderSeatMarker(seat) && seat && <SeatIcon kind={seat.kind} />}
        <PetRenderer
          dragDisabled={windowMode === "interaction" || foodActive.current}
          onBodyContextMenu={openMenu}
          onDragEnd={dragEnd}
          onDragStart={dragStart}
          onViewportChange={(size) => {
            compactSize.current = size;
            return setPetWindowLayout(size, windowModeRef.current);
          }}
          pose={poseForAction(action, direction)}
          scale={1}
        />
        <FoodInteraction
          flow={foodFlow}
          onCancel={() => decideFood("cancel")}
          onConfirm={() => decideFood("confirm")}
        />
      </div>
      {menuPoint && (
        <PetActionMenu
          onClose={closeMenu}
          onChooseFood={chooseFood}
          onSelect={selectMode}
          point={fromBottomCenter(menuPoint, INTERACTION_WINDOW_SIZE)}
          selection={automatic ? "AUTO" : manual}
        />
      )}
    </main>
  );
}
