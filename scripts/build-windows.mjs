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
  throw new Error("鏈壘鍒?Visual Studio 2022 Build Tools锛堥渶瑕?MSVC x64 鏋勫缓宸ュ叿锛?");
}

export async function resolveBuildArtifacts(root = projectRoot) {
  const releaseRoot = join(root, "src-tauri", "target", WINDOWS_TARGET, "release");
  const application = join(releaseRoot, "black-shirt-companion.exe");
  try {
    if ((await stat(application)).size <= 0) throw new Error();
  } catch {
    throw new Error(`鏈壘鍒?Tauri 搴旂敤绋嬪簭锛?${application}`);
  }
  const nsisDirectory = join(releaseRoot, "bundle", "nsis");
  let installers = [];
  try {
    installers = (await readdir(nsisDirectory))
      .filter((name) => name.endsWith("-setup.exe"))
      .sort();
  } catch {}
  if (!installers.length) throw new Error(`鏈壘鍒?NSIS 瀹夎鍖咃細${nsisDirectory}`);
  return { application, installer: join(nsisDirectory, installers.at(-1)) };
}

let publicationCount = 0;

async function requireNonEmptyFile(path) {
  const details = await stat(path);
  if (details.size <= 0) throw new Error(`构建产物为空：${path}`);
  return details;
}

async function moveExistingFile(source, destination) {
  try {
    await stat(source);
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
  await rename(source, destination);
  return true;
}

async function sha256(path) {
  const handle = await open(path);
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

async function restoreBackups(artifacts) {
  await Promise.all(artifacts
    .filter(({ published }) => published)
    .map(({ destination }) => rm(destination, { force: true })));
  await Promise.all(artifacts
    .filter(({ backedUp }) => backedUp)
    .map(({ backup, destination }) => rename(backup, destination)));
}

export async function publishArtifacts({ application, installer, releaseDirectory }) {
  await mkdir(releaseDirectory, { recursive: true });
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

  try {
    await Promise.all(artifacts.map(({ source, staged }) => copyFile(source, staged)));
    await Promise.all(artifacts.map(({ staged }) => requireNonEmptyFile(staged)));

    for (const artifact of artifacts) {
      artifact.backedUp = await moveExistingFile(artifact.destination, artifact.backup);
    }
    for (const artifact of artifacts) {
      await rename(artifact.staged, artifact.destination);
      artifact.published = true;
    }

    return Promise.all(artifacts.map(async ({ name, destination }) => {
      const { size: bytes } = await requireNonEmptyFile(destination);
      return { name, path: destination, bytes, sha256: await sha256(destination) };
    }));
  } catch (error) {
    try {
      await restoreBackups(artifacts);
    } catch (restoreError) {
      error.message = `${error.message}; 恢复旧产物失败：${restoreError.message}`;
    }
    throw error;
  } finally {
    await Promise.all(artifacts.flatMap(({ staged, backup }) => [
      rm(staged, { force: true }),
      rm(backup, { force: true }),
    ]));
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
  resolveArtifacts = resolveBuildArtifacts,
  publish = publishArtifacts,
} = {}) {
  if (platform !== "win32") throw new Error("pnpm build:windows 浠呮敮鎸?Windows");
  if (architecture !== "x64") throw new Error(`浠呮敮鎸?Windows x64锛屽綋鍓嶆灦鏋勶細${architecture}`);
  await runCommand("rustc", [`+${RUST_TOOLCHAIN}`, "--version"], { cwd: root });
  const vsDevCommand = await findVsDev();
  await runCommand("cmd.exe", ["/d", "/s", "/c", buildDeveloperCommand(vsDevCommand)], {
    cwd: root,
  });
  return publish({ ...(await resolveArtifacts(root)), releaseDirectory: join(root, "release") });
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
        ? "缂哄皯 Rust 1.86 MSVC锛岃杩愯 rustup toolchain install 1.86.0-x86_64-pc-windows-msvc --profile minimal"
        : error.message;
      console.error(`Windows 构建失败：${message}`);
      process.exitCode = 1;
    });
}
