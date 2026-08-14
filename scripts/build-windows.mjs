import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  access,
  copyFile,
  mkdir,
  open,
  readdir,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { arch, platform as hostPlatform } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const RUST_TOOLCHAIN = "1.86.0-x86_64-pc-windows-msvc";
export const WINDOWS_TARGET = "x86_64-pc-windows-msvc";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

export function buildDeveloperCommand(vsDevCommand) {
  return [
    `call "${vsDevCommand}" -no_logo -arch=x64`,
    `set "RUSTUP_TOOLCHAIN=${RUST_TOOLCHAIN}"`,
    "pnpm exec tauri build --target x86_64-pc-windows-msvc --bundles nsis --no-sign",
  ].join(" && ");
}

export async function findVisualStudioDeveloperCommand({
  environment = process.env,
  canAccess = access,
} = {}) {
  const roots = [
    environment["ProgramFiles(x86)"],
    environment.ProgramFiles,
  ].filter(Boolean);
  const editions = ["BuildTools", "Community", "Professional", "Enterprise"];
  for (const root of roots) {
    for (const edition of editions) {
      const candidate = join(root, "Microsoft Visual Studio", "2022", edition,
        "Common7", "Tools", "VsDevCmd.bat");
      try {
        await canAccess(candidate);
        return candidate;
      } catch {}
    }
  }
  throw new Error("未找到 Visual Studio 2022 Build Tools（需要 MSVC x64 构建工具）");
}

function installerMetadata(details) {
  return {
    size: details.size,
    mtimeMs: details.mtimeMs,
    ctimeMs: details.ctimeMs,
    birthtimeMs: details.birthtimeMs,
    ino: details.ino,
  };
}

function installerChanged(previous, current) {
  return !previous
    || previous.size !== current.size
    || previous.mtimeMs !== current.mtimeMs
    || previous.ctimeMs !== current.ctimeMs
    || previous.birthtimeMs !== current.birthtimeMs
    || previous.ino !== current.ino
    || previous.sha256 !== current.sha256;
}

function isMissingFile(error) {
  return error?.code === "ENOENT";
}

export async function snapshotInstallerCandidates(
  root = projectRoot,
  { fileSystem: overrides = {} } = {},
) {
  const releaseRoot = join(root, "src-tauri", "target", WINDOWS_TARGET, "release");
  const nsisDirectory = join(releaseRoot, "bundle", "nsis");
  const fileSystem = { open, readdir, stat, ...overrides };
  const installers = new Map();
  let names;
  try {
    names = await fileSystem.readdir(nsisDirectory);
  } catch (error) {
    if (isMissingFile(error)) return installers;
    throw error;
  }
  await Promise.all(names
    .filter((name) => name.endsWith("-setup.exe"))
    .map(async (name) => {
      const installer = join(nsisDirectory, name);
      try {
        const details = await fileSystem.stat(installer);
        if (details.isFile() && details.size > 0) {
          installers.set(installer, {
            ...installerMetadata(details),
            sha256: await sha256(installer, fileSystem),
          });
        }
      } catch (error) {
        if (!isMissingFile(error)) throw error;
      }
    }));
  return installers;
}

export async function resolveBuildArtifacts(root = projectRoot, installersBeforeBuild) {
  const releaseRoot = join(root, "src-tauri", "target", WINDOWS_TARGET, "release");
  const application = join(releaseRoot, "black-shirt-companion.exe");
  try {
    if ((await stat(application)).size <= 0) throw new Error();
  } catch {
    throw new Error(`未找到 Tauri 应用程序：${application}`);
  }
  const nsisDirectory = join(releaseRoot, "bundle", "nsis");
  const installerCandidates = await snapshotInstallerCandidates(root);
  let installers = [...installerCandidates.keys()].sort();
  if (installersBeforeBuild) {
    installers = installers.filter((installer) => installerChanged(
      installersBeforeBuild.get(installer),
      installerCandidates.get(installer),
    ));
    if (installers.length > 1) {
      throw new Error(`本次构建产生了多个 NSIS 安装包：${installers.join(", ")}`);
    }
    if (!installers.length) {
      throw new Error(`本次构建未产生新的或变更的 NSIS 安装包：${nsisDirectory}`);
    }
  }
  if (!installers.length) throw new Error(`未找到 NSIS 安装包：${nsisDirectory}`);
  return { application, installer: installers.at(-1) };
}

let publicationCount = 0;

async function requireNonEmptyFile(path, fileSystem) {
  const details = await fileSystem.stat(path);
  if (!details.isFile() || details.size <= 0) throw new Error(`构建产物为空：${path}`);
  return details;
}

async function moveExistingFile(source, destination, fileSystem) {
  try {
    await fileSystem.stat(source);
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
  await fileSystem.rename(source, destination);
  return true;
}

async function sha256(path, fileSystem) {
  const handle = await fileSystem.open(path);
  const hash = createHash("sha256");
  try {
    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      hash.update(chunk);
    }
  } finally {
    await handle.close();
  }
  return hash.digest("hex");
}

