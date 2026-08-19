# PangYu Smooth Animation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade UNO PangYu to eight-frame four-direction walking and a six-frame eating loop while UNO and UNO Yan keep their current four-frame extensions.

**Architecture:** Keep the shared animation protocol as the default, then merge a small optional `animationOverrides` map from the selected character manifest. Validate each required PNG against its resolved frame count, and replace only PangYu's five approved strips after hatch-pet generation and QA.

**Tech Stack:** React 19, TypeScript 5.9, Vite 7, Vitest 3, Tauri 2, Node.js standard library, Rust, hatch-pet, imagegen, bundled Python/Pillow.

**Spec:** `docs/superpowers/specs/2026-08-19-pangyu-smooth-animation-design.md`

## Global Constraints

- Only UNO PangYu receives new runtime assets in this iteration.
- `walk-slow-left/right/up/down` use 8 independent frames at 8 FPS.
- `eat-normal` uses 6 independent frames at 6 FPS.
- Every other extension keeps its existing default frame count and FPS.
- UNO and UNO Yan assets and manifests remain unchanged.
- Use `characters/uno-pangyu/canonical-base.png` as the only identity reference.
- Do not change the standard v2 atlas, pet contract, movement speed, action scheduler, FoodSafety, or file interaction order.
- Do not simulate extra frames with duplication, interpolation, CSS transforms, or runtime image blending.
- Image generation and visual QA must follow `hatch-pet`; call `load_workspace_dependencies` before any bundled Python script and use its exact Python path.
- Keep generated files outside tracked source until visual and deterministic QA pass.
- The current worktree contains prior uncommitted renderer and command-selection changes. Before Task 1, verify and commit those changes separately or explicitly preserve them; never mix them into a PangYu commit by staging whole files blindly.

---

### Task 1: Character-level runtime animation overrides

**Files:**
- Modify: `src/pet/characterManifest.ts`
- Modify: `src/pet/animations.ts`
- Modify: `src/pet/PetRenderer.tsx`
- Modify: `src/App.tsx`
- Modify: `tests/pet/characterRuntime.test.ts`
- Modify: `tests/pet/animation.test.ts`

**Interfaces:**
- Produces: `AnimationOverrideId`, `AnimationOverride`, and optional `CharacterManifest.animationOverrides`.
- Produces: `animationForPose(character: CharacterManifest, pose: PetPose): AnimationSpec`.
- Changes: `PetRendererProps` consumes `character: CharacterManifest` instead of a display-name-only identity prop.

- [ ] **Step 1: Preserve the existing dirty worktree baseline**

Run:

```bash
git status --short
git diff --check
pnpm test
```

Expected: existing renderer and selector changes are visible, `git diff --check` is clean, and all tests pass. Commit those prior changes separately before touching Task 1 files, or stage only Task 1 hunks in later commits.

- [ ] **Step 2: Write failing runtime override tests**

Add `animationForPose` to the imports in `tests/pet/characterRuntime.test.ts`, then add:

```ts
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
```

Update the renderer accessibility test to pass `character: reducedCharacter` instead of `displayName`.

In `tests/pet/animation.test.ts`, add a default-contract assertion:

```ts
test("keeps four-frame defaults when a character has no override", () => {
  for (const pose of [
    "walk-slow-left",
    "walk-slow-right",
    "walk-slow-up",
    "walk-slow-down",
    "eat-normal",
  ] as const) {
    expect(animationForPose(reducedCharacter, pose).frameCount).toBe(4);
  }
});
```

- [ ] **Step 3: Run focused tests and verify RED**

Run:

```bash
pnpm exec vitest run tests/pet/characterRuntime.test.ts tests/pet/animation.test.ts
```

Expected: FAIL because `animationForPose` and manifest override types do not exist, and the renderer still accepts only `displayName`.

- [ ] **Step 4: Add the minimal manifest types**

Add to `src/pet/characterManifest.ts`:

```ts
export type AnimationOverrideId =
  | "idle-sit"
  | "idle-prone"
  | "idle-lie"
  | "walk-slow-left"
  | "walk-slow-right"
  | "walk-slow-up"
  | "walk-slow-down"
  | "search-seat"
  | "search-current-window"
  | "search-desktop-icon"
  | "seat-on-item"
  | "look-file"
  | "ask-confirm"
  | "eat-normal";

export interface AnimationOverride {
  frameCount: number;
  fps: number;
}
```

