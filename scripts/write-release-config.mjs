import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export function buildReleaseConfig({ publicKey, windowsSignCommand }) {
  if (!publicKey?.trim()) throw new Error("缺少 TAURI_UPDATER_PUBLIC_KEY");
  const bundle = { createUpdaterArtifacts: true };
  if (windowsSignCommand?.trim()) {
    bundle.windows = { signCommand: windowsSignCommand };
  }
  return {
    bundle,
    plugins: {
      updater: {
        endpoints: [
          "https://github.com/iifor/useless/releases/latest/download/latest.json",
        ],
        pubkey: publicKey,
        windows: { installMode: "passive" },
      },
    },
  };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const output = "src-tauri/tauri.release.local.conf.json";
  const config = buildReleaseConfig({
    publicKey: process.env.TAURI_UPDATER_PUBLIC_KEY,
    windowsSignCommand: process.env.WINDOWS_SIGN_COMMAND,
  });
  await writeFile(output, `${JSON.stringify(config, null, 2)}\n`);
  console.log(`已生成 ${output}`);
}
