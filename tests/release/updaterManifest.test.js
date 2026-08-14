import { describe, expect, it } from "vitest";

import { validateUpdaterManifest } from "../../scripts/validate-updater-manifest.mjs";

function validManifest() {
  return {
    version: "0.2.1",
    platforms: {
      "darwin-aarch64": {
        signature: "mac-signature",
        url: "https://github.com/iifor/useless/releases/download/v0.2.1/UNO.app.tar.gz",
      },
      "darwin-x86_64": {
        signature: "mac-signature",
        url: "https://github.com/iifor/useless/releases/download/v0.2.1/UNO.app.tar.gz",
      },
      "windows-x86_64": {
        signature: "windows-signature",
        url: "https://github.com/iifor/useless/releases/download/v0.2.1/UNO-setup.nsis.zip",
      },
    },
  };
}

describe("updater release manifest", () => {
  it("accepts a complete stable manifest for the release tag", () => {
    expect(validateUpdaterManifest(validManifest(), "v0.2.1")).toBe(true);
  });

  it("rejects a manifest whose version differs from the release tag", () => {
    const manifest = validManifest();
    manifest.version = "0.2.0";
    expect(() => validateUpdaterManifest(manifest, "v0.2.1")).toThrow("版本不匹配");
  });

  it("rejects a missing platform or empty signature", () => {
    const missing = validManifest();
    delete missing.platforms["windows-x86_64"];
    expect(() => validateUpdaterManifest(missing, "v0.2.1")).toThrow("windows-x86_64");

    const unsigned = validManifest();
    unsigned.platforms["darwin-aarch64"].signature = "";
    expect(() => validateUpdaterManifest(unsigned, "v0.2.1")).toThrow("签名");
  });

  it("requires both macOS architectures to use the same universal artifact", () => {
    const manifest = validManifest();
    manifest.platforms["darwin-x86_64"].url += ".intel";
    expect(() => validateUpdaterManifest(manifest, "v0.2.1")).toThrow("Universal");
  });
});
