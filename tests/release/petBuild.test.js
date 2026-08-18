import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test, vi } from "vitest";

import {
  expectedWindowsArtifacts,
  loadCharacter,
  prepareCharacterBuild,
  runPetCommand,
} from "../../scripts/pet-build.mjs";
import { characterViteSettings, requireCharacterId } from "../../vite.config.ts";

const roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function tempProject() {
  const root = await mkdtemp(join(tmpdir(), "pet-build-"));
  roots.push(root);
  await cp("characters", join(root, "characters"), { recursive: true });
  await mkdir(join(root, "src-tauri"), { recursive: true });
  await cp("src-tauri/tauri.conf.json", join(root, "src-tauri/tauri.conf.json"));
  return root;
}

describe("character-selected build", () => {
  test("requires explicit selection for Vite", () => {
    expect(() => requireCharacterId({})).toThrow("缺少 PET_CHARACTER");
    expect(requireCharacterId({ PET_CHARACTER: "uno" })).toBe("uno");
  });

  test.each([
    [[], "用法"],
    [["UNO"], "无效角色 id"],
    [["missing"], "未知角色"],
  ])("rejects %j before spawning", async (args, message) => {
    const spawn = vi.fn();
    await expect(runPetCommand({ root: process.cwd(), mode: "build", args, spawn }))
      .rejects.toThrow(message);
    expect(spawn).not.toHaveBeenCalled();
  });

  test("injects the exact selected manifest and staged public directory", async () => {
    const root = await tempProject();
    const settings = await characterViteSettings(root, "uno-pangyu");
    expect(settings.manifest).toEqual(JSON.parse(await readFile(
      join(root, "characters/uno-pangyu/character.json"), "utf8",
    )));
    expect(settings.publicDir).toBe(join(root, ".pet-build/uno-pangyu/public"));
  });

  test("recreates only the selected stage without cross-character leakage", async () => {
    const root = await tempProject();
    const stale = join(root, ".pet-build/uno/icons/from-old-role.ico");
    const other = join(root, ".pet-build/uno-yan/keep.txt");
    await mkdir(join(stale, ".."), { recursive: true });
    await mkdir(join(other, ".."), { recursive: true });
    await writeFile(stale, "stale");
    await writeFile(other, "keep");

    const prepared = await prepareCharacterBuild(root, "uno");

    await expect(readFile(stale)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(other, "utf8")).resolves.toBe("keep");
    await expect(readFile(join(prepared.publicDir, "pet/spritesheet.webp"))).resolves.toBeTruthy();
    await expect(readFile(join(prepared.iconsDir, "icon.ico"))).resolves.toBeTruthy();
    await expect(readFile(join(prepared.stageDir, "canonical-base.png"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(join(prepared.stageDir, "qa/validation.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  test.each([
    ["uno", "UNO", "0.1.2", "com.blackshirt.companion"],
    ["uno-pangyu", "UNO PangYu", "0.1.0", "com.iifor.uno-pangyu"],
    ["uno-yan", "UNO Yan", "0.1.0", "com.iifor.uno-yan"],
  ])("generates isolated identity for %s", async (id, displayName, version, bundleId) => {
    const root = await tempProject();
    const prepared = await prepareCharacterBuild(root, id);
    const config = JSON.parse(await readFile(prepared.tauriConfigPath, "utf8"));
    const info = await readFile(prepared.infoPlistPath, "utf8");

    expect(config).toMatchObject({
      productName: displayName,
      version,
      identifier: bundleId,
      app: { windows: [
        { label: "main", title: displayName },
        { label: "seat-target", title: `${displayName} 座位目标` },
      ] },
    });
    expect(config.bundle.icon).toEqual([
      prepared.iconPaths.png,
      prepared.iconPaths.icns,
      prepared.iconPaths.ico,
    ]);
    expect(config.bundle.macOS.infoPlist).toBe(prepared.infoPlistPath);
    expect(info).toContain(`${displayName} 仅在寻找桌面座位时读取 Finder 中桌面图标的位置。`);
    expect(JSON.stringify(config)).not.toMatch(/updater|releases\/latest/i);
  });

  test.each([
    ["build", ["uno-yan", "--", "--debug"], ["build", "--config", expect.stringContaining("uno-yan/tauri.conf.json"), "--debug"]],
    ["build", ["uno", "--", "--bundles", "dmg", "--no-sign"], ["build", "--config", expect.any(String), "--bundles", "dmg", "--no-sign"]],
    ["build", ["uno-pangyu", "--", "--target", "x86_64-pc-windows-msvc", "--bundles", "nsis", "--no-sign"], ["build", "--config", expect.any(String), "--target", "x86_64-pc-windows-msvc", "--bundles", "nsis", "--no-sign"]],
    ["dev", ["uno-yan"], ["dev", "--config", expect.any(String)]],
  ])("forwards %s arguments unchanged", async (mode, args, expected) => {
    const root = await tempProject();
    const spawn = vi.fn().mockResolvedValue(undefined);
    await runPetCommand({ root, mode, args, spawn });
    expect(spawn).toHaveBeenCalledWith(
      process.execPath,
      [join(root, "node_modules/@tauri-apps/cli/tauri.js"), ...expected],
      expect.objectContaining({
        cwd: root,
        env: expect.objectContaining({ PET_CHARACTER: args[0] }),
        stdio: "inherit",
      }),
    );
  });

  test("derives Windows artifact names from the role product", async () => {
    expect(expectedWindowsArtifacts(await loadCharacter(process.cwd(), "uno-pangyu"))).toEqual({
      application: "UNO PangYu.exe",
      installer: "UNO PangYu_0.1.0_x64-setup.exe",
    });
  });

  test("exposes only the selected-character commands and keeps engine code role-neutral", async () => {
    const pkg = JSON.parse(await readFile("package.json", "utf8"));
    expect(pkg.scripts).toMatchObject({
      "pet:dev": "node scripts/pet-build.mjs dev",
      "pet:build": "node scripts/pet-build.mjs build",
    });
    for (const legacy of ["dmg", "exe", "tauri:build", "build:windows", "dev:windows"]) {
      expect(pkg.scripts).not.toHaveProperty(legacy);
    }
    const engine = await Promise.all([
      readFile("scripts/pet-build.mjs", "utf8"),
      readFile("src-tauri/src/main.rs", "utf8"),
      readFile("src-tauri/src/instance_position.rs", "utf8"),
    ]);
    expect(engine.join("\n")).not.toMatch(/UNO|Yan|PangYu/);
  });
});
