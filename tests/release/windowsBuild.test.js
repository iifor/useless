import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rename as renameFile, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import {
  RUST_TOOLCHAIN,
  WINDOWS_TARGET,
  buildDeveloperCommand,
  findVisualStudioDeveloperCommand,
  publishArtifacts,
  resolveBuildArtifacts,
  runWindowsBuild,
  snapshotInstallerCandidates,
} from "../../scripts/build-windows.mjs";

const temporaryDirectories = [];
const windowsTest = process.platform === "win32" ? test : test.skip;

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(temporaryDirectories.splice(0).map((path) =>
    rm(path, { recursive: true, force: true })));
});

async function temporaryRoot() {
  const root = await mkdtemp(join(tmpdir(), "uno-windows-build-"));
  temporaryDirectories.push(root);
  return root;
}

function runProcess(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options);
    let output = "";
    let errorOutput = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { errorOutput += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(output);
      else reject(new Error(`${command} exited with code ${code}: ${errorOutput || output}`));
    });
  });
}

describe("Windows local build", () => {
  test("pins Rust 1.86 MSVC and builds an unsigned x64 NSIS bundle", () => {
    const command = buildDeveloperCommand("C:\\VS\\VsDevCmd.bat");
    expect(RUST_TOOLCHAIN).toBe("1.86.0-x86_64-pc-windows-msvc");
    expect(WINDOWS_TARGET).toBe("x86_64-pc-windows-msvc");
    expect(command).toContain('call "C:\\VS\\VsDevCmd.bat" -no_logo -arch=x64');
    expect(command).toContain('set "RUSTUP_TOOLCHAIN=1.86.0-x86_64-pc-windows-msvc"');
    expect(command).toContain("pnpm exec tauri build --target x86_64-pc-windows-msvc --bundles nsis --no-sign");
  });

  test("rejects non-Windows hosts before running commands", async () => {
    await expect(runWindowsBuild({ platform: "linux", runCommand: async () => "" }))
      .rejects.toThrow("仅支持 Windows");
  });

  test("reports missing build outputs", async () => {
    const root = await temporaryRoot();
    await expect(resolveBuildArtifacts(root)).rejects.toThrow("未找到 Tauri 应用程序");
  });

  test("rejects non-file NSIS candidates", async () => {
    const root = await temporaryRoot();
    const release = join(root, "src-tauri", "target", WINDOWS_TARGET, "release");
    await mkdir(join(release, "bundle", "nsis", "invalid-setup.exe"), { recursive: true });
    await writeFile(join(release, "uno-pangyu.exe"), "app");

    await expect(resolveBuildArtifacts(root)).rejects.toThrow("未找到 NSIS 安装包");
  });

  test("uses the first accessible Visual Studio command in discovery order", async () => {
    const x86Root = "C:\\Program Files (x86)";
    const programFilesRoot = "C:\\Program Files";
    const accessed = [];
    const selected = join(x86Root, "Microsoft Visual Studio", "2022", "Community",
      "Common7", "Tools", "VsDevCmd.bat");

    await expect(findVisualStudioDeveloperCommand({
      environment: { "ProgramFiles(x86)": x86Root, ProgramFiles: programFilesRoot },
      canAccess: async (path) => {
        accessed.push(path);
        if (path !== selected) throw new Error("missing");
      },
    })).resolves.toBe(selected);

    expect(accessed).toEqual([
      join(x86Root, "Microsoft Visual Studio", "2022", "BuildTools", "Common7", "Tools", "VsDevCmd.bat"),
      selected,
    ]);
  });

  test("runs prerequisites, build, resolution, and publication in order", async () => {
    const root = "/project";
    const calls = [];
    const artifacts = [{ name: "UNO-PangYu.exe" }];

    await expect(runWindowsBuild({
      root,
      platform: "win32",
      architecture: "x64",
      runCommand: async (...args) => { calls.push(["runCommand", ...args]); return ""; },
      findVsDev: async () => { calls.push(["findVsDev"]); return "C:\\VS\\VsDevCmd.bat"; },
      resolveArtifacts: async (path) => {
        calls.push(["resolveArtifacts", path]);
        return { application: "/built/app.exe", installer: "/built/setup.exe" };
      },
      publish: async (options) => { calls.push(["publish", options]); return artifacts; },
    })).resolves.toBe(artifacts);

    expect(calls).toEqual([
      ["runCommand", "rustc", ["+1.86.0-x86_64-pc-windows-msvc", "--version"], { cwd: root }],
      ["findVsDev"],
      ["runCommand", "cmd.exe", ["/d", "/s", "/c", 'call "C:\\VS\\VsDevCmd.bat" -no_logo -arch=x64 && set "RUSTUP_TOOLCHAIN=1.86.0-x86_64-pc-windows-msvc" && pnpm exec tauri build --target x86_64-pc-windows-msvc --bundles nsis --no-sign'], {
        cwd: root,
        windowsVerbatimArguments: true,
      }],
      ["resolveArtifacts", root],
      ["publish", {
        application: "/built/app.exe",
        installer: "/built/setup.exe",
        releaseDirectory: join(root, "release"),
      }],
    ]);
  });

  test("publishes only the installer changed by the current build when stale versions exist", async () => {
    const root = await temporaryRoot();
    const release = join(root, "src-tauri", "target", WINDOWS_TARGET, "release");
    const nsis = join(release, "bundle", "nsis");
    const currentInstaller = join(nsis, "uno-pangyu_1.0.0_x64-setup.exe");
    const staleInstaller = join(nsis, "uno-pangyu_9.0.0_x64-setup.exe");
    await mkdir(nsis, { recursive: true });
    await writeFile(join(release, "uno-pangyu.exe"), "portable");
    await writeFile(currentInstaller, "old current installer");
    await utimes(currentInstaller, 1, 1);
    await writeFile(staleInstaller, "stale future installer");
    let publishedInstaller;

    await runWindowsBuild({
      root,
      platform: "win32",
      architecture: "x64",
      runCommand: async (command) => {
        if (command === "cmd.exe") {
          await writeFile(currentInstaller, "new current installer");
          await utimes(currentInstaller, 2, 2);
        }
        return "";
      },
      findVsDev: async () => "C:\\VS\\VsDevCmd.bat",
      publish: async ({ installer }) => {
        publishedInstaller = installer;
        return [];
      },
    });

    expect(publishedInstaller).toBe(currentInstaller);
  });

  test("detects a same-path same-size rewrite even when all file metadata is unchanged", async () => {
    const root = await temporaryRoot();
    const release = join(root, "src-tauri", "target", WINDOWS_TARGET, "release");
    const nsis = join(release, "bundle", "nsis");
    const application = join(release, "uno-pangyu.exe");
    const installer = join(nsis, "uno-pangyu_1.0.0_x64-setup.exe");
    await mkdir(nsis, { recursive: true });
    await writeFile(application, "portable");
    await writeFile(installer, "WXYZ");
    const details = await stat(installer);
    const installersBeforeBuild = new Map([[installer, {
      size: details.size,
      mtimeMs: details.mtimeMs,
      ctimeMs: details.ctimeMs,
      birthtimeMs: details.birthtimeMs,
      ino: details.ino,
      sha256: createHash("sha256").update("ABCD").digest("hex"),
    }]]);

    await expect(resolveBuildArtifacts(root, installersBeforeBuild)).resolves.toEqual({
      application,
      installer,
    });
  });

  test("aborts before running the build when the installer directory snapshot is denied", async () => {
    const root = await temporaryRoot();
    const denied = Object.assign(new Error("snapshot directory denied"), { code: "EACCES" });
    let commandRuns = 0;
    let published = false;

    await expect(runWindowsBuild({
      root,
      platform: "win32",
      architecture: "x64",
      snapshotInstallers: (path) => snapshotInstallerCandidates(path, {
        fileSystem: { readdir: async () => { throw denied; } },
      }),
      runCommand: async () => { commandRuns += 1; return ""; },
      findVsDev: async () => "C:\\VS\\VsDevCmd.bat",
      publish: async () => { published = true; return []; },
    })).rejects.toThrow("snapshot directory denied");

    expect(commandRuns).toBe(0);
    expect(published).toBe(false);
  });

  test("propagates a candidate stat error instead of treating it as a missing installer", async () => {
    const root = await temporaryRoot();
    const denied = Object.assign(new Error("snapshot file denied"), { code: "EACCES" });

    await expect(snapshotInstallerCandidates(root, {
      fileSystem: {
        readdir: async () => ["uno-pangyu_1.0.0_x64-setup.exe"],
        stat: async () => { throw denied; },
      },
    })).rejects.toThrow("snapshot file denied");
  });

  test("propagates a candidate hash read error instead of ignoring the installer", async () => {
    const root = await temporaryRoot();
    const denied = Object.assign(new Error("snapshot hash denied"), { code: "EACCES" });

    await expect(snapshotInstallerCandidates(root, {
      fileSystem: {
        readdir: async () => ["uno-pangyu_1.0.0_x64-setup.exe"],
        stat: async () => ({
          isFile: () => true,
          size: 4,
          mtimeMs: 1,
          ctimeMs: 1,
          birthtimeMs: 1,
          ino: 1,
        }),
        open: async () => { throw denied; },
      },
    })).rejects.toThrow("snapshot hash denied");
  });

  test("rejects a build resolution when no installer was created or changed", async () => {
    const root = await temporaryRoot();
    const release = join(root, "src-tauri", "target", WINDOWS_TARGET, "release");
    const nsis = join(release, "bundle", "nsis");
    await mkdir(nsis, { recursive: true });
    await writeFile(join(release, "uno-pangyu.exe"), "portable");
    await writeFile(join(nsis, "uno-pangyu_1.0.0_x64-setup.exe"), "unchanged installer");
    const installersBeforeBuild = await snapshotInstallerCandidates(root);

    await expect(resolveBuildArtifacts(root, installersBeforeBuild))
      .rejects.toThrow("本次构建未产生新的或变更的 NSIS 安装包");
  });

  test("rejects a build that creates or modifies more than one installer", async () => {
    const root = await temporaryRoot();
    const release = join(root, "src-tauri", "target", WINDOWS_TARGET, "release");
    const nsis = join(release, "bundle", "nsis");
    await mkdir(nsis, { recursive: true });
    await writeFile(join(release, "uno-pangyu.exe"), "portable");
    const firstInstaller = join(nsis, "uno-pangyu_1.0.0_x64-setup.exe");
    const secondInstaller = join(nsis, "uno-pangyu_2.0.0_x64-setup.exe");
    await writeFile(firstInstaller, "old installer one");
    await writeFile(secondInstaller, "old installer two");

    await expect(runWindowsBuild({
      root,
      platform: "win32",
      architecture: "x64",
      runCommand: async (command) => {
        if (command === "cmd.exe") {
          await writeFile(firstInstaller, "new installer one");
          await writeFile(secondInstaller, "new installer two");
        }
        return "";
      },
      findVsDev: async () => "C:\\VS\\VsDevCmd.bat",
      publish: async () => [],
    })).rejects.toThrow("本次构建产生了多个 NSIS 安装包");
  });

  windowsTest("executes a developer batch path containing spaces through cmd.exe", async () => {
    const root = await temporaryRoot();
    const toolsDirectory = join(root, "Visual Studio Tools");
    const binDirectory = join(root, "fake bin");
    await mkdir(toolsDirectory, { recursive: true });
    await mkdir(binDirectory, { recursive: true });
    const developerCommand = join(toolsDirectory, "VsDevCmd.bat");
    await writeFile(developerCommand, "@echo off\r\nexit /b 0\r\n");
    await writeFile(join(binDirectory, "pnpm.cmd"), "@echo off\r\nexit /b 0\r\n");
    const environment = { ...process.env };
    const pathKey = Object.keys(environment).find((key) => key.toLowerCase() === "path") ?? "Path";
    environment[pathKey] = `${binDirectory}${delimiter}${environment[pathKey] ?? ""}`;
    const published = [{ name: "UNO-PangYu.exe" }];

    await expect(runWindowsBuild({
      root,
      platform: "win32",
      architecture: "x64",
      runCommand: async (command, args, options) => {
        if (command === "rustc") return "";
        return runProcess(command, args, { ...options, env: environment });
      },
      findVsDev: async () => developerCommand,
      resolveArtifacts: async () => ({
        application: join(root, "built-app.exe"),
        installer: join(root, "built-setup.exe"),
      }),
      publish: async () => published,
    })).resolves.toBe(published);
  });

  test("publishes both stable artifacts together", async () => {
    const root = await temporaryRoot();
    const source = join(root, "source");
    const release = join(root, "release");
    await mkdir(source, { recursive: true });
    const application = join(source, "app.exe");
    const installer = join(source, "setup.exe");
    await writeFile(application, "new portable");
    await writeFile(installer, "new installer");

    const result = await publishArtifacts({ application, installer, releaseDirectory: release });

    expect(await readFile(join(release, "UNO-PangYu.exe"), "utf8")).toBe("new portable");
    expect(await readFile(join(release, "UNO-PangYu-Setup.exe"), "utf8")).toBe("new installer");
    expect(result.map((artifact) => artifact.name)).toEqual(["UNO-PangYu.exe", "UNO-PangYu-Setup.exe"]);
    expect(result.every((artifact) => artifact.bytes > 0 && artifact.sha256.length === 64)).toBe(true);
  });

  test("does not replace old artifacts when a new source is missing", async () => {
    const root = await temporaryRoot();
    const release = join(root, "release");
    await mkdir(release, { recursive: true });
    await writeFile(join(release, "UNO-PangYu.exe"), "old portable");
    await writeFile(join(release, "UNO-PangYu-Setup.exe"), "old installer");

    await expect(publishArtifacts({
      application: join(root, "missing-app.exe"),
      installer: join(root, "missing-setup.exe"),
      releaseDirectory: release,
    })).rejects.toThrow();

    expect(await readFile(join(release, "UNO-PangYu.exe"), "utf8")).toBe("old portable");
    expect(await readFile(join(release, "UNO-PangYu-Setup.exe"), "utf8")).toBe("old installer");
  });

  test("restores both old artifacts when the second final rename fails", async () => {
    const root = await temporaryRoot();
    const source = join(root, "source");
    const release = join(root, "release");
    await mkdir(source, { recursive: true });
    const application = join(source, "app.exe");
    const installer = join(source, "setup.exe");
    await writeFile(application, "new portable");
    await writeFile(installer, "new installer");
    await mkdir(release, { recursive: true });
    await writeFile(join(release, "UNO-PangYu.exe"), "old portable");
    await writeFile(join(release, "UNO-PangYu-Setup.exe"), "old installer");

    await expect(publishArtifacts({
      application,
      installer,
      releaseDirectory: release,
      fileSystem: {
        rename: async (from, to) => {
          if (from.includes("UNO-PangYu-Setup.exe.new-") && to.endsWith("UNO-PangYu-Setup.exe")) {
            throw new Error("second final rename failed");
          }
          await renameFile(from, to);
        },
      },
    })).rejects.toThrow("second final rename failed");

    expect(await readFile(join(release, "UNO-PangYu.exe"), "utf8")).toBe("old portable");
    expect(await readFile(join(release, "UNO-PangYu-Setup.exe"), "utf8")).toBe("old installer");
  });

  test("retains the old backup when rollback recovery fails", async () => {
    const root = await temporaryRoot();
    const source = join(root, "source");
    const release = join(root, "release");
    await mkdir(source, { recursive: true });
    const application = join(source, "app.exe");
    const installer = join(source, "setup.exe");
    await writeFile(application, "new portable");
    await writeFile(installer, "new installer");
    await mkdir(release, { recursive: true });
    await writeFile(join(release, "UNO-PangYu.exe"), "old portable");
    await writeFile(join(release, "UNO-PangYu-Setup.exe"), "old installer");
    let finalizationFailed = false;

    await expect(publishArtifacts({
      application,
      installer,
      releaseDirectory: release,
      fileSystem: {
        rename: async (from, to) => {
          if (from.includes("UNO-PangYu-Setup.exe.new-") && to.endsWith("UNO-PangYu-Setup.exe")) {
            finalizationFailed = true;
            throw new Error("second final rename failed");
          }
          if (finalizationFailed && from.includes("UNO-PangYu.exe.backup-") && to.endsWith("UNO-PangYu.exe")) {
            throw new Error("portable restore failed");
          }
          await renameFile(from, to);
        },
      },
    })).rejects.toThrow("恢复旧产物失败");

    const backup = (await readdir(release)).find((name) => name.startsWith("UNO-PangYu.exe.backup-"));
    expect(backup).toBeDefined();
    expect(await readFile(join(release, backup), "utf8")).toBe("old portable");
    expect(await readFile(join(release, "UNO-PangYu-Setup.exe"), "utf8")).toBe("old installer");
  });
});

test("package.json exposes the Windows build command", async () => {
  const packageJson = JSON.parse(await readFile(
    new URL("../../package.json", import.meta.url),
    "utf8",
  ));
  expect(packageJson.scripts["build:windows"]).toBe("node scripts/build-windows.mjs");
});
