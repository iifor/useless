import { access, cp, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";

import { afterEach, describe, expect, test, vi } from "vitest";

import * as petBuild from "../../scripts/pet-build.mjs";
import { characterViteSettings, requireCharacterId } from "../../vite.config.ts";

const { prepareCharacterBuild, runPetCommand } = petBuild;

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
    [["UNO"], "无效角色 id"],
    [["missing"], "未知角色"],
  ])("rejects %j before spawning", async (args, message) => {
    const spawn = vi.fn();
    await expect(runPetCommand({ root: process.cwd(), mode: "build", args, spawn }))
      .rejects.toThrow(message);
    expect(spawn).not.toHaveBeenCalled();
  });

  test("selects a character with arrow keys when no id is supplied", async () => {
    expect(petBuild.selectCharacter).toBeTypeOf("function");
    const root = await tempProject();
    const input = new PassThrough();
    const output = new PassThrough();
    input.isTTY = true;
    output.isTTY = true;
    input.isRaw = false;
    input.setRawMode = vi.fn((value) => { input.isRaw = value; });
    const selected = petBuild.selectCharacter(root, { input, output });

    input.write("\x1b[B");
    input.write("\r");

    await expect(selected).resolves.toBe("uno-pangyu");
    expect(input.setRawMode).toHaveBeenNthCalledWith(1, true);
    expect(input.setRawMode).toHaveBeenLastCalledWith(false);
  });

  test("uses the interactive selection before spawning when the id is omitted", async () => {
    const root = await tempProject();
    const spawn = vi.fn().mockResolvedValue(undefined);
    await runPetCommand({
      root,
      mode: "dev",
      args: [],
      select: async () => "uno-yan",
      spawn,
    });

    expect(spawn).toHaveBeenCalledWith(
      process.execPath,
      [join(root, "node_modules/@tauri-apps/cli/tauri.js"), "dev", "--config", expect.any(String)],
      expect.objectContaining({ env: expect.objectContaining({ PET_CHARACTER: "uno-yan" }) }),
    );
  });

  test("injects the exact selected manifest and staged public directory", async () => {
    const root = await tempProject();
    const prepared = await prepareCharacterBuild(root, "uno-pangyu");
    const marker = join(prepared.stageDir, "tauri-is-reading-this-file");
    await writeFile(marker, "keep");
    const settings = await characterViteSettings(root, "uno-pangyu");
    expect(settings.manifest).toEqual(JSON.parse(await readFile(
      join(root, "characters/uno-pangyu/character.json"), "utf8",
    )));
    expect(settings.publicDir).toBe(join(root, ".pet-build/uno-pangyu/public"));
    await expect(readFile(marker, "utf8")).resolves.toBe("keep");
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

  test("stages assets only from the selected character package", async () => {
    const legacyPetFiles = await readdir("public/pet")
      .catch((error) => error.code === "ENOENT" ? [] : Promise.reject(error));
    expect(legacyPetFiles.filter((name) => name !== ".DS_Store")).toEqual([]);
    await expect(access("artifacts")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readdir("src-tauri/icons")).resolves.toEqual(["icon.png"]);

    const root = await tempProject();
    const prepared = await prepareCharacterBuild(root, "uno-pangyu");
    await expect(readFile(join(prepared.publicDir, "pet/spritesheet.webp")))
      .resolves.toEqual(await readFile("characters/uno-pangyu/pet/spritesheet.webp"));
    await expect(readFile(join(prepared.iconsDir, "icon.icns")))
      .resolves.toEqual(await readFile("characters/uno-pangyu/icons/icon.icns"));
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
    expect(config.bundle).not.toHaveProperty("targets");
    expect(config).not.toHaveProperty("build");
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

  test("provides Windows NSIS identity through Tauri without a custom publisher", async () => {
    const root = await tempProject();
    const prepared = await prepareCharacterBuild(root, "uno-pangyu");
    const config = JSON.parse(await readFile(prepared.tauriConfigPath, "utf8"));
    expect(config).toMatchObject({
      productName: "UNO PangYu",
      version: "0.1.0",
      identifier: "com.iifor.uno-pangyu",
      bundle: { icon: Object.values(prepared.iconPaths) },
    });
    await expect(readFile("scripts/build-windows.mjs", "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  test("routes friendly commands through selection without recursive frontend hooks", async () => {
    const pkg = JSON.parse(await readFile("package.json", "utf8"));
    expect(pkg.scripts).toMatchObject({
      "dev": "node scripts/pet-build.mjs dev",
      "build": "node scripts/pet-build.mjs build",
      "pet:dev": "node scripts/pet-build.mjs dev",
      "pet:build": "node scripts/pet-build.mjs build",
      "frontend:dev": "vite --port 1420",
      "frontend:build": "tsc -b && vite build",
    });
    const tauri = JSON.parse(await readFile("src-tauri/tauri.conf.json", "utf8"));
    expect(tauri.build).toMatchObject({
      beforeDevCommand: "pnpm frontend:dev",
      beforeBuildCommand: "pnpm frontend:build",
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
