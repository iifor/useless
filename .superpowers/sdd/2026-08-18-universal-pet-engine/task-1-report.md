# Task 1 — Character package contract report

## RED evidence

Command: `pnpm vitest run tests/pet/characterPackage.test.js`

Result: failed as expected because `../../scripts/pet-validate.mjs` did not exist.

## GREEN evidence

Command: `pnpm vitest run tests/pet/characterPackage.test.js`

Result: 20 tests passed. The tests use temporary package directories and cover full/reduced manifests, identity/list validation, core and capability assets, disabled capabilities, PNG header checks, unknown IDs, and `--all` aggregation.

## Changed files

- `src/pet/characterManifest.ts` — shared manifest contract.
- `scripts/pet-validate.mjs` — exported validator and `pet:validate` CLI.
- `tests/pet/characterPackage.test.js` — focused temporary-directory tests.
- `package.json` — `pet:validate` command.

## Verification

- `pnpm test` — 122 passed, 2 skipped.
- `pnpm build` — passed.

## Commits

- `17b79cd feat: validate character packages`
- This report is committed separately as Task 1 evidence.

## Concerns

None.

## Fix round 1 — PNG IHDR and contract regressions

The original RED section above is retained as the bootstrap import failure: the validator module did not yet exist. This fix round used a separate assertion-based RED test against the existing validator.

### Assertion RED evidence

Command: `pnpm vitest run tests/pet/characterPackage.test.js`

Exit: `1`

Relevant output:

```text
× character packages > rejects a strip with invalid PNG IHDR length
  → expected [] to deeply equal ArrayContaining{…}

- ArrayContaining [
-   StringContaining "IHDR length must be 13",
- ]
+ []

Test Files  1 failed (1)
Tests  1 failed | 23 passed (24)
EXIT_CODE=1
```

The new missing-`idle-stand`, optional-idle-strip, and zero-dimension tests passed in RED because those contract checks already existed; no production change was required for them.

### GREEN evidence

Command: `pnpm vitest run tests/pet/characterPackage.test.js`

Exit: `0`

Result: 24 tests passed after rejecting non-13-byte IHDR chunk lengths before fixed-offset reads.

### Fix-round verification

- `pnpm test` — 126 passed, 2 skipped.
- `pnpm build` — passed.

### Fix-round changes

- `tests/pet/characterPackage.test.js` — malformed IHDR-length, missing `idle-stand`, missing optional idle strip, and zero-dimension regression coverage.
- `scripts/pet-validate.mjs` — exact IHDR length validation and unused import removal.

### Fix-round commit

- `7b1efac fix: validate PNG IHDR length`
- This appended fix evidence is committed separately.

## Fix round 2 — Nested animation-strip layout

The approved package layout requires every strip at `characters/<id>/pet/extended-animations/<strip>.png`. `pet/spritesheet.webp` remains at the pet root and icons remain unchanged.

### Assertion RED evidence

Command: `pnpm vitest run tests/pet/characterPackage.test.js -t "requires strips under pet/extended-animations"`

Exit: `1`

Relevant output:

```text
× character packages > requires strips under pet/extended-animations
  → expected [] to deeply equal ArrayContaining{…}

- ArrayContaining [
-   StringContaining "pet/extended-animations/walk-slow-left.png: missing",
- ]
+ []

Test Files  1 failed (1)
Tests  1 failed | 24 skipped (25)
EXIT_CODE=1
```

The flat package was accepted before the change, which is the intended regression signal.

### GREEN evidence

Command: `pnpm vitest run tests/pet/characterPackage.test.js`

Exit: `0`

Result: 25 tests passed. The new path regression rejects flat strips and accepts nested strips.

### Fix-round verification

- `pnpm test` — 127 passed, 2 skipped.
- `pnpm build` — passed.

### Fix-round changes

- `tests/pet/characterPackage.test.js` — nested temporary strip fixtures, nested path assertions, and flat-versus-nested regression coverage.
- `scripts/pet-validate.mjs` — strips resolve only from `pet/extended-animations`.

### Fix-round commit

- `7ee4e12 fix: nest character animation strips`
- This appended fix evidence is committed separately.
