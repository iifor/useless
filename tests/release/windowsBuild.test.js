import { mkdir, mkdtemp, readFile, readdir, rename as renameFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import {
  RUST_TOOLCHAIN,
  WINDOWS_TARGET,
  buildDeveloperCommand,
  findVisualStudioDeveloperCommand,
  publishArtifacts,
  resolveBuildArtifacts,
  runWindowsBuild,
} from "../../scripts/build-windows.mjs";

const temporaryDirectories = [];

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
    await writeFile(join(release, "black-shirt-companion.exe"), "app");

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
    const artifacts = [{ name: "UNO.exe" }];

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
      ["runCommand", "cmd.exe", ["/d", "/s", "/c", 'call "C:\\VS\\VsDevCmd.bat" -no_logo -arch=x64 && set "RUSTUP_TOOLCHAIN=1.86.0-x86_64-pc-windows-msvc" && pnpm exec tauri build --target x86_64-pc-windows-msvc --bundles nsis --no-sign'], { cwd: root }],
      ["resolveArtifacts", root],
      ["publish", {
        application: "/built/app.exe",
        installer: "/built/setup.exe",
        releaseDirectory: join(root, "release"),
      }],
    ]);
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

    expect(await readFile(join(release, "UNO.exe"), "utf8")).toBe("new portable");
    expect(await readFile(join(release, "UNO-Setup.exe"), "utf8")).toBe("new installer");
    expect(result.map((artifact) => artifact.name)).toEqual(["UNO.exe", "UNO-Setup.exe"]);
    expect(result.every((artifact) => artifact.bytes > 0 && artifact.sha256.length === 64)).toBe(true);
  });

  test("does not replace old artifacts when a new source is missing", async () => {
    const root = await temporaryRoot();
    const release = join(root, "release");
    await mkdir(release, { recursive: true });
    await writeFile(join(release, "UNO.exe"), "old portable");
    await writeFile(join(release, "UNO-Setup.exe"), "old installer");

    await expect(publishArtifacts({
      application: join(root, "missing-app.exe"),
      installer: join(root, "missing-setup.exe"),
      releaseDirectory: release,
    })).rejects.toThrow();

    expect(await readFile(join(release, "UNO.exe"), "utf8")).toBe("old portable");
    expect(await readFile(join(release, "UNO-Setup.exe"), "utf8")).toBe("old installer");
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
    await writeFile(join(release, "UNO.exe"), "old portable");
    await writeFile(join(release, "UNO-Setup.exe"), "old installer");

    await expect(publishArtifacts({
      application,
      installer,
      releaseDirectory: release,
      fileSystem: {
        rename: async (from, to) => {
          if (from.includes("UNO-Setup.exe.new-") && to.endsWith("UNO-Setup.exe")) {
            throw new Error("second final rename failed");
          }
          await renameFile(from, to);
        },
      },
    })).rejects.toThrow("second final rename failed");

    expect(await readFile(join(release, "UNO.exe"), "utf8")).toBe("old portable");
    expect(await readFile(join(release, "UNO-Setup.exe"), "utf8")).toBe("old installer");
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
    await writeFile(join(release, "UNO.exe"), "old portable");
    await writeFile(join(release, "UNO-Setup.exe"), "old installer");
    let finalizationFailed = false;

    await expect(publishArtifacts({
      application,
      installer,
      releaseDirectory: release,
      fileSystem: {
        rename: async (from, to) => {
          if (from.includes("UNO-Setup.exe.new-") && to.endsWith("UNO-Setup.exe")) {
            finalizationFailed = true;
            throw new Error("second final rename failed");
          }
          if (finalizationFailed && from.includes("UNO.exe.backup-") && to.endsWith("UNO.exe")) {
            throw new Error("portable restore failed");
          }
          await renameFile(from, to);
        },
      },
    })).rejects.toThrow("恢复旧产物失败");

    const backup = (await readdir(release)).find((name) => name.startsWith("UNO.exe.backup-"));
    expect(backup).toBeDefined();
    expect(await readFile(join(release, backup), "utf8")).toBe("old portable");
    expect(await readFile(join(release, "UNO-Setup.exe"), "utf8")).toBe("old installer");
  });
});
