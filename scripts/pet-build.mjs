import { spawn as spawnChild } from "node:child_process";
import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { validateCharacterPackage } from "./pet-validate.mjs";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const validId = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export async function loadCharacter(root, id) {
  if (!id) throw new Error("用法: pnpm pet:dev <id> 或 pnpm pet:build <id> -- <tauri args>");
  if (!validId.test(id)) throw new Error(`无效角色 id: ${id}`);
  const charactersRoot = join(root, "characters");
  const packageRoot = join(charactersRoot, id);
  try {
    if (!(await stat(packageRoot)).isDirectory()) throw new Error();
  } catch {
    throw new Error(`未知角色: ${id}`);
  }
  const errors = await validateCharacterPackage(charactersRoot, id);
  if (errors.length) throw new Error(`角色包无效: ${id}\n${errors.join("\n")}`);
  return JSON.parse(await readFile(join(packageRoot, "character.json"), "utf8"));
}

export async function prepareCharacterBuild(root, id) {
  const manifest = await loadCharacter(root, id);
  const packageRoot = join(root, "characters", id);
  const { stageDir, publicDir } = buildPaths(root, id);

  await rm(stageDir, { recursive: true, force: true });
  const iconsDir = join(stageDir, "icons");
  await copyPet(packageRoot, publicDir);
  await cp(join(packageRoot, "icons"), iconsDir, { recursive: true });

  const infoPlistPath = join(stageDir, "Info.plist");
  const tauriConfigPath = join(stageDir, "tauri.conf.json");
  const iconPaths = {
    png: join(iconsDir, "icon.png"),
    icns: join(iconsDir, "icon.icns"),
    ico: join(iconsDir, "icon.ico"),
  };
  await writeFile(infoPlistPath, infoPlist(manifest.displayName));
  const base = JSON.parse(await readFile(join(root, "src-tauri", "tauri.conf.json"), "utf8"));
  await writeFile(tauriConfigPath, `${JSON.stringify({
    productName: manifest.displayName,
    version: manifest.version,
    identifier: manifest.bundleId,
    app: {
      windows: base.app.windows.map((window) => ({
        ...window,
        title: window.label === "seat-target"
          ? `${manifest.displayName} 座位目标`
          : manifest.displayName,
      })),
    },
    bundle: {
      icon: Object.values(iconPaths),
      macOS: { infoPlist: infoPlistPath },
    },
  }, null, 2)}\n`);

  return { manifest, stageDir, publicDir, iconsDir, infoPlistPath, tauriConfigPath, iconPaths };
}

export async function stageCharacterPublic(root, id) {
  const manifest = await loadCharacter(root, id);
  const { stageDir, publicDir } = buildPaths(root, id);
  await rm(publicDir, { recursive: true, force: true });
  await copyPet(join(root, "characters", id), publicDir);
  return { manifest, stageDir, publicDir };
}

export async function runPetCommand({ root = projectRoot, mode, args, spawn = spawnInherited } = {}) {
  if (mode !== "dev" && mode !== "build") throw new Error(`未知命令: ${mode}`);
  const [id, separator, ...rest] = args ?? [];
  const forwarded = separator === "--" ? rest : args?.slice(1) ?? [];
  const prepared = await prepareCharacterBuild(root, id);
  const tauriCli = join(root, "node_modules", "@tauri-apps", "cli", "tauri.js");
  return spawn(process.execPath, [tauriCli, mode, "--config", prepared.tauriConfigPath, ...forwarded], {
    cwd: root,
    env: { ...process.env, PET_CHARACTER: id },
    stdio: "inherit",
  });
}

function spawnInherited(command, args, options) {
  return new Promise((resolvePromise, reject) => {
    const child = spawnChild(command, args, options);
    child.on("error", reject);
    child.on("close", (code) => code === 0
      ? resolvePromise()
      : reject(new Error(`${command} exited with code ${code}`)));
  });
}

function buildPaths(root, id) {
  const stageRoot = resolve(root, ".pet-build");
  const stageDir = resolve(stageRoot, id);
  if (dirname(stageDir) !== stageRoot) throw new Error(`不安全的构建目录: ${stageDir}`);
  return { stageDir, publicDir: join(stageDir, "public") };
}

async function copyPet(packageRoot, publicDir) {
  await mkdir(publicDir, { recursive: true });
  await cp(join(packageRoot, "pet"), join(publicDir, "pet"), { recursive: true });
}

function infoPlist(displayName) {
  const escaped = displayName
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>NSAppleEventsUsageDescription</key>
  <string>${escaped} 仅在寻找桌面座位时读取 Finder 中桌面图标的位置。</string>
</dict>
</plist>
`;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const [mode, ...args] = process.argv.slice(2);
  runPetCommand({ mode, args }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
