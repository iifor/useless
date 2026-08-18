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
