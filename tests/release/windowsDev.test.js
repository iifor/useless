import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import {
  buildWindowsDevCommand,
  runWindowsDev,
} from "../../scripts/dev-windows.mjs";

const temporaryDirectories = [];
const windowsTest = process.platform === "win32" ? test : test.skip;

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) =>
    rm(path, { recursive: true, force: true })));
});

async function temporaryRoot() {
  const root = await mkdtemp(join(tmpdir(), "uno-windows-dev-"));
  temporaryDirectories.push(root);
  return root;
}

function runProcess(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options);
    child.on("error", reject);
    child.on("close", (code) => code === 0
      ? resolve()
      : reject(new Error(`${command} exited with code ${code}`)));
  });
}

describe("Windows local development", () => {
  test("pins Rust 1.86 MSVC and starts Tauri dev for the x64 MSVC target", () => {
    expect(buildWindowsDevCommand("C:\\VS Tools\\VsDevCmd.bat")).toBe(
      'call "C:\\VS Tools\\VsDevCmd.bat" -no_logo -arch=x64'
      + ' && set "RUSTUP_TOOLCHAIN=1.86.0-x86_64-pc-windows-msvc"'
      + ' && pnpm exec tauri dev --target x86_64-pc-windows-msvc',
    );
  });

  test("runs cmd.exe in the project root with inherited stdio", async () => {
    const calls = [];
    await runWindowsDev({
      root: "C:\\project",
      platform: "win32",
      architecture: "x64",
      findVsDev: async () => "C:\\VS\\VsDevCmd.bat",
      runCommand: async (...args) => { calls.push(args); },
    });

    expect(calls).toEqual([[
      "cmd.exe",
      ["/d", "/s", "/c", 'call "C:\\VS\\VsDevCmd.bat" -no_logo -arch=x64'
        + ' && set "RUSTUP_TOOLCHAIN=1.86.0-x86_64-pc-windows-msvc"'
        + ' && pnpm exec tauri dev --target x86_64-pc-windows-msvc'],
      {
        cwd: "C:\\project",
        stdio: "inherit",
        windowsVerbatimArguments: true,
      },
    ]]);
  });

  test("rejects unsupported hosts before Visual Studio discovery", async () => {
    let discovered = false;
    const findVsDev = async () => { discovered = true; return "unused"; };
    await expect(runWindowsDev({ platform: "linux", findVsDev }))
      .rejects.toThrow("仅支持 Windows");
    await expect(runWindowsDev({ platform: "win32", architecture: "arm64", findVsDev }))
      .rejects.toThrow("仅支持 Windows x64");
    expect(discovered).toBe(false);
  });

  test("propagates a nonzero development process failure", async () => {
    await expect(runWindowsDev({
      platform: "win32",
      architecture: "x64",
      findVsDev: async () => "C:\\VS\\VsDevCmd.bat",
      runCommand: async () => { throw new Error("cmd.exe exited with code 101"); },
    })).rejects.toThrow("code 101");
  });

  windowsTest("executes a developer batch path containing spaces and parentheses", async () => {
    const root = await temporaryRoot();
    const tools = join(root, "Visual Studio Tools (x86)");
    const bin = join(root, "fake bin");
    await mkdir(tools, { recursive: true });
    await mkdir(bin, { recursive: true });
    const vsDevCommand = join(tools, "VsDevCmd.bat");
    await writeFile(vsDevCommand, "@echo off\r\nexit /b 0\r\n");
    await writeFile(join(bin, "pnpm.cmd"), "@echo off\r\nexit /b 0\r\n");
    const environment = { ...process.env };
    const pathKey = Object.keys(environment).find((key) => key.toLowerCase() === "path") ?? "Path";
    environment[pathKey] = `${bin}${delimiter}${environment[pathKey] ?? ""}`;

    await expect(runWindowsDev({
      root,
      platform: "win32",
      architecture: "x64",
      findVsDev: async () => vsDevCommand,
      runCommand: (command, args, options) =>
        runProcess(command, args, { ...options, stdio: "ignore", env: environment }),
    })).resolves.toBeUndefined();
  });

  test("exposes the public package command", async () => {
    const packageJson = JSON.parse(await readFile(
      new URL("../../package.json", import.meta.url),
      "utf8",
    ));
    expect(packageJson.scripts["dev:windows"]).toBe("node scripts/dev-windows.mjs");
  });
});