Add this optional field to `CharacterManifest`:

```ts
animationOverrides?: Partial<Record<AnimationOverrideId, AnimationOverride>>;
```

- [ ] **Step 5: Resolve the animation from the selected character**

In `src/pet/animations.ts`, add:

```ts
export function animationForPose(
  character: CharacterManifest,
  pose: PetPose,
): AnimationSpec {
  const override = character.animationOverrides?.[
    pose as keyof NonNullable<CharacterManifest["animationOverrides"]>
  ];
  return override ? { ...ANIMATIONS[pose], ...override } : ANIMATIONS[pose];
}
```

Do not mutate `ANIMATIONS`; it remains the shared default contract.

- [ ] **Step 6: Make the renderer consume the character**

In `src/pet/PetRenderer.tsx`:

```ts
import type { CharacterManifest } from "./characterManifest";
import { animationForPose, contentLongEdgeForPose, type PetPose } from "./animations";

export interface PetRendererProps {
  character: CharacterManifest;
  pose: PetPose;
  scale: number;
  // keep the existing callbacks unchanged
}
```

Inside the effect use:

```ts
const spec = animationForPose(character, pose);
```

Use `character.displayName` for `aria-label`, and include `character` in the effect dependency list. In `src/App.tsx`, pass:

```tsx
<PetRenderer
  character={PET_CHARACTER}
  pose={poseForAction(PET_CHARACTER, action, direction)}
  scale={1}
  // preserve every existing callback
/>
```

- [ ] **Step 7: Run focused and full tests**

Run:

```bash
pnpm exec vitest run tests/pet/characterRuntime.test.ts tests/pet/animation.test.ts
pnpm test
```

Expected: focused tests and the full suite pass; UNO and Yan still resolve the same default animation objects.

- [ ] **Step 8: Commit Task 1**

```bash
git add src/pet/characterManifest.ts src/pet/animations.ts src/pet/PetRenderer.tsx src/App.tsx tests/pet/characterRuntime.test.ts tests/pet/animation.test.ts
git commit -m "feat: support character animation overrides"
```

---

### Task 2: Frame-aware character package validation

**Files:**
- Modify: `scripts/pet-validate.mjs`
- Modify: `tests/pet/characterPackage.test.js`

**Interfaces:**
- Consumes: optional `manifest.animationOverrides` from Task 1.
- Produces: package validation that resolves each required strip's exact frame count.
- Enforces: `frameCount` integer range `1..16` and `fps` integer range `1..24`.

- [ ] **Step 1: Extend the temporary package helper**

In `tests/pet/characterPackage.test.js`, allow a strip-specific fake width:

```js
await Promise.all(strips.map((strip) => writeFile(
  join(stripsRoot, `${strip}.png`),
  png(options.pngByStrip?.[strip] ?? options.png),
)));
```

- [ ] **Step 2: Write failing valid-override and resolved-width tests**

Add:

```js
test("validates each strip against its configured frame count", async () => {
  const root = await tempRoot();
  await writePackage(root, "valid-pet", {
    manifest: {
      capabilities: ["file-eating"],
      animationOverrides: {
        "walk-slow-left": { frameCount: 8, fps: 8 },
        "eat-normal": { frameCount: 6, fps: 6 },
      },
    },
    pngByStrip: {
      "walk-slow-left": { width: 16 },
      "eat-normal": { width: 12 },
    },
  });

  await expect(validateCharacterPackage(join(root, "characters"), "valid-pet"))
    .resolves.toEqual([]);
});

test("rejects a strip width that matches four frames but not its override", async () => {
  const root = await tempRoot();
  await writePackage(root, "valid-pet", {
    manifest: {
      animationOverrides: {
        "walk-slow-left": { frameCount: 8, fps: 8 },
      },
    },
    pngByStrip: { "walk-slow-left": { width: 12 } },
  });

  await expect(validateCharacterPackage(join(root, "characters"), "valid-pet"))
    .resolves.toEqual(expect.arrayContaining([
      expect.stringContaining("width must be divisible by 8"),
    ]));
});
```

- [ ] **Step 3: Write failing invalid-override tests**

Add a table covering these exact failures:

