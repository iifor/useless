# UNO Yan desktop pet verification

Verified from clean commit `4c3fad0` on 2026-08-18. No product-code fix was required.

## Required command evidence

Commands were run in this order from the UNO Yan worktree.

| Command | Exit | Result |
| --- | ---: | --- |
| `pnpm test` | 0 | 10 test files passed; 102 tests passed and 2 skipped. |
| `pnpm build` | 0 | TypeScript project build and Vite production build completed; 51 modules transformed. |
| `cargo test --manifest-path src-tauri/Cargo.toml` | 0 | 41 Rust tests passed; 0 failed, ignored, measured, or filtered out. |
| `cargo check --manifest-path src-tauri/Cargo.toml` | 0 | `uno-yan v0.1.0` completed the dev-profile check. |
| `pnpm tauri build --debug` | 0 | Debug executable and one macOS application bundle were produced. |

The Tauri build also reran the frontend build successfully before compiling the desktop application.

## Product and runtime contract

- `rg -n -i 'pangyu|uno-pangyu' src public src-tauri scripts package.json index.html README.md` returned no matches. The only repository-scope matches outside excluded historical docs/artifacts were negative identity assertions in `tests/release/appIdentity.test.js`.
- `package.json` has no updater dependency, `src-tauri/tauri.conf.json` has no updater endpoint/configuration, the product/runtime search for `updater|releases/latest` returned no matches, and `.github/workflows` does not exist.
- `PetAction`, `PET_POSES`, `ANIMATIONS`, and `MANUAL_ACTIONS` contain no prone, lie, or sleep action. The automatic pool is exactly stand, sit, and slow walk.
- `contentLongEdgeForPose()` returns exactly `119`; the TypeScript suite verifies all runtime poses use that value.
- The runtime has exactly the twelve required extension PNGs plus `public/pet/spritesheet.webp`. The asset contract test verifies every configured path exists and is non-empty, and verifies the removed prone/lie/sleep files are absent.
- `public/pet/spritesheet.webp` and `artifacts/uno-yan-hatch/package/spritesheet.webp` have the same SHA-256: `310f3fc29c02733c754d96a06141bdac6402f09105b75f67f16f0f14f7e5ab84`.
- `artifacts/uno-yan-hatch/package/pet.json` identifies `uno-yan`, displays `UNO Yan`, and uses `spriteVersionNumber: 2`. Standard and extension contact sheets and the deterministic QA JSON remain under `artifacts/uno-yan-hatch/qa/`.
- `git diff --quiet e1f9895 -- src-tauri/src/food_safety.rs` exited 0: the reused `FoodSafety` implementation is unchanged from the PangYu reduced baseline. Rust tests exercised its protected-path, symlink, ownership, replay, replacement, error, and recycle-bin behavior.

## Produced local artifacts

- Debug executable: `src-tauri/target/debug/uno-yan`
- Debug macOS bundle: `src-tauri/target/debug/bundle/macos/UNO Yan.app`
- Bundled executable: `src-tauri/target/debug/bundle/macos/UNO Yan.app/Contents/MacOS/uno-yan`
- Bundled icon: `src-tauri/target/debug/bundle/macos/UNO Yan.app/Contents/Resources/icon.icns`
- Runtime sprites: `public/pet/`
- Hatch and animation QA: `artifacts/uno-yan-hatch/qa/`

The bundle is 31 MB. Its `Info.plist` reports `CFBundleName=UNO Yan`, `CFBundleIdentifier=com.iifor.uno-yan`, and `CFBundleShortVersionString=0.1.0`. Both inspected executables are Mach-O 64-bit arm64.

## Limitations

- This verification did not launch the GUI, exercise desktop permissions, or perform an interactive coexistence check with UNO or UNO PangYu.
- It did not build or run Windows artifacts. Windows behavior is covered only by the existing TypeScript build-script tests and Rust conditional code compilation available to the current target.
- The debug bundle is local arm64 output. It is not a Universal DMG, signed distribution, notarized package, or Windows installer.
