import { readFile } from "node:fs/promises";

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
});
