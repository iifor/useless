import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { inflateSync } from "node:zlib";

import { describe, expect, test } from "vitest";

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));

describe("shared application identity", () => {
  test("uses a neutral engine package identity", async () => {
    const pkg = await readJson("package.json");
    const tauri = await readJson("src-tauri/tauri.conf.json");
    const cargo = await readFile("src-tauri/Cargo.toml", "utf8");
    const main = await readFile("src-tauri/src/main.rs", "utf8");
    const positions = await readFile("src-tauri/src/instance_position.rs", "utf8");

    expect(pkg).toMatchObject({ name: "pet-desktop-engine", version: "0.1.0" });
    expect(tauri).toMatchObject({
      productName: "Pet Desktop Engine",
      version: "0.1.0",
      identifier: "com.iifor.pet-desktop-engine",
    });
    expect(tauri.bundle).not.toHaveProperty("icon");
    expect(cargo).toContain('name = "pet-desktop-engine"');
    expect(cargo).toContain('description = "Shared desktop pet engine"');
    expect(main).not.toMatch(/UNO|Yan|PangYu/);
    expect(positions).not.toMatch(/UNO|Yan|PangYu/);
  });

  test("does not enable automatic updates", async () => {
    const pkg = await readJson("package.json");
    const tauri = await readJson("src-tauri/tauri.conf.json");

    expect(pkg.dependencies).not.toHaveProperty("@tauri-apps/plugin-updater");
    expect(JSON.stringify(tauri)).not.toMatch(/updater|releases\/latest/i);
  });

  test("keeps only a transparent build-time fallback distinct from role icons", async () => {
    const fallback = await readFile("src-tauri/icons/icon.png");
    expect(fallback.subarray(12, 16).toString("ascii")).toBe("IHDR");
    expect([...fallback.subarray(16, 26)]).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 8, 6]);

    const idat = [];
    for (let offset = 8; offset < fallback.length;) {
      const length = fallback.readUInt32BE(offset);
      if (fallback.subarray(offset + 4, offset + 8).toString("ascii") === "IDAT") {
        idat.push(fallback.subarray(offset + 8, offset + 8 + length));
      }
      offset += 12 + length;
    }
    expect([...inflateSync(Buffer.concat(idat))]).toEqual([0, 0, 0, 0, 0]);

    const fallbackHash = createHash("sha256").update(fallback).digest("hex");
    for (const id of ["uno", "uno-pangyu", "uno-yan"]) {
      const roleIcon = await readFile(`characters/${id}/icons/icon.png`);
      expect(fallbackHash).not.toBe(createHash("sha256").update(roleIcon).digest("hex"));
    }
  });
});
