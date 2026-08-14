import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import {
  bumpVersion,
  runInteractive,
  runRelease,
  selectMenu,
} from "../../scripts/release.mjs";

const versionPaths = [
  "package.json",
  "src-tauri/tauri.conf.json",
  "src-tauri/Cargo.toml",
  "src-tauri/Cargo.lock",
];

async function makeProject(version) {
  const root = await mkdtemp(join(tmpdir(), "uno-release-"));
  await mkdir(join(root, "src-tauri"));
  await writeFile(join(root, "package.json"), `${JSON.stringify({ version }, null, 2)}\n`);
  await writeFile(
    join(root, "src-tauri/tauri.conf.json"),
    `${JSON.stringify({ version }, null, 2)}\n`,
  );
  await writeFile(
    join(root, "src-tauri/Cargo.toml"),
    `[package]\nname = "black-shirt-companion"\nversion = "${version}"\n`,
  );
  await writeFile(
    join(root, "src-tauri/Cargo.lock"),
    `[[package]]\nname = "black-shirt-companion"\nversion = "${version}"\n`,
  );
  return root;
}

async function readVersionFiles(root) {
  return Promise.all(
    versionPaths.map((path) => readFile(join(root, path), "utf8")),
  );
}

async function expectVersions(root, version) {
  const [packageJson, tauriConfig, cargoToml, cargoLock] =
    await readVersionFiles(root);
  expect(JSON.parse(packageJson).version).toBe(version);
  expect(JSON.parse(tauriConfig).version).toBe(version);
  expect(cargoToml).toContain(`version = "${version}"`);
  expect(cargoLock).toContain(`version = "${version}"`);
}

function tty() {
  const input = new PassThrough();
  const output = new PassThrough();
  const rawModes = [];
  input.isTTY = true;
  input.isRaw = false;
  input.setRawMode = (mode) => {
    rawModes.push(mode);
    input.isRaw = mode;
  };
  output.isTTY = true;
  return { input, output, rawModes };
}

function successfulCommandRunner(calls) {
  return async (command, args) => {
    calls.push([command, ...args]);
    const key = [command, ...args].join(" ");
    if (key === "git branch --show-current") return "master\n";
    if (key === "git status --porcelain") return "";
    if (key === "git remote get-url origin") {
      return "https://github.com/iifor/useless.git\n";
    }
    if (key === "git rev-list --left-right --count HEAD...origin/master") {
      return "0\t0\n";
    }
    if (key.startsWith("git tag --list ")) return "";
    return "";
  };
}