async function restoreBackups(artifacts, fileSystem) {
  await Promise.all(artifacts
    .filter(({ published }) => published)
    .map(({ destination }) => fileSystem.rm(destination, { force: true })));
  await Promise.all(artifacts
    .filter(({ backedUp }) => backedUp)
    .map(({ backup, destination }) => fileSystem.rename(backup, destination)));
}

export async function publishArtifacts({ application, installer, releaseDirectory, fileSystem: overrides = {} }) {
  const fileSystem = { copyFile, mkdir, open, rename, rm, stat, ...overrides };
  await fileSystem.mkdir(releaseDirectory, { recursive: true });
  const publicationId = `${process.pid}-${Date.now()}-${publicationCount++}`;
  const artifacts = [
    { source: application, name: "UNO.exe" },
    { source: installer, name: "UNO-Setup.exe" },
  ].map((artifact) => ({
    ...artifact,
    destination: join(releaseDirectory, artifact.name),
    staged: join(releaseDirectory, `${artifact.name}.new-${publicationId}`),
    backup: join(releaseDirectory, `${artifact.name}.backup-${publicationId}`),
    backedUp: false,
    published: false,
  }));

  let cleanupBackups = false;
  try {
    await Promise.all(artifacts.map(({ source, staged }) => fileSystem.copyFile(source, staged)));
    await Promise.all(artifacts.map(({ staged }) => requireNonEmptyFile(staged, fileSystem)));

    for (const artifact of artifacts) {
      artifact.backedUp = await moveExistingFile(artifact.destination, artifact.backup, fileSystem);
    }
    for (const artifact of artifacts) {
      await fileSystem.rename(artifact.staged, artifact.destination);
      artifact.published = true;
    }

    const result = await Promise.all(artifacts.map(async ({ name, destination }) => {
      const { size: bytes } = await requireNonEmptyFile(destination, fileSystem);
      return { name, path: destination, bytes, sha256: await sha256(destination, fileSystem) };
    }));
    cleanupBackups = true;
    return result;
  } catch (error) {
    try {
      await restoreBackups(artifacts, fileSystem);
      cleanupBackups = true;
    } catch (restoreError) {
      error.message = `${error.message}; 恢复旧产物失败：${restoreError.message}`;
    }
    throw error;
  } finally {
    const temporaryFiles = artifacts.map(({ staged }) => fileSystem.rm(staged, { force: true }));
    if (cleanupBackups) {
      temporaryFiles.push(...artifacts.map(({ backup }) => fileSystem.rm(backup, { force: true })));
    }
    await Promise.all(temporaryFiles);
  }
}

function spawnCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, shell: false });
    let output = "";
    let errorOutput = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { errorOutput += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(output);
      else reject(new Error(`${command} exited with code ${code}: ${errorOutput.trim()}`));
    });
  });
}

export async function runWindowsBuild({
  root = projectRoot,
  platform = hostPlatform(),
  architecture = arch(),
  runCommand = spawnCommand,
  findVsDev = findVisualStudioDeveloperCommand,
  snapshotInstallers = snapshotInstallerCandidates,
  resolveArtifacts = resolveBuildArtifacts,
  publish = publishArtifacts,
} = {}) {
  if (platform !== "win32") throw new Error("pnpm build:windows 仅支持 Windows");
  if (architecture !== "x64") throw new Error(`仅支持 Windows x64，当前架构：${architecture}`);
  const installersBeforeBuild = await snapshotInstallers(root);
  await runCommand("rustc", [`+${RUST_TOOLCHAIN}`, "--version"], { cwd: root });
  const vsDevCommand = await findVsDev();
  await runCommand("cmd.exe", ["/d", "/s", "/c", buildDeveloperCommand(vsDevCommand)], {
    cwd: root,
    windowsVerbatimArguments: true,
  });
  return publish({
    ...(await resolveArtifacts(root, installersBeforeBuild)),
    releaseDirectory: join(root, "release"),
  });
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  runWindowsBuild()
    .then((artifacts) => artifacts.forEach(({ name, path, bytes, sha256 }) => {
      console.log(`${name}: ${path} (${bytes} bytes, sha256 ${sha256})`);
    }))
    .catch((error) => {
      const missingRustToolchain = (error?.code === "ENOENT" && error?.path === "rustc")
        || (error?.message?.includes(RUST_TOOLCHAIN)
          && /toolchain.*(?:not installed|is not installed)/i.test(error.message));
      const message = missingRustToolchain
        ? "缺少 Rust 1.86 MSVC，请运行 rustup toolchain install 1.86.0-x86_64-pc-windows-msvc --profile minimal"
        : error.message;
      console.error(`Windows 构建失败：${message}`);
      process.exitCode = 1;
    });
}
