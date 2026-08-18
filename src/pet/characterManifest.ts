export type IdlePose = "idle-stand" | "idle-sit" | "idle-prone" | "idle-lie";

export type CharacterCapability = "desktop-seat" | "file-eating";

export interface CharacterManifest {
  schemaVersion: 1;
  id: string;
  displayName: string;
  version: string;
  bundleId: string;
  description: string;
  idlePoses: IdlePose[];
  capabilities: CharacterCapability[];
}
