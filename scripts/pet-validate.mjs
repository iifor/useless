import { open, readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

const idlePoses = new Set(["idle-stand", "idle-sit", "idle-prone", "idle-lie"]);
const capabilities = new Set(["desktop-seat", "file-eating"]);
const walkStrips = ["walk-slow-left", "walk-slow-right", "walk-slow-up", "walk-slow-down"];
const capabilityStrips = {
  "desktop-seat": ["search-seat", "search-current-window", "search-desktop-icon", "seat-on-item"],
  "file-eating": ["look-file", "ask-confirm", "eat-normal"],
};
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const isNonBlank = (value) => typeof value === "string" && value.trim() !== "";
const isId = (value) => typeof value === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
const isVersion = (value) => typeof value === "string" && /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(value);
const isBundleId = (value) => typeof value === "string" && /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/.test(value);

function pathLabel(charactersRoot, path) {
  return relative(join(charactersRoot, ".."), path).replaceAll("\\", "/");
}

function listErrors(manifest, field, supported, errors, manifestPath) {
  const values = manifest[field];
  if (!Array.isArray(values)) {
    errors.push(`${manifestPath}: ${field} must be an array`);
    return [];
  }
  if (new Set(values).size !== values.length) errors.push(`${manifestPath}: ${field} must not contain duplicates`);
  if (values.some((value) => !supported.has(value))) errors.push(`${manifestPath}: ${field} contains an unknown value`);
  return values.filter((value) => supported.has(value));
}

async function nonEmpty(path, errors, label) {
  try {
    const info = await stat(path);
    if (!info.isFile() || info.size === 0) errors.push(`${label}: must be a non-empty file`);
  } catch {
    errors.push(`${label}: missing`);
  }
}

async function validatePngStrip(path, errors, label) {
  try {
    const file = await open(path, "r");
    const header = Buffer.alloc(29);
    const { bytesRead } = await file.read(header, 0, header.length, 0);
    await file.close();
    if (bytesRead < header.length || !header.subarray(0, 8).equals(pngSignature)) {
      errors.push(`${label}: invalid PNG signature`);
      return;
    }
    if (header.readUInt32BE(8) !== 13) {
      errors.push(`${label}: PNG IHDR length must be 13`);
      return;
    }
    if (header.subarray(12, 16).toString("ascii") !== "IHDR") {
      errors.push(`${label}: missing PNG IHDR`);
      return;
    }
    const width = header.readUInt32BE(16);
    const height = header.readUInt32BE(20);
    if (width === 0 || height === 0) errors.push(`${label}: PNG dimensions must be positive`);
    if (width % 4 !== 0) errors.push(`${label}: PNG width must be divisible by 4`);
    if (header[25] !== 6) errors.push(`${label}: PNG must use RGBA color type 6`);
  } catch {
    errors.push(`${label}: missing`);
  }
}

export async function validateCharacterPackage(charactersRoot, id) {
  const packageRoot = join(charactersRoot, id);
  const manifestFile = join(packageRoot, "manifest.json");
  const manifestPath = pathLabel(charactersRoot, manifestFile);
  const errors = [];
  let manifest;

  try {
    manifest = JSON.parse(await readFile(manifestFile, "utf8"));
  } catch {
    return [`${manifestPath}: missing or invalid JSON`];
  }

  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return [`${manifestPath}: must contain an object`];
  }
  if (manifest.schemaVersion !== 1) errors.push(`${manifestPath}: schemaVersion must be 1`);
  if (!isId(manifest.id)) errors.push(`${manifestPath}: id must be lowercase kebab-case`);
  if (manifest.id !== id) errors.push(`${manifestPath}: id must match directory name`);
  if (!isNonBlank(manifest.displayName)) errors.push(`${manifestPath}: displayName must be nonblank`);
  if (!isVersion(manifest.version)) errors.push(`${manifestPath}: version must be strict three-part SemVer`);
  if (!isBundleId(manifest.bundleId)) errors.push(`${manifestPath}: bundleId must use lowercase reverse-domain segments`);
  if (!isNonBlank(manifest.description)) errors.push(`${manifestPath}: description must be nonblank`);

  const declaredIdlePoses = listErrors(manifest, "idlePoses", idlePoses, errors, manifestPath);
  const declaredCapabilities = listErrors(manifest, "capabilities", capabilities, errors, manifestPath);
  if (!declaredIdlePoses.includes("idle-stand")) errors.push(`${manifestPath}: idlePoses must include idle-stand`);

  await nonEmpty(join(packageRoot, "pet", "spritesheet.webp"), errors, pathLabel(charactersRoot, join(packageRoot, "pet", "spritesheet.webp")));
  await Promise.all([
    ...walkStrips,
    ...declaredIdlePoses.filter((pose) => pose !== "idle-stand"),
    ...declaredCapabilities.flatMap((capability) => capabilityStrips[capability]),
  ].map((strip) => {
    const path = join(packageRoot, "pet", `${strip}.png`);
    return validatePngStrip(path, errors, pathLabel(charactersRoot, path));
  }));
  await Promise.all(["icon.png", "icon.icns", "icon.ico"].map((icon) => {
    const path = join(packageRoot, "icons", icon);
    return nonEmpty(path, errors, pathLabel(charactersRoot, path));
  }));

  return errors;
}

export async function validateAllCharacterPackages(charactersRoot) {
  let entries;
  try {
    entries = await readdir(charactersRoot, { withFileTypes: true });
  } catch {
    return [`${pathLabel(charactersRoot, charactersRoot)}: missing characters directory`];
  }
  const ids = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  if (ids.length === 0) return [`${pathLabel(charactersRoot, charactersRoot)}: no character packages`];
  return (await Promise.all(ids.map((id) => validateCharacterPackage(charactersRoot, id)))).flat();
}

async function main(args) {
  const charactersRoot = join(process.cwd(), "characters");
  const errors = args.length === 1 && args[0] === "--all"
    ? await validateAllCharacterPackages(charactersRoot)
    : args.length === 1 && isId(args[0])
      ? await validateCharacterPackage(charactersRoot, args[0])
      : ["usage: pnpm pet:validate <id>|--all"];
  if (errors.length > 0) {
    console.error(errors.join("\n"));
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main(process.argv.slice(2));