```js
test.each([
  ["unknown action", { "dance": { frameCount: 8, fps: 8 } }, "unknown animation"],
  ["zero frames", { "walk-slow-left": { frameCount: 0, fps: 8 } }, "frameCount"],
  ["fractional frames", { "walk-slow-left": { frameCount: 1.5, fps: 8 } }, "frameCount"],
  ["too many frames", { "walk-slow-left": { frameCount: 17, fps: 8 } }, "frameCount"],
  ["zero fps", { "walk-slow-left": { frameCount: 8, fps: 0 } }, "fps"],
  ["fractional fps", { "walk-slow-left": { frameCount: 8, fps: 1.5 } }, "fps"],
  ["too much fps", { "walk-slow-left": { frameCount: 8, fps: 25 } }, "fps"],
])("rejects animation override %s", async (_name, animationOverrides, expected) => {
  const root = await tempRoot();
  await writePackage(root, "valid-pet", { manifest: { animationOverrides } });
  await expect(validateCharacterPackage(join(root, "characters"), "valid-pet"))
    .resolves.toEqual(expect.arrayContaining([expect.stringContaining(expected)]));
});
```

- [ ] **Step 4: Run focused tests and verify RED**

Run:

```bash
pnpm exec vitest run tests/pet/characterPackage.test.js
```

Expected: the validator ignores overrides, accepts invalid values, and still checks every PNG against four frames.

- [ ] **Step 5: Implement strict override validation**

In `scripts/pet-validate.mjs`, derive the known override names from the existing strip lists:

```js
const optionalIdleStrips = ["idle-sit", "idle-prone", "idle-lie"];
const knownAnimationOverrides = new Set([
  ...optionalIdleStrips,
  ...walkStrips,
  ...Object.values(capabilityStrips).flat(),
]);

function validatedAnimationOverrides(manifest, errors, manifestPath) {
  const overrides = manifest.animationOverrides ?? {};
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) {
    errors.push(`${manifestPath}: animationOverrides must be an object`);
    return {};
  }
  for (const [name, value] of Object.entries(overrides)) {
    if (!knownAnimationOverrides.has(name)) {
      errors.push(`${manifestPath}: animationOverrides contains unknown animation ${name}`);
      continue;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      errors.push(`${manifestPath}: animationOverrides.${name} must be an object`);
      continue;
    }
    if (!Number.isInteger(value.frameCount) || value.frameCount < 1 || value.frameCount > 16) {
      errors.push(`${manifestPath}: animationOverrides.${name}.frameCount must be an integer from 1 to 16`);
    }
    if (!Number.isInteger(value.fps) || value.fps < 1 || value.fps > 24) {
      errors.push(`${manifestPath}: animationOverrides.${name}.fps must be an integer from 1 to 24`);
    }
  }
  return overrides;
}
```

Change `validatePngStrip` to accept `frameCount` and replace the fixed divisor:

```js
async function validatePngStrip(path, errors, label, frameCount = 4) {
  // preserve the existing PNG signature, IHDR, dimensions, and RGBA checks
  if (width % frameCount !== 0) {
    errors.push(`${label}: PNG width must be divisible by ${frameCount}`);
  }
}
```

Before validating required strips:

```js
const animationOverrides = validatedAnimationOverrides(manifest, errors, manifestPath);
```

Resolve each required strip with:

```js
const frameCount = animationOverrides[strip]?.frameCount ?? 4;
return validatePngStrip(path, errors, pathLabel(charactersRoot, path), frameCount);
```

- [ ] **Step 6: Run focused and full tests**

Run:

```bash
pnpm exec vitest run tests/pet/characterPackage.test.js
pnpm test
```

Expected: all override boundary tests pass and all three unchanged production packages remain valid.

- [ ] **Step 7: Commit Task 2**

```bash
git add scripts/pet-validate.mjs tests/pet/characterPackage.test.js
git commit -m "feat: validate per-character animation frames"
```

---

### Task 3: Generate and install PangYu's five smoother strips