describe("release versioning", () => {
  it("selects highlighted options with arrow keys and Enter", async () => {
    const { input, output, rawModes } = tty();
    const selected = selectMenu({
      title: "版本",
      options: [
        { label: "major", value: "major" },
        { label: "minor", value: "minor" },
      ],
      input,
      output,
    });

    input.write("\x1b[B\r");

    await expect(selected).resolves.toBe("minor");
    expect(rawModes).toEqual([true, false]);
  });

  it("cancels a menu with Escape", async () => {
    const { input, output } = tty();
    const selected = selectMenu({
      title: "平台",
      options: [{ label: "DMG", value: "dmg" }],
      input,
      output,
    });

    input.write("\x1b");

    await expect(selected).resolves.toBeNull();
  });

  it("rejects menus outside an interactive terminal", async () => {
    await expect(
      selectMenu({
        title: "平台",
        options: [{ label: "DMG", value: "dmg" }],
        input: new PassThrough(),
        output: new PassThrough(),
      }),
    ).rejects.toThrow("Interactive TTY required");
  });

  it.each([
    ["0.1.0", "patch", "0.1.1"],
    ["0.1.9", "minor", "0.2.0"],
    ["1.9.9", "major", "2.0.0"],
  ])("bumps %s with %s", (current, level, expected) => {
    expect(bumpVersion(current, level)).toBe(expected);
  });

  it("rejects invalid versions and levels", () => {
    expect(() => bumpVersion("1.0", "patch")).toThrow("Invalid SemVer");
    expect(() => bumpVersion("1.0.0", "banana")).toThrow("Invalid release level");
  });

  it("checks, versions, commits, tags, and atomically pushes a release", async () => {
    const root = await makeProject("0.1.0");
    const calls = [];
    const next = await runRelease({
      root,
      level: "minor",
      runCommand: successfulCommandRunner(calls),
    });

    expect(next).toBe("0.2.0");
    await expectVersions(root, "0.2.0");
    expect(calls).toContainEqual(["pnpm", "test"]);
    expect(calls).toContainEqual(["pnpm", "build"]);
    expect(calls).toContainEqual([
      "cargo",
      "test",
      "--manifest-path",
      "src-tauri/Cargo.toml",
    ]);
    expect(calls).toContainEqual([
      "cargo",
      "check",
      "--manifest-path",
      "src-tauri/Cargo.toml",
    ]);
    expect(calls).toContainEqual([
      "git",
      "commit",
      "-m",
      "chore(release): v0.2.0",
    ]);
    expect(calls).toContainEqual(["git", "tag", "v0.2.0"]);
    expect(calls.at(-1)).toEqual([
      "git",
      "push",
      "--atomic",
      "origin",
      "master",
      "v0.2.0",
    ]);
  });

  it("restores every version file when validation fails", async () => {
    const root = await makeProject("0.1.0");
    const before = await readVersionFiles(root);
    const calls = [];
    const runCommand = successfulCommandRunner(calls);

    await expect(
      runRelease({
        root,
        level: "patch",
        runCommand: async (command, args) => {
          if (command === "pnpm" && args[0] === "build") {
            throw new Error("build failed");
          }
          return runCommand(command, args);
        },
      }),
    ).rejects.toThrow("build failed");
    expect(await readVersionFiles(root)).toEqual(before);
    expect(calls.some((call) => call.includes("commit"))).toBe(false);
  });

  it("keeps the release commit and tag recoverable when push fails", async () => {
    const root = await makeProject("0.1.0");
    const calls = [];
    const runCommand = successfulCommandRunner(calls);

    await expect(
      runRelease({
        root,
        level: "patch",
        runCommand: async (command, args) => {
          const result = await runCommand(command, args);
          if (command === "git" && args[0] === "push") {
            throw new Error("push failed");
          }
          return result;
        },
      }),
    ).rejects.toThrow("git push --atomic origin master v0.1.1");

    await expectVersions(root, "0.1.1");
    expect(calls).toContainEqual(["git", "tag", "v0.1.1"]);
  });

  it("rejects a dirty worktree before changing versions", async () => {
    const root = await makeProject("0.1.0");
    const before = await readVersionFiles(root);

    await expect(
      runRelease({
        root,
        level: "patch",
        runCommand: async (command, args) => {
          const key = [command, ...args].join(" ");
          if (key === "git branch --show-current") return "master\n";
          if (key === "git status --porcelain") return " M src/App.tsx\n";
          return "";
        },
      }),
    ).rejects.toThrow("工作树不干净");

    expect(await readVersionFiles(root)).toEqual(before);
  });

  it.each([
    ["git remote get-url origin", "https://github.com/other/repo.git\n", "origin 地址不正确"],
    ["git rev-list --left-right --count HEAD...origin/master", "0\t1\n", "远端 master 有新提交"],
    ["git tag --list v0.1.1", "v0.1.1\n", "版本标签已存在"],
  ])("rejects an unsafe preflight result from %s", async (failingCommand, output, message) => {
    const root = await makeProject("0.1.0");
    const calls = [];
    const runCommand = successfulCommandRunner(calls);

    await expect(
      runRelease({
        root,
        level: "patch",
        runCommand: async (command, args) => {
          if ([command, ...args].join(" ") === failingCommand) return output;
          return runCommand(command, args);
        },
      }),
    ).rejects.toThrow(message);

    await expectVersions(root, "0.1.0");
  });

  it("uses two menus and keeps versions when confirmation is cancelled", async () => {
    const root = await makeProject("0.1.0");
    const before = await readVersionFiles(root);
    const input = new PassThrough();
    const output = new PassThrough();
    const selections = ["patch", false];
    let selectCalls = 0;
    let commandCalls = 0;

    const result = await runInteractive({
      input,
      output,
      root,
      select: async () => {
        selectCalls += 1;
        return selections.shift();
      },
      runCommand: async () => {
        commandCalls += 1;
      },
    });

    expect(result).toBeNull();
    expect(selectCalls).toBe(2);
    expect(commandCalls).toBe(0);
    expect(await readVersionFiles(root)).toEqual(before);
    expect(output.read().toString()).toContain("已取消，版本未修改。");
  });
});
