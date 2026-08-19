import { mkdtemp, mkdir, readdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { inflateSync } from "node:zlib";

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
  await Promise.all(strips.map((strip) => writeFile(
    join(stripsRoot, `${strip}.png`),
    png(options.pngByStrip?.[strip] ?? options.png),
  )));
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

async function opaqueBoundaryCounts(path, frameCount) {
  const file = await readFile(path);
  const width = file.readUInt32BE(16);
  const height = file.readUInt32BE(20);
  const idat = [];
  for (let offset = 8; offset < file.length;) {
    const length = file.readUInt32BE(offset);
    if (file.subarray(offset + 4, offset + 8).toString("ascii") === "IDAT") {
      idat.push(file.subarray(offset + 8, offset + 8 + length));
    }
    offset += 12 + length;
  }
  const encoded = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const rgba = Buffer.alloc(stride * height);
  const paeth = (left, up, upperLeft) => {
    const estimate = left + up - upperLeft;
    const leftDistance = Math.abs(estimate - left);
    const upDistance = Math.abs(estimate - up);
    const upperLeftDistance = Math.abs(estimate - upperLeft);
    return leftDistance <= upDistance && leftDistance <= upperLeftDistance
      ? left
      : upDistance <= upperLeftDistance ? up : upperLeft;
  };
  for (let y = 0, source = 0; y < height; y += 1) {
    const filter = encoded[source++];
    for (let x = 0; x < stride; x += 1) {
      const left = x >= 4 ? rgba[y * stride + x - 4] : 0;
      const up = y > 0 ? rgba[(y - 1) * stride + x] : 0;
      const upperLeft = y > 0 && x >= 4 ? rgba[(y - 1) * stride + x - 4] : 0;
      const predictor = [0, left, up, Math.floor((left + up) / 2), paeth(left, up, upperLeft)][filter];
      rgba[y * stride + x] = (encoded[source++] + predictor) & 0xff;
    }
  }
  const slotWidth = width / frameCount;
  return Array.from({ length: frameCount - 1 }, (_, index) => {
    const x = slotWidth * (index + 1);
    return Array.from({ length: height }, (_unused, y) => rgba[y * stride + x * 4 + 3])
      .filter((alpha) => alpha > 0).length;
  });
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
        animationOverrides: {
          "walk-slow-left": { frameCount: 8, fps: 8 },
          "walk-slow-right": { frameCount: 8, fps: 8 },
          "walk-slow-up": { frameCount: 8, fps: 8 },
          "walk-slow-down": { frameCount: 8, fps: 8 },
          "eat-normal": { frameCount: 6, fps: 6 },
        },
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
      "search-seat.png": { width: 1980, height: 793, hash: "3b62f9f73d3b92c01f283b947afd8f6f1b57cd0bd97d30daeab6c4cffd613092" },
      "search-current-window.png": { width: 1772, height: 887, hash: "903ade0c789892f35edee37b5a170b8d03e8cd9a9271496f75c2b53f425089c3" },
      "search-desktop-icon.png": { width: 1772, height: 887, hash: "e25529e498389f7e0553748ce035b61be28868974f48ba7c8e4d9152f1c2dd83" },
      "seat-on-item.png": { width: 1584, height: 992, hash: "ef1a39cd7465eb582de05bdb14dc70b69f0948398732040064fefc4a8d6303ab" },
      "ask-confirm.png": { width: 1656, height: 948, hash: "a34e24197eb38dc744e2007f487dc52e2c07f0184b12e98e2b0a354b98796f86" },
    };

    await expectRepairedStrips("uno-pangyu", repaired);
  });

  test("ships PangYu's approved smoother animation contract", async () => {
    const pangYu = JSON.parse(await readFile(
      join(packageRoot, "uno-pangyu", "character.json"),
      "utf8",
    ));
    expect(pangYu.animationOverrides).toEqual({
      "walk-slow-left": { frameCount: 8, fps: 8 },
      "walk-slow-right": { frameCount: 8, fps: 8 },
      "walk-slow-up": { frameCount: 8, fps: 8 },
      "walk-slow-down": { frameCount: 8, fps: 8 },
      "eat-normal": { frameCount: 6, fps: 6 },
    });
    await expectRepairedStrips("uno-pangyu", {
      "walk-slow-left.png": { width: 1536, height: 1024, hash: "c5892ef5597b5f64ed063ebbbb96c0a9edca050f13d2c9ed9ab4c3c27ba3e99b" },
      "walk-slow-right.png": { width: 1536, height: 1024, hash: "20cdc89d6888124e7cfd5537e16db2bf0e9271e697a4e33ecc45ca2c73076b11" },
      "walk-slow-up.png": { width: 1536, height: 1024, hash: "c236db37e7d6287fa6e6c5cf8dc2021d000796862833bc73ce2802d273a481fb" },
      "walk-slow-down.png": { width: 1536, height: 1024, hash: "6fa7d635661f6fc83beb59b4de90aff54817343de72778f8326dba2043824061" },
      "eat-normal.png": { width: 1536, height: 1024, hash: "b09c3cec12f321d148056c00c6cf5208ae91c1c1cd163678dbcdddc3b78eec8c" },
    });
    await expect(validateCharacterPackage(packageRoot, "uno-pangyu")).resolves.toEqual([]);
  });

  test("keeps PangYu animation frame boundaries transparent", async () => {
    for (const [name, frameCount] of Object.entries({
      "walk-slow-left": 8,
      "walk-slow-right": 8,
      "walk-slow-up": 8,
      "walk-slow-down": 8,
      "eat-normal": 6,
    })) {
      await expect(opaqueBoundaryCounts(
        join(packageRoot, "uno-pangyu", "pet", "extended-animations", `${name}.png`),
        frameCount,
      )).resolves.toEqual(Array(frameCount - 1).fill(0));
    }
  });

  test("keeps retained canonical sources at the public package root", async () => {
    await expect(sha256(join(packageRoot, "uno-pangyu", "canonical-base.png"))).resolves.toBe("9cb76148734e8f3e7b491a7714ad8f992b8f4084eb6d42c4577d8af211fd3363");
    await expect(sha256(join(packageRoot, "uno-yan", "canonical-base.png"))).resolves.toBe("c64747170d7ed7971ee01aa46f27aaccc5258a1ea481769c0ddf705bff92e525");
    await expect(readFile(join(packageRoot, "uno", "canonical-base.png"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(join(packageRoot, "uno-pangyu", "qa", "canonical.png"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(join(packageRoot, "uno-yan", "qa", "canonical.png"))).rejects.toMatchObject({ code: "ENOENT" });
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

  test("validates each strip against its configured frame count", async () => {
    const root = await tempRoot();
    await writePackage(root, "valid-pet", {
      manifest: {
        capabilities: ["file-eating"],
        animationOverrides: {
          "walk-slow-left": { frameCount: 8, fps: 8 },
          "eat-normal": { frameCount: 6, fps: 6 },
        },
      },
      pngByStrip: {
        "walk-slow-left": { width: 16 },
        "eat-normal": { width: 12 },
      },
    });

    await expect(validateCharacterPackage(join(root, "characters"), "valid-pet"))
      .resolves.toEqual([]);
  });

  test("rejects a strip width that matches four frames but not its override", async () => {
    const root = await tempRoot();
    await writePackage(root, "valid-pet", {
      manifest: {
        animationOverrides: {
          "walk-slow-left": { frameCount: 8, fps: 8 },
        },
      },
      pngByStrip: { "walk-slow-left": { width: 12 } },
    });

    await expect(validateCharacterPackage(join(root, "characters"), "valid-pet"))
      .resolves.toEqual(expect.arrayContaining([
        expect.stringContaining("width must be divisible by 8"),
      ]));
  });

  test.each([
    ["unknown action", { dance: { frameCount: 8, fps: 8 } }, "unknown animation"],
    ["zero frames", { "walk-slow-left": { frameCount: 0, fps: 8 } }, "frameCount"],
    ["fractional frames", { "walk-slow-left": { frameCount: 1.5, fps: 8 } }, "frameCount"],
    ["too many frames", { "walk-slow-left": { frameCount: 17, fps: 8 } }, "frameCount"],
    ["zero fps", { "walk-slow-left": { frameCount: 8, fps: 0 } }, "fps"],
    ["fractional fps", { "walk-slow-left": { frameCount: 8, fps: 1.5 } }, "fps"],
    ["too much fps", { "walk-slow-left": { frameCount: 8, fps: 25 } }, "fps"],
  ])("rejects animation override %s", async (_name, animationOverrides, expected) => {
    const root = await tempRoot();
    await writePackage(root, "valid-pet", { manifest: { animationOverrides } });
    await expect(validateCharacterPackage(join(root, "characters"), "valid-pet"))
      .resolves.toEqual(expect.arrayContaining([expect.stringContaining(expected)]));
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