**Files:**
- Modify: `characters/uno-pangyu/character.json`
- Replace: `characters/uno-pangyu/pet/extended-animations/walk-slow-left.png`
- Replace: `characters/uno-pangyu/pet/extended-animations/walk-slow-right.png`
- Replace: `characters/uno-pangyu/pet/extended-animations/walk-slow-up.png`
- Replace: `characters/uno-pangyu/pet/extended-animations/walk-slow-down.png`
- Replace: `characters/uno-pangyu/pet/extended-animations/eat-normal.png`
- Create: `characters/uno-pangyu/qa/smooth-animations/walk-slow-left.gif`
- Create: `characters/uno-pangyu/qa/smooth-animations/walk-slow-right.gif`
- Create: `characters/uno-pangyu/qa/smooth-animations/walk-slow-up.gif`
- Create: `characters/uno-pangyu/qa/smooth-animations/walk-slow-down.gif`
- Create: `characters/uno-pangyu/qa/smooth-animations/eat-normal.gif`
- Create: `characters/uno-pangyu/qa/smooth-animations/validation.json`
- Modify: `tests/pet/characterPackage.test.js`

**Interfaces:**
- Consumes: `animationOverrides` runtime and validation support from Tasks 1 and 2.
- Produces: five transparent equal-slot PNG strips and durable visual QA evidence.
- Produces: PangYu manifest overrides for 8-frame walking and 6-frame eating.

- [ ] **Step 1: Start the hatch-pet progress checklist and load its runtime**

Publish and maintain this checklist during execution:

```text
1. Getting PangYu ready.
2. Imagining PangYu's main look. (reuse approved canonical)
3. Picturing PangYu's smoother poses.
4. Hatching PangYu's upgraded desktop animations.
```

Call `load_workspace_dependencies`, record its exact Python executable as `PYTHON`, and set:

```bash
SKILL_DIR=/Users/wuqingfu/.codex/skills/hatch-pet
RUN_DIR="$(mktemp -d /private/tmp/uno-pangyu-smooth.XXXXXX)"
```

- [ ] **Step 2: Prepare hatch-pet layout references**

Run with the exact `PYTHON` returned by the workspace dependency tool:

```bash
"$PYTHON" "$SKILL_DIR/scripts/prepare_pet_run.py" \
  --pet-name "UNO PangYu Smooth" \
  --description "PangYu desktop animation upgrade" \
  --reference "$PWD/characters/uno-pangyu/canonical-base.png" \
  --output-dir "$RUN_DIR" \
  --pet-notes "Preserve the approved semi-realistic PangYu identity, peach Hanfu, green floral chest band, purple-red ribbons, black traditional updo, floral hair ornaments, and calm expression." \
  --style-preset auto \
  --force
```

Use `references/layout-guides/running-right.png` as the layout-only guide for every 8-frame walk strip and `references/layout-guides/idle.png` as the layout-only guide for the 6-frame eating strip.

- [ ] **Step 3: Generate the four independent walking strips**

Use one lightweight imagegen worker per strip, with at most three active at once. Attach both:

```text
characters/uno-pangyu/canonical-base.png — canonical identity reference
$RUN_DIR/references/layout-guides/running-right.png — layout only
```

Create four prompt files. Each file uses the following exact shared body after the two action lines listed below:

```text
Create one horizontal 8-frame desktop-pet animation strip for the exact canonical PangYu character.
Show eight genuinely distinct, evenly timed gait phases forming one seamless loop: contact, down, passing, up, then the opposing-leg counterparts.
Preserve the exact same face, black traditional updo, floral hair ornaments and hanging pieces, peach Hanfu, green floral chest band, purple-red ribbons, proportions, lighting, and semi-realistic miniature style in all frames.
Eight equal-width separated slots, full body complete in every slot, stable scale, stable lower-body baseline, stable torso registration, no overlap or clipping.
Flat pure blue #0000FF chroma background only. No text, grid, labels, props, file icons, shadows, action lines, scenery, detached effects, or transparent gaps inside the body.
```

Prepend these exact two lines to the matching prompt file:

```text
walk-slow-left.md
Action: slow walking screen-left.
The character unmistakably faces and travels screen-left; sleeves, skirt and ribbons follow through without flipping ornaments or identity details.

walk-slow-right.md
Action: slow walking screen-right.
The character unmistakably faces and travels screen-right; sleeves, skirt and ribbons follow through without flipping ornaments or identity details.

walk-slow-up.md
Action: slow walking away/up-screen.
The character walks away/up-screen; show restrained back/upper-body orientation and alternating steps while preserving recognizable hair ornaments and clothing.

walk-slow-down.md
Action: slow walking toward/down-screen.
The character walks toward/down-screen; show restrained front orientation and alternating steps while preserving recognizable face and clothing.
```

