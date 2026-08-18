import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { prepareCharacterBuild } from "./scripts/pet-build.mjs";

const node = globalThis as typeof globalThis & {
  process: { cwd(): string; env: Record<string, string | undefined> };
};

export async function characterViteSettings(root: string, id: string) {
  const { manifest, publicDir } = await prepareCharacterBuild(root, id);
  return { manifest, publicDir };
}

export function requireCharacterId(environment: Record<string, string | undefined>): string {
  const id = environment.PET_CHARACTER;
  if (!id) throw new Error("缺少 PET_CHARACTER；请使用 pnpm pet:dev <id> 或 pnpm pet:build <id>");
  return id;
}

export default defineConfig(async ({ mode }) => {
  const test = mode === "test" || Boolean(node.process.env.VITEST);
  if (test) return { plugins: [react()], clearScreen: false };
  const id = requireCharacterId(node.process.env);
  const { manifest, publicDir } = await characterViteSettings(node.process.cwd(), id);
  return {
    plugins: [react()],
    clearScreen: false,
    publicDir,
    define: { __PET_CHARACTER__: JSON.stringify(manifest) },
    server: { strictPort: true },
  };
});
