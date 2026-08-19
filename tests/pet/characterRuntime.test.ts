import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import PetRenderer from "../../src/pet/PetRenderer";
import PetActionMenu from "../../src/pet/PetActionMenu";
import {
  PetAction,
  actionsForCharacter,
  isActionSupported,
  nextAction,
} from "../../src/pet/actions";
import {
  actionMenuItemsFor,
  rootMenuItemsFor,
} from "../../src/pet/actionMenu";
import {
  ANIMATIONS,
  animationForPose,
  availablePoses,
  poseForAction,
} from "../../src/pet/animations";
import { fullCharacter, minimalCharacter, reducedCharacter } from "./characterFixtures";

describe("character action contract", () => {
  test("derives exact full and reduced action sets", () => {
    expect(actionsForCharacter(fullCharacter)).toEqual([
      PetAction.IDLE_STAND,
      PetAction.IDLE_SIT,
      PetAction.IDLE_PRONE,
      PetAction.IDLE_LIE,
      PetAction.WALK_SLOW,
      PetAction.SEARCH_SEAT,
      PetAction.SEARCH_CURRENT_WINDOW,
      PetAction.SEARCH_DESKTOP_ICON,
      PetAction.SEAT_ON_ITEM,
      PetAction.LOOK_AT_FILE,
      PetAction.ASK_CONFIRM,
      PetAction.EAT_NORMAL,
    ]);
    expect(actionsForCharacter(reducedCharacter)).toEqual([
      PetAction.IDLE_STAND,
      PetAction.IDLE_SIT,
      PetAction.WALK_SLOW,
      PetAction.SEARCH_SEAT,
      PetAction.SEARCH_CURRENT_WINDOW,
      PetAction.SEARCH_DESKTOP_ICON,
      PetAction.SEAT_ON_ITEM,
      PetAction.LOOK_AT_FILE,
      PetAction.ASK_CONFIRM,
      PetAction.EAT_NORMAL,
    ]);
    expect(isActionSupported(minimalCharacter, PetAction.SEARCH_SEAT)).toBe(false);
    expect(isActionSupported(minimalCharacter, PetAction.LOOK_AT_FILE)).toBe(false);
  });

  test("derives idle and capability menu entries", () => {
    expect(actionMenuItemsFor(fullCharacter).map(({ value }) => value)).toEqual([
      "AUTO",
      PetAction.IDLE_STAND,
      PetAction.IDLE_SIT,
      PetAction.IDLE_PRONE,
      PetAction.IDLE_LIE,
      PetAction.WALK_SLOW,
      PetAction.SEARCH_SEAT,
      PetAction.SEARCH_CURRENT_WINDOW,
      PetAction.SEARCH_DESKTOP_ICON,
      PetAction.SEAT_ON_ITEM,
    ]);
    expect(actionMenuItemsFor(reducedCharacter).map(({ value }) => value)).toEqual([
      "AUTO",
      PetAction.IDLE_STAND,
      PetAction.IDLE_SIT,
      PetAction.WALK_SLOW,
      PetAction.SEARCH_SEAT,
      PetAction.SEARCH_CURRENT_WINDOW,
      PetAction.SEARCH_DESKTOP_ICON,
      PetAction.SEAT_ON_ITEM,
    ]);
    expect(rootMenuItemsFor(fullCharacter).map(({ id }) => id)).toEqual([
      "actions", "files", "capabilities",
    ]);
    expect(rootMenuItemsFor(minimalCharacter).map(({ id }) => id)).toEqual([
      "actions", "capabilities",
    ]);
  });

  test("schedules seat search only when enabled and otherwise uses regular actions", () => {
    expect(nextAction(fullCharacter, PetAction.IDLE_STAND, values(0.079)))
      .toBe(PetAction.SEARCH_SEAT);
    expect(nextAction(minimalCharacter, PetAction.IDLE_STAND, values(0.079, 0)))
      .toBe(PetAction.IDLE_SIT);
    expect(nextAction(minimalCharacter, PetAction.IDLE_SIT, values(0.5, 1)))
      .toBe(PetAction.IDLE_STAND);
  });

  test("restores prone and lie only for characters that declare them", () => {
    expect(poseForAction(fullCharacter, PetAction.IDLE_PRONE, "right")).toBe("idle-prone");
    expect(poseForAction(fullCharacter, PetAction.IDLE_LIE, "right")).toBe("idle-lie");
    expect(poseForAction(reducedCharacter, PetAction.IDLE_PRONE, "right")).toBe("idle-stand");
    expect(availablePoses(fullCharacter)).toContain("idle-prone");
    expect(availablePoses(fullCharacter)).toContain("idle-lie");
    expect(availablePoses(reducedCharacter)).not.toContain("idle-prone");
    expect(availablePoses(reducedCharacter)).not.toContain("idle-lie");
  });

  test("applies only the selected character's animation overrides", () => {
    const smootherPangYu = {
      ...reducedCharacter,
      animationOverrides: {
        "walk-slow-left": { frameCount: 8, fps: 8 },
        "eat-normal": { frameCount: 6, fps: 6 },
      },
    };

    expect(animationForPose(smootherPangYu, "walk-slow-left"))
      .toMatchObject({ frameCount: 8, fps: 8, layout: "strip" });
    expect(animationForPose(smootherPangYu, "eat-normal"))
      .toMatchObject({ frameCount: 6, fps: 6, layout: "strip" });
    expect(animationForPose(reducedCharacter, "walk-slow-left"))
      .toEqual(ANIMATIONS["walk-slow-left"]);
  });

  test("uses the selected display name for renderer accessibility", () => {
    const renderer = renderToStaticMarkup(createElement(PetRenderer, {
      character: reducedCharacter,
      pose: "idle-stand",
      scale: 1,
    }));
    const menu = renderToStaticMarkup(createElement(PetActionMenu, {
      actionItems: actionMenuItemsFor(reducedCharacter),
      displayName: reducedCharacter.displayName,
      onChooseFood: () => {},
      onClose: () => {},
      onSelect: () => {},
      point: { x: 0, y: 0 },
      rootItems: rootMenuItemsFor(reducedCharacter),
      selection: "AUTO",
    }));

    expect(renderer).toContain('aria-label="Reduced Pet"');
    expect(menu).toContain('aria-label="Reduced Pet 动作菜单"');
  });
});

function values(...items: number[]): () => number {
  let index = 0;
  return () => items[index++] ?? 0;
}