Reject and regenerate the whole strip if it contains fewer than eight distinct poses, unequal slots, cross-slot content, identity drift, a reversed cadence, or an outer-edge crop.

- [ ] **Step 4: Generate the six-frame eating strip**

Attach the canonical and `$RUN_DIR/references/layout-guides/idle.png`, then use:

```text
Create one horizontal 6-frame desktop-pet animation strip for the exact canonical PangYu character.
Action sequence: calmly inspect food, lean and pick it up, open mouth, bring it into the mouth, two visibly different chewing phases, then swallow with a restrained satisfied expression. Combine the approach and pickup within the early frames so the complete story fits exactly six slots.
The food/file icon is rendered by the app and must not appear in the sprite.
Preserve the exact same face, black traditional updo, floral hair ornaments and hanging pieces, peach Hanfu, green floral chest band, purple-red ribbons, proportions, lighting, and semi-realistic miniature style in all frames.
Six equal-width separated slots, full body complete in every slot, stable scale, stable lower-body baseline, stable torso registration, no overlap or clipping.
Flat pure blue #0000FF chroma background only. No text, grid, labels, props, file icons, shadows, action lines, scenery, detached effects, or transparent gaps inside the body.
```

Reject and regenerate the complete strip if any slot invents a file/icon, changes identity, or breaks the six-step sequence.

- [ ] **Step 5: Remove chroma without altering strip geometry**

Copy the selected sources to these exact paths:

```text
$RUN_DIR/decoded/walk-slow-left-source.png
$RUN_DIR/decoded/walk-slow-right-source.png
$RUN_DIR/decoded/walk-slow-up-source.png
$RUN_DIR/decoded/walk-slow-down-source.png
$RUN_DIR/decoded/eat-normal-source.png
```

Use only the official hatch-pet chroma function to make RGBA strips with identical dimensions:

```bash
for ACTION in walk-slow-left walk-slow-right walk-slow-up walk-slow-down eat-normal; do
  PYTHONPATH="$SKILL_DIR/scripts" "$PYTHON" -c '
  from pathlib import Path
  from PIL import Image
  from assemble_extended_atlas import parse_hex_color, remove_chroma_background
  source = Path(__import__("sys").argv[1])
  target = Path(__import__("sys").argv[2])
  with Image.open(source) as opened:
      cleaned = remove_chroma_background(opened, parse_hex_color("#0000FF"), 96)
  target.parent.mkdir(parents=True, exist_ok=True)
  cleaned.save(target)
  ' "$RUN_DIR/decoded/${ACTION}-source.png" "$RUN_DIR/cleaned/${ACTION}.png"
done
```

Then run the official edge-local cleanup once per cleaned strip:

```bash
for ACTION in walk-slow-left walk-slow-right walk-slow-up walk-slow-down eat-normal; do
  "$PYTHON" "$SKILL_DIR/scripts/despill_chroma_edges.py" \
    "$RUN_DIR/cleaned/${ACTION}.png" \
    --output "$RUN_DIR/final/${ACTION}.png" \
    --chroma-key '#0000FF' \
    --json-out "$RUN_DIR/qa/${ACTION}-despill.json"
done
```

Do not resize, crop, recenter, mirror, or concatenate generated frames after this point.

- [ ] **Step 6: Extract and inspect every final strip**

For each walking action, copy its final strip into an isolated QA decoded directory under the alias `running-right.png`, then run:

```bash
for ACTION in walk-slow-left walk-slow-right walk-slow-up walk-slow-down; do
  mkdir -p "$RUN_DIR/qa-work/${ACTION}/decoded"
  cp "$RUN_DIR/final/${ACTION}.png" "$RUN_DIR/qa-work/${ACTION}/decoded/running-right.png"
  "$PYTHON" "$SKILL_DIR/scripts/extract_strip_frames.py" \
    --decoded-dir "$RUN_DIR/qa-work/${ACTION}/decoded" \
    --output-dir "$RUN_DIR/qa-work/${ACTION}/frames" \
    --states running-right \
    --method stable-slots \
    --chroma-key '#0000FF'
  "$PYTHON" "$SKILL_DIR/scripts/inspect_frames.py" \
    --frames-root "$RUN_DIR/qa-work/${ACTION}/frames" \
    --json-out "$RUN_DIR/qa/${ACTION}-review.json" \
    --states running-right \
    --require-components \
    --allow-stable-slots
done
```

