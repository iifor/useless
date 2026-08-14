import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const requiredPlatforms = [
  "darwin-aarch64",
  "darwin-x86_64",
  "windows-x86_64",
];

export function validateUpdaterManifest(manifest, tag) {
  const expectedVersion = tag.replace(/^v/, "");
  if (manifest?.version !== expectedVersion) {
    throw new Error(`latest.json 版本不匹配：${manifest?.version} !== ${expectedVersion}`);
  }

  for (const platform of requiredPlatforms) {
    const entry = manifest.platforms?.[platform];
    if (!entry) throw new Error(`latest.json 缺少平台：${platform}`);
    if (!entry.signature?.trim()) throw new Error(`${platform} 缺少更新签名`);
    if (!entry.url?.startsWith("https://")) throw new Error(`${platform} 更新地址必须使用 HTTPS`);
  }

  if (
    manifest.platforms["darwin-aarch64"].url !==
    manifest.platforms["darwin-x86_64"].url
  ) {
    throw new Error("macOS 两个架构必须指向同一个 Universal 更新包");
  }
  return true;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const [file, tag] = process.argv.slice(2);
  if (!file || !tag) throw new Error("Usage: validate-updater-manifest <latest.json> <vX.Y.Z>");
  const manifest = JSON.parse(await readFile(file, "utf8"));
  validateUpdaterManifest(manifest, tag);
  console.log(`已验证 ${tag} 的 latest.json`);
}
