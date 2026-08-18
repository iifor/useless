import { mkdtemp, mkdir, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

import { afterEach, describe, expect, test } from "vitest";

import {
  validateCharacterPackage,
} from "../../scripts/pet-validate.mjs";

const temporaryRoots = [];
const scriptPath = resolve("scripts/pet-validate.mjs");
const walks = ["walk-slow-left", "walk-slow-right", "walk-slow-up", "walk-slow-down"];
const seatStrips = ["search-seat", "search-current-window", "search-desktop-icon", "seat-on-item"];
const foodStrips = ["look-file", "ask-confirm", "eat-normal"];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function tempRoot() {
  const root = await mkdtemp(join(tmpdir(), "pet-package-"));
  temporaryRoots.push(root);
  return root;
}

function manifest(overrides = {}) {
  return {
    schemaVersion: 1,
    id: "valid-pet",
    displayName: "Valid Pet",
    version: "1.2.3",
    bundleId: "com.example.validpet",
    description: "A valid test pet.",
    idlePoses: ["idle-stand"],
    capabilities: [],
    ...overrides,
  };
}

function png({ signature = true, ihdrLength = 13, width = 4, height = 1, colorType = 6 } = {}) {
  const header = Buffer.alloc(29);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(header);
  if (!signature) header[0] = 0;
  header.writeUInt32BE(ihdrLength, 8);
  header.write("IHDR", 12, "ascii");
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  header[24] = 8;
  header[25] = colorType;
  return header;
}

async function writePackage(root, id = "valid-pet", options = {}) {
  const packageRoot = join(root, "characters", id);
  const petRoot = join(packageRoot, "pet");
  const stripsRoot = join(petRoot, options.flatStrips ? "" : "extended-animations");
  const iconsRoot = join(packageRoot, "icons");
  const value = manifest({ id, ...options.manifest });
  const strips = [
    ...walks,
    ...(value.idlePoses.filter((pose) => pose !== "idle-stand")),
    ...(value.capabilities.includes("desktop-seat") ? seatStrips : []),
    ...(value.capabilities.includes("file-eating") ? foodStrips : []),
  ];

  await mkdir(petRoot, { recursive: true });
  await mkdir(stripsRoot, { recursive: true });
  await mkdir(iconsRoot, { recursive: true });
  await writeFile(join(packageRoot, options.characterFile ?? "character.json"), JSON.stringify(value));
  await writeFile(join(petRoot, "spritesheet.webp"), "webp");
  await Promise.all(strips.map((strip) => writeFile(join(stripsRoot, `${strip}.png`), png(options.png))));
  await Promise.all([
    writeFile(join(iconsRoot, "icon.png"), "png"),
    writeFile(join(iconsRoot, "icon.icns"), "icns"),
    writeFile(join(iconsRoot, "icon.ico"), "ico"),
  ]);
  return packageRoot;
}

function runCli(root, ...args) {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, [scriptPath, ...args], { cwd: root });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => resolveRun({ code, stderr }));
  });
}

