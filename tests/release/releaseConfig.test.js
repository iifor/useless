import { describe, expect, it } from "vitest";

import { buildReleaseConfig } from "../../scripts/write-release-config.mjs";

describe("release-only Tauri configuration", () => {
  it("enables signed updater artifacts and the stable GitHub endpoint", () => {
    expect(buildReleaseConfig({ publicKey: "RWQ-public-key" })).toEqual({
      bundle: { createUpdaterArtifacts: true },
      plugins: {
        updater: {
          endpoints: [
            "https://github.com/iifor/useless/releases/latest/download/latest.json",
          ],
          pubkey: "RWQ-public-key",
          windows: { installMode: "passive" },
        },
      },
    });
  });

  it("adds the Azure sign command only to Windows release builds", () => {
    const config = buildReleaseConfig({
      publicKey: "RWQ-public-key",
      windowsSignCommand: "artifact-signing-cli %1",
    });

    expect(config.bundle.windows.signCommand).toBe("artifact-signing-cli %1");
  });

  it("refuses to build a release configuration without the updater public key", () => {
    expect(() => buildReleaseConfig({ publicKey: "" })).toThrow("TAURI_UPDATER_PUBLIC_KEY");
  });
});
