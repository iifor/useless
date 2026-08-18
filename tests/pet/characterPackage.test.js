import { mkdtemp, mkdir, readdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
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
const packageRoot = resolve("characters");

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

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function expectRepairedStrips(id, repaired) {
  for (const [name, expected] of Object.entries(repaired)) {
    const path = join(packageRoot, id, "pet", "extended-animations", name);
    const file = await readFile(path);
    expect([file.readUInt32BE(16), file.readUInt32BE(20)]).toEqual([expected.width, expected.height]);
    expect(await sha256(path)).toBe(expected.hash);
  }
}

describe("character packages", () => {
  test("ships the approved UNO character packages", async () => {
    const expected = {
      uno: {
        displayName: "UNO",
        version: "0.1.2",
        bundleId: "com.blackshirt.companion",
        description: "安静慵懒的黑衣桌面宠物。",
        idlePoses: ["idle-stand", "idle-sit", "idle-prone", "idle-lie"],
      },
      "uno-pangyu": {
        displayName: "UNO PangYu",
        version: "0.1.0",
        bundleId: "com.iifor.uno-pangyu",
        description: "安静的汉服桌面宠物。",
        idlePoses: ["idle-stand", "idle-sit"],
      },
      "uno-yan": {
        displayName: "UNO Yan",
        version: "0.1.0",
        bundleId: "com.iifor.uno-yan",
        description: "黑色短发、彩色发卡和黄色开衫的像素风桌面宠物。",
        idlePoses: ["idle-stand", "idle-sit"],
      },
    };
    const ids = (await readdir(packageRoot, { withFileTypes: true }).catch(() => []))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    expect(ids).toEqual(Object.keys(expected));

    const atlasHashes = [];
    const iconHashes = [];
    for (const [id, manifest] of Object.entries(expected)) {
      const packagePath = join(packageRoot, id);
      await expect(validateCharacterPackage(packageRoot, id)).resolves.toEqual([]);
      await expect(readFile(join(packagePath, "character.json"), "utf8").then(JSON.parse)).resolves.toEqual({
        schemaVersion: 1,
        id,
        ...manifest,
        capabilities: ["desktop-seat", "file-eating"],
      });
      await expect(readFile(join(packagePath, "pet", "extended-animations", "sleep-side.png"))).rejects.toMatchObject({ code: "ENOENT" });
      atlasHashes.push(await sha256(join(packagePath, "pet", "spritesheet.webp")));
      iconHashes.push(await sha256(join(packagePath, "icons", "icon.png")));
    }
    expect(new Set(atlasHashes).size).toBe(3);
    expect(new Set(iconHashes).size).toBe(3);
  });

  test("trims only UNO's transparent trailing atlas columns", async () => {
    const repaired = {
      "ask-confirm.png": { width: 1772, height: 887, hash: "4534f6c063c419d00804d8525885da699c7d0f0b8343cb7ed0d484fb00a77b55" },
      "look-file.png": { width: 1912, height: 822, hash: "cbf0f606e7cb0f20dbc2bbc1d2cb9dd71d8d105967da8c3361418770ab37f095" },
      "search-current-window.png": { width: 1772, height: 887, hash: "a6f92e687c5214c0184b8b504eb9de26ef462404f44286054946e33d5a554613" },
      "search-desktop-icon.png": { width: 1772, height: 887, hash: "dabb4977c710d1043ee3c270eca63b4943e2950af1ce55a6543f6fe46b393afd" },
      "search-seat.png": { width: 1980, height: 793, hash: "624dbab8824185c38b1af1165813524f1607cfc5241bd9315c6db198b08e8dff" },
    };

    await expectRepairedStrips("uno", repaired);
  });

  test("trims only PangYu's transparent trailing atlas columns", async () => {
    const repaired = {
      "idle-sit.png": { width: 1772, height: 887, hash: "4aeb031542e642f575e9256b6e844c76f94cdeb43e88a2f56d8d911a5dc3ace3" },
      "walk-slow-up.png": { width: 1464, height: 1073, hash: "b7c634d47c343821c95f9132388e52d9080ce4047b511a38e6196052ba39560f" },
      "search-seat.png": { width: 1980, height: 793, hash: "3b62f9f73d3b92c01f283b947afd8f6f1b57cd0bd97d30daeab6c4cffd613092" },
      "search-current-window.png": { width: 1772, height: 887, hash: "903ade0c789892f35edee37b5a170b8d03e8cd9a9271496f75c2b53f425089c3" },
      "search-desktop-icon.png": { width: 1772, height: 887, hash: "e25529e498389f7e0553748ce035b61be28868974f48ba7c8e4d9152f1c2dd83" },
      "seat-on-item.png": { width: 1584, height: 992, hash: "ef1a39cd7465eb582de05bdb14dc70b69f0948398732040064fefc4a8d6303ab" },
      "walk-slow-left.png": { width: 1772, height: 887, hash: "73e9ce8c1219c0b2992050c4491be8b05687e3c095485a1339053a437251ca24" },
      "walk-slow-right.png": { width: 1772, height: 887, hash: "3e27ef2666d516b29e725f8c29afc22058d593c190d1ffb1bd3c4cfc393e3a6f" },
      "ask-confirm.png": { width: 1656, height: 948, hash: "a34e24197eb38dc744e2007f487dc52e2c07f0184b12e98e2b0a354b98796f86" },
      "eat-normal.png": { width: 1704, height: 923, hash: "5e3507480d8f27b8d2681dac60b2bc7de4dca0156e28732988d18e538533648b" },
    };

    await expectRepairedStrips("uno-pangyu", repaired);
  });

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
