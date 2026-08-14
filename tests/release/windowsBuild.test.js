import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import {
  RUST_TOOLCHAIN,
  WINDOWS_TARGET,
  buildDeveloperCommand,
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
      .rejects.toThrow("浠呮敮鎸?Windows");
  });

  test("reports missing build outputs", async () => {
    const root = await temporaryRoot();
    await expect(resolveBuildArtifacts(root)).rejects.toThrow("鏈壘鍒?Tauri 搴旂敤绋嬪簭");
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
});
