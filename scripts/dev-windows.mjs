import { spawn } from "node:child_process";
import { arch, platform as hostPlatform } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  RUST_TOOLCHAIN,
  WINDOWS_TARGET,
  findVisualStudioDeveloperCommand,
} from "./build-windows.mjs";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

export function buildWindowsDevCommand(vsDevCommand) {
  return [
    `call "${vsDevCommand}" -no_logo -arch=x64`,
    `set "RUSTUP_TOOLCHAIN=${RUST_TOOLCHAIN}"`,
    `pnpm exec tauri dev --target ${WINDOWS_TARGET}`,
  ].join(" && ");
}

function spawnInherited(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, shell: false });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

export async function runWindowsDev({
  root = projectRoot,
  platform = hostPlatform(),
  architecture = arch(),
  findVsDev = findVisualStudioDeveloperCommand,
  runCommand = spawnInherited,
} = {}) {
  if (platform !== "win32") throw new Error("pnpm dev:windows 仅支持 Windows");
  if (architecture !== "x64") throw new Error(`仅支持 Windows x64，当前架构：${architecture}`);
  const vsDevCommand = await findVsDev();
  await runCommand("cmd.exe", ["/d", "/s", "/c", buildWindowsDevCommand(vsDevCommand)], {
    cwd: root,
    stdio: "inherit",
    windowsVerbatimArguments: true,
  });
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  runWindowsDev().catch((error) => {
    console.error(`Windows 开发环境启动失败：${error.message}`);
    process.exitCode = 1;
  });
}