For `eat-normal`, use the six-frame `idle` contract:

```bash
mkdir -p "$RUN_DIR/qa-work/eat-normal/decoded"
cp "$RUN_DIR/final/eat-normal.png" "$RUN_DIR/qa-work/eat-normal/decoded/idle.png"
"$PYTHON" "$SKILL_DIR/scripts/extract_strip_frames.py" \
  --decoded-dir "$RUN_DIR/qa-work/eat-normal/decoded" \
  --output-dir "$RUN_DIR/qa-work/eat-normal/frames" \
  --states idle \
  --method stable-slots \
  --chroma-key '#0000FF'
"$PYTHON" "$SKILL_DIR/scripts/inspect_frames.py" \
  --frames-root "$RUN_DIR/qa-work/eat-normal/frames" \
  --json-out "$RUN_DIR/qa/eat-normal-review.json" \
  --states idle \
  --require-components \
  --allow-stable-slots
```

Every review JSON must contain no errors. Warnings require visual inspection and may not hide clipping, disconnected clothing, identity drift, or cross-slot content.

- [ ] **Step 7: Render five durable loop previews with the official hatch-pet preview functions**

Render all four 8-frame walk previews:

```bash
for ACTION in walk-slow-left walk-slow-right walk-slow-up walk-slow-down; do
  PYTHONPATH="$SKILL_DIR/scripts" "$PYTHON" -c '
  from pathlib import Path
  from render_animation_previews import load_frames, save_preview
  root, output = map(Path, __import__("sys").argv[1:3])
  save_preview(load_frames(root, "running-right", 8), [125] * 8, output)
  ' "$RUN_DIR/qa-work/${ACTION}/frames" "$RUN_DIR/qa/${ACTION}.gif"
done
```

For `eat-normal`:

```bash
PYTHONPATH="$SKILL_DIR/scripts" "$PYTHON" -c '
from pathlib import Path
from render_animation_previews import load_frames, save_preview
root, output = map(Path, __import__("sys").argv[1:3])
save_preview(load_frames(root, "idle", 6), [167] * 6, output)
' "$RUN_DIR/qa-work/eat-normal/frames" "$RUN_DIR/qa/eat-normal.gif"
```

Inspect all five GIFs at normal pet size. Require stable identity, torso, scale and baseline; correct facing; a monotonic gait; seamless last-to-first transition; and no left/right flash.

- [ ] **Step 8: Write the PangYu manifest override and verify RED against old assets**

Add to `characters/uno-pangyu/character.json`:

```json
"animationOverrides": {
  "walk-slow-left": { "frameCount": 8, "fps": 8 },
  "walk-slow-right": { "frameCount": 8, "fps": 8 },
  "walk-slow-up": { "frameCount": 8, "fps": 8 },
  "walk-slow-down": { "frameCount": 8, "fps": 8 },
  "eat-normal": { "frameCount": 6, "fps": 6 }
}
```

Run before installing the new strips:

```bash
pnpm pet:validate uno-pangyu
```

Expected: FAIL for any old strip whose width is not divisible by its new frame count. This proves the package cannot silently retain incompatible 4-frame material.

- [ ] **Step 9: Install only the approved final strips and QA evidence**

Copy the five `$RUN_DIR/final/*.png` files to their exact `characters/uno-pangyu/pet/extended-animations/` destinations. Copy the five GIFs into `characters/uno-pangyu/qa/smooth-animations/`.

Create `characters/uno-pangyu/qa/smooth-animations/validation.json` containing:

```json
{
  "ok": true,
  "identityReference": "../../canonical-base.png",
  "animations": {
    "walk-slow-left": { "frameCount": 8, "fps": 8 },
    "walk-slow-right": { "frameCount": 8, "fps": 8 },
    "walk-slow-up": { "frameCount": 8, "fps": 8 },
    "walk-slow-down": { "frameCount": 8, "fps": 8 },
    "eat-normal": { "frameCount": 6, "fps": 6 }
  },
  "visualQA": {
    "identity": "pass",
    "transparentEdges": "pass",
    "stableScale": "pass",
    "stableBaseline": "pass",
    "loopContinuity": "pass",
    "horizontalFlash": "pass"
  }
}
```

Keep the detailed temporary review and despill JSON in `$RUN_DIR`; only the compact validation record and five previews enter the role package.

- [ ] **Step 10: Pin the approved production package contract**