describe("character packages", () => {
  test("accepts a complete package", async () => {
    const root = await tempRoot();
    await writePackage(root, "full-pet", {
      manifest: {
        idlePoses: ["idle-stand", "idle-sit", "idle-prone", "idle-lie"],
        capabilities: ["desktop-seat", "file-eating"],
      },
    });

    await expect(validateCharacterPackage(join(root, "characters"), "full-pet")).resolves.toEqual([]);
  });

  test("accepts a reduced package without optional strips", async () => {
    const root = await tempRoot();
    await writePackage(root, "reduced-pet");

    await expect(validateCharacterPackage(join(root, "characters"), "reduced-pet")).resolves.toEqual([]);
  });

  test("requires character.json instead of manifest.json", async () => {
    const root = await tempRoot();
    await writePackage(root, "manifest-only", { characterFile: "manifest.json" });
    await writePackage(root, "character-only", { characterFile: "character.json" });

    await expect(validateCharacterPackage(join(root, "characters"), "manifest-only"))
      .resolves.toEqual(expect.arrayContaining([expect.stringContaining("characters/manifest-only/character.json: missing or invalid JSON")]));
    await expect(validateCharacterPackage(join(root, "characters"), "character-only")).resolves.toEqual([]);
  });

  test.each([
    ["schema version", { schemaVersion: 2 }, "schemaVersion"],
    ["id", { id: "Invalid Pet" }, "id"],
    ["version", { version: "1.2" }, "version"],
    ["bundle id", { bundleId: "Com.example.pet" }, "bundleId"],
    ["display name", { displayName: "  " }, "displayName"],
    ["description", { description: "" }, "description"],
  ])("rejects an invalid %s", async (_field, invalid, expectedPath) => {
    const root = await tempRoot();
    await writePackage(root, "valid-pet", { manifest: invalid });

    await expect(validateCharacterPackage(join(root, "characters"), "valid-pet"))
      .resolves.toEqual(expect.arrayContaining([expect.stringContaining(`character.json: ${expectedPath}`)]));
  });

  test.each([
    ["duplicate idle poses", { idlePoses: ["idle-stand", "idle-stand"] }, "idlePoses"],
    ["unknown idle pose", { idlePoses: ["idle-stand", "idle-wave"] }, "idlePoses"],
    ["duplicate capabilities", { capabilities: ["desktop-seat", "desktop-seat"] }, "capabilities"],
    ["unknown capability", { capabilities: ["fly"] }, "capabilities"],
  ])("rejects %s", async (_caseName, invalid, expectedPath) => {
    const root = await tempRoot();
    await writePackage(root, "valid-pet", { manifest: invalid });

    await expect(validateCharacterPackage(join(root, "characters"), "valid-pet"))
      .resolves.toEqual(expect.arrayContaining([expect.stringContaining(`character.json: ${expectedPath}`)]));
  });

  test("rejects a missing core asset", async () => {
    const root = await tempRoot();
    const packageRoot = await writePackage(root);
    await unlink(join(packageRoot, "pet", "spritesheet.webp"));

    await expect(validateCharacterPackage(join(root, "characters"), "valid-pet"))
      .resolves.toEqual(expect.arrayContaining([expect.stringContaining("pet/spritesheet.webp") ]));
  });

  test("rejects a missing strip required by an enabled capability", async () => {
    const root = await tempRoot();
    const packageRoot = await writePackage(root, "valid-pet", {
      manifest: { capabilities: ["desktop-seat"] },
    });
    await unlink(join(packageRoot, "pet", "extended-animations", "search-seat.png"));

    await expect(validateCharacterPackage(join(root, "characters"), "valid-pet"))
      .resolves.toEqual(expect.arrayContaining([expect.stringContaining("pet/extended-animations/search-seat.png") ]));
  });

  test("does not require strips for disabled capabilities", async () => {
    const root = await tempRoot();
    await writePackage(root);

    await expect(validateCharacterPackage(join(root, "characters"), "valid-pet")).resolves.toEqual([]);
  });

  test("rejects a package without idle-stand", async () => {
    const root = await tempRoot();
    await writePackage(root, "valid-pet", { manifest: { idlePoses: ["idle-sit"] } });

    await expect(validateCharacterPackage(join(root, "characters"), "valid-pet"))
      .resolves.toEqual(expect.arrayContaining([expect.stringContaining("idlePoses must include idle-stand")]));
  });

  test("rejects a missing strip for an enabled optional idle pose", async () => {
    const root = await tempRoot();
    const packageRoot = await writePackage(root, "valid-pet", { manifest: { idlePoses: ["idle-stand", "idle-sit"] } });
    await unlink(join(packageRoot, "pet", "extended-animations", "idle-sit.png"));

    await expect(validateCharacterPackage(join(root, "characters"), "valid-pet"))
      .resolves.toEqual(expect.arrayContaining([expect.stringContaining("pet/extended-animations/idle-sit.png: missing")]));
  });

  test("requires strips under pet/extended-animations", async () => {
    const root = await tempRoot();
    await writePackage(root, "flat-pet", { flatStrips: true });
    await writePackage(root, "nested-pet");

    await expect(validateCharacterPackage(join(root, "characters"), "flat-pet"))
      .resolves.toEqual(expect.arrayContaining([expect.stringContaining("pet/extended-animations/walk-slow-left.png: missing")]));
    await expect(validateCharacterPackage(join(root, "characters"), "nested-pet")).resolves.toEqual([]);
  });

  test.each([
    ["signature", { signature: false }, "PNG signature"],
    ["IHDR length", { ihdrLength: 12 }, "IHDR length must be 13"],
    ["color type", { colorType: 2 }, "RGBA"],
    ["width", { width: 3 }, "divisible by 4"],
    ["dimensions", { width: 0 }, "dimensions must be positive"],
  ])("rejects a strip with invalid PNG %s", async (_caseName, options, expected) => {
    const root = await tempRoot();
    await writePackage(root, "valid-pet", { png: options });

    await expect(validateCharacterPackage(join(root, "characters"), "valid-pet"))
      .resolves.toEqual(expect.arrayContaining([expect.stringContaining(expected)]));
  });

  test("fails closed for an unknown CLI id", async () => {
    const root = await tempRoot();
    await writePackage(root);

    await expect(runCli(root, "missing-pet")).resolves.toMatchObject({
      code: 1,
      stderr: expect.stringContaining("characters/missing-pet"),
    });
  });

  test("aggregates every invalid package for CLI --all", async () => {
    const root = await tempRoot();
    const valid = await writePackage(root, "valid-pet");
    const invalid = await writePackage(root, "broken-pet");
    await unlink(join(valid, "icons", "icon.ico"));
    await unlink(join(invalid, "pet", "extended-animations", "walk-slow-up.png"));

    await expect(runCli(root, "--all")).resolves.toMatchObject({
      code: 1,
      stderr: expect.stringContaining("characters/valid-pet/icons/icon.ico"),
    });
    const result = await runCli(root, "--all");
    expect(result.stderr).toContain("characters/broken-pet/pet/extended-animations/walk-slow-up.png");
  });
});
