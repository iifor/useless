import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { emitKeypressEvents } from "node:readline";
import { pathToFileURL } from "node:url";

export function bumpVersion(version, level) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error(`Invalid SemVer: ${version}`);
  if (!["major", "minor", "patch"].includes(level)) {
    throw new Error(`Invalid release level: ${level}`);
  }

  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (level === "major") return `${major + 1}.0.0`;
  if (level === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

const versionFiles = [
  "package.json",
  "src-tauri/tauri.conf.json",
  "src-tauri/Cargo.toml",
  "src-tauri/Cargo.lock",
];

function replaceVersion(source, pattern, current, next, file) {
  const match = pattern.exec(source);
  if (!match) throw new Error(`Version not found in ${file}`);
  if (match[2] !== current) {
    throw new Error(`Version mismatch in ${file}: ${match[2]} !== ${current}`);
  }
  return source.replace(pattern, `$1${next}$3`);
}

export async function runRelease({
  root = process.cwd(),
  level,
  runCommand = (command, args) => spawnCommand(command, args, root),
}) {
  const paths = versionFiles.map((file) => join(root, file));
  const originals = await Promise.all(paths.map((path) => readFile(path, "utf8")));
  const packageJson = JSON.parse(originals[0]);
  const tauriConfig = JSON.parse(originals[1]);
  const current = packageJson.version;
  const next = bumpVersion(current, level);
  const tag = `v${next}`;

  const branch = (await runCommand("git", ["branch", "--show-current"])).trim();
  if (branch !== "master") throw new Error(`必须从 master 发布，当前分支：${branch}`);

  const status = await runCommand("git", ["status", "--porcelain"]);
  if (status.trim()) throw new Error("工作树不干净，请先提交或暂存现有改动");

  const remote = (await runCommand("git", ["remote", "get-url", "origin"])).trim();
  if (remote.replace(/\/$/, "") !== "https://github.com/iifor/useless.git") {
    throw new Error(`origin 地址不正确：${remote}`);
  }

  await runCommand("git", ["fetch", "--tags", "origin"]);
  const divergence = (
    await runCommand("git", [
      "rev-list",
      "--left-right",
      "--count",
      "HEAD...origin/master",
    ])
  ).trim().split(/\s+/).map(Number);
  if (divergence[1] > 0) throw new Error("远端 master 有新提交，请先同步后再发布");
  if ((await runCommand("git", ["tag", "--list", tag])).trim()) {
    throw new Error(`版本标签已存在：${tag}`);
  }

  if (tauriConfig.version !== current) {
    throw new Error(
      `Version mismatch in src-tauri/tauri.conf.json: ${tauriConfig.version} !== ${current}`,
    );
  }

  packageJson.version = next;
  tauriConfig.version = next;
  const updated = [
    `${JSON.stringify(packageJson, null, 2)}\n`,
    `${JSON.stringify(tauriConfig, null, 2)}\n`,
    replaceVersion(
      originals[2],
      /(\[package\][\s\S]*?\nversion\s*=\s*")([^"]+)(")/,
      current,
      next,
      "src-tauri/Cargo.toml",
    ),
    replaceVersion(
      originals[3],
      /(\[\[package\]\]\s*\nname = "black-shirt-companion"\s*\nversion = ")([^"]+)(")/,
      current,
      next,
      "src-tauri/Cargo.lock",
    ),
  ];

  try {
    for (let index = 0; index < paths.length; index += 1) {
      await writeFile(paths[index], updated[index]);
    }
    await runCommand("pnpm", ["test"]);
    await runCommand("pnpm", ["build"]);
    await runCommand("cargo", [
      "test",
      "--manifest-path",
      "src-tauri/Cargo.toml",
    ]);
    await runCommand("cargo", [
      "check",
      "--manifest-path",
      "src-tauri/Cargo.toml",
    ]);
  } catch (error) {
    const rollback = await Promise.allSettled(
      paths.map((path, index) => writeFile(path, originals[index])),
    );
    const rollbackErrors = rollback
      .filter((result) => result.status === "rejected")
      .map((result) => result.reason);
    if (rollbackErrors.length) {
      throw new AggregateError(
        [error, ...rollbackErrors],
        "Release failed and version rollback was incomplete",
      );
    }
    throw error;
  }

  await runCommand("git", ["add", ...versionFiles]);
  await runCommand("git", ["commit", "-m", `chore(release): ${tag}`]);
  await runCommand("git", ["tag", tag]);
  try {
    await runCommand("git", ["push", "--atomic", "origin", "master", tag]);
  } catch (error) {
    throw new Error(
      `推送失败，本地提交和标签已保留。请重试：git push --atomic origin master ${tag}`,
      { cause: error },
    );
  }
  return next;
}

function spawnCommand(command, args, root) {
  return new Promise((resolve, reject) => {
    const capture = command === "git" && [
      "branch",
      "status",
      "remote",
      "rev-list",
      "tag",
    ].includes(args[0]);
    const child = spawn(command, args, {
      cwd: root,
      stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
    });
    let stdout = "";
    child.stdout?.on("data", (chunk) => { stdout += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${command} ${args.join(" ")} failed with exit code ${code}`));
    });
  });
}

export function selectMenu({
  title,
  options,
  input = process.stdin,
  output = process.stdout,
  initialIndex = 0,
}) {
  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== "function") {
    return Promise.reject(new Error("Interactive TTY required"));
  }
  if (!options.length) return Promise.reject(new Error("Menu requires options"));

  emitKeypressEvents(input);
  let index = Math.max(0, Math.min(initialIndex, options.length - 1));
  let rendered = false;
  const lineCount = options.length + 1;
  const wasRaw = Boolean(input.isRaw);
  const wasPaused = input.isPaused();

  const render = () => {
    if (rendered) output.write(`\x1b[${lineCount}A`);
    output.write(`\x1b[2K${title}\n`);
    for (let optionIndex = 0; optionIndex < options.length; optionIndex += 1) {
      const marker = optionIndex === index ? "❯" : " ";
      output.write(`\x1b[2K${marker} ${options[optionIndex].label}\n`);
    }
    rendered = true;
  };

  return new Promise((resolve) => {
    const finish = (value) => {
      input.off("keypress", onKeypress);
      if (!wasRaw) input.setRawMode(false);
      if (wasPaused) input.pause();
      output.write("\x1b[?25h");
      resolve(value);
    };
    const onKeypress = (_text, key = {}) => {
      if (key.name === "up") {
        index = Math.max(0, index - 1);
        render();
      } else if (key.name === "down") {
        index = Math.min(options.length - 1, index + 1);
        render();
      } else if (key.name === "return" || key.name === "enter") {
        finish(options[index].value);
      } else if (key.name === "escape" || (key.ctrl && key.name === "c")) {
        finish(null);
      }
    };

    input.on("keypress", onKeypress);
    if (!wasRaw) input.setRawMode(true);
    input.resume();
    output.write("\x1b[?25l");
    render();
  });
}

export async function runInteractive({
  input = process.stdin,
  output = process.stdout,
  root = process.cwd(),
  runCommand,
  select,
} = {}) {
  const choose =
    select ?? ((menu) => selectMenu({ ...menu, input, output }));
  const cancel = () => {
    output.write("已取消，版本未修改。\n");
    return null;
  };

  const level = await choose({
    title: "选择版本升级：",
    options: [
      { label: "major", value: "major" },
      { label: "minor", value: "minor" },
      { label: "patch", value: "patch" },
    ],
  });
  if (level === null) return cancel();

  const packageJson = JSON.parse(
    await readFile(join(root, "package.json"), "utf8"),
  );
  const next = bumpVersion(packageJson.version, level);
  const confirmed = await choose({
    title: `版本：${packageJson.version} → ${next}\n确认发布到 GitHub？`,
    options: [
      { label: "取消", value: false },
      { label: "确认", value: true },
    ],
  });
  if (!confirmed) return cancel();

  return await runRelease({
    root,
    level,
    runCommand,
  });
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  runInteractive().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
