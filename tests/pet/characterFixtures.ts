import type { CharacterManifest } from "../../src/pet/characterManifest";

export const fullCharacter: CharacterManifest = {
  schemaVersion: 1,
  id: "uno",
  displayName: "Full Pet",
  version: "1.0.0",
  bundleId: "com.example.full-pet",
  description: "Full test character",
  idlePoses: ["idle-stand", "idle-sit", "idle-prone", "idle-lie"],
  capabilities: ["desktop-seat", "file-eating"],
};

export const reducedCharacter: CharacterManifest = {
  ...fullCharacter,
  id: "reduced",
  displayName: "Reduced Pet",
  bundleId: "com.example.reduced-pet",
  idlePoses: ["idle-stand", "idle-sit"],
};

export const minimalCharacter: CharacterManifest = {
  ...reducedCharacter,
  id: "minimal",
  displayName: "Minimal Pet",
  bundleId: "com.example.minimal-pet",
  capabilities: [],
};