Update the PangYu entry in the production package test to include the exact `animationOverrides` object. Remove the five replaced files from the legacy “transparent trailing columns” hash map.

Add a test that reads the approved strip headers and asserts the installed geometry against the manifest:

```js
test("ships PangYu's approved smoother animation contract", async () => {
  const pangYu = JSON.parse(await readFile(
    join(packageRoot, "uno-pangyu", "character.json"),
    "utf8",
  ));
  expect(pangYu.animationOverrides).toEqual({
    "walk-slow-left": { frameCount: 8, fps: 8 },
    "walk-slow-right": { frameCount: 8, fps: 8 },
    "walk-slow-up": { frameCount: 8, fps: 8 },
    "walk-slow-down": { frameCount: 8, fps: 8 },
    "eat-normal": { frameCount: 6, fps: 6 },
  });
  await expect(validateCharacterPackage(packageRoot, "uno-pangyu")).resolves.toEqual([]);
});
```

After visual approval, calculate SHA-256 for the five installed files with `shasum -a 256` and store those literal approved hashes in the existing asset pinning test. Do not derive expected hashes from `validation.json` or from the files under test.

- [ ] **Step 11: Run package and runtime tests**

Run:

```bash
pnpm exec vitest run tests/pet/characterPackage.test.js tests/pet/characterRuntime.test.ts tests/pet/animation.test.ts
pnpm pet:validate --all
```

Expected: all tests pass, all three packages validate, and only PangYu reports non-default animation overrides.

- [ ] **Step 12: Commit Task 3**

```bash
git add characters/uno-pangyu/character.json \
  characters/uno-pangyu/pet/extended-animations/walk-slow-left.png \
  characters/uno-pangyu/pet/extended-animations/walk-slow-right.png \
  characters/uno-pangyu/pet/extended-animations/walk-slow-up.png \
  characters/uno-pangyu/pet/extended-animations/walk-slow-down.png \
  characters/uno-pangyu/pet/extended-animations/eat-normal.png \
  characters/uno-pangyu/qa/smooth-animations \
  tests/pet/characterPackage.test.js
git commit -m "feat: smooth PangYu walk and eat animations"
```

---

### Task 4: Cross-character verification and PangYu packaging

**Files:**
- Verify only; modify production files only if a test identifies a real defect.

**Interfaces:**
- Consumes: completed role override contract and approved PangYu assets.
- Produces: one verified PangYu debug application and evidence that UNO/Yan remain unchanged.

- [ ] **Step 1: Run the complete frontend and package suite**

```bash
pnpm test
pnpm pet:validate --all
PET_CHARACTER=uno pnpm frontend:build
PET_CHARACTER=uno-pangyu pnpm frontend:build
PET_CHARACTER=uno-yan pnpm frontend:build
```

Expected: all commands exit zero. The three Vite output hashes may differ because the injected manifests differ.

- [ ] **Step 2: Run Rust verification**

```bash
cargo test --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: every Rust test passes and `cargo check` exits zero.

- [ ] **Step 3: Build the real PangYu debug bundle**

```bash
pnpm pet:build uno-pangyu -- --debug
```

Expected macOS output:

```text
src-tauri/target/debug/bundle/macos/UNO PangYu.app
```

Confirm the bundle contains PangYu's icon and the staged `PET_CHARACTER` is `uno-pangyu`.

- [ ] **Step 4: Perform macOS motion acceptance**

Launch the debug app and force each menu action:

```text
慢走（left） → 慢走（right） → 慢走（up） → 慢走（down） → 吃文件（cancel fake-eat path first）
```

For each walk direction, observe at least three complete eight-frame cycles while the window moves. For eating, observe at least three complete six-frame cycles in the confirmation flow. Accept only when:

- the character keeps PangYu identity and clothing;
- no frame is duplicated as a substitute for a missing gait phase;
- no horizontal flash, scale pop, baseline jump, crop, or frame-slot bleed appears;
- the first/last frame transition is no more abrupt than adjacent transitions;
- the file icon remains app-rendered and absent from the sprite.

- [ ] **Step 5: Inspect final diff and commit only real verification fixes**

```bash
git diff --check
git status --short
git log --oneline -5
```

Expected: no accidental generated directories, `.pet-build` output, temporary prompts, or unrelated role assets are tracked. If verification required no code changes, do not create an empty final commit.
