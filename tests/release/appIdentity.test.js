import { readFile } from "node:fs/promises";

import { describe, expect, test } from "vitest";

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));

describe("UNO Yan application identity", () => {
  test("uses independent package and bundle identity", async () => {
    const pkg = await readJson("package.json");
    const tauri = await readJson("src-tauri/tauri.conf.json");
    const cargo = await readFile("src-tauri/Cargo.toml", "utf8");
    const main = await readFile("src-tauri/src/main.rs", "utf8");
    const positions = await readFile("src-tauri/src/instance_position.rs", "utf8");

    expect(pkg).toMatchObject({ name: "uno-yan-desktop", version: "0.1.0" });
    expect(tauri).toMatchObject({
      productName: "UNO Yan",
      version: "0.1.0",
      identifier: "com.iifor.uno-yan",
    });
    expect(cargo).toContain('name = "uno-yan"');
    expect(cargo).toContain('description = "UNO Yan desktop pet"');
    expect(main).not.toMatch(/PangYu/);
    expect(positions).toContain("UNO-Yan-Pet-Slot");
    expect(positions).not.toMatch(/PangYu/);
  });

  test("does not enable automatic updates", async () => {
    const pkg = await readJson("package.json");
    const tauri = await readJson("src-tauri/tauri.conf.json");

    expect(pkg.dependencies).not.toHaveProperty("@tauri-apps/plugin-updater");
    expect(JSON.stringify(tauri)).not.toMatch(/updater|releases\/latest/i);
  });
});
