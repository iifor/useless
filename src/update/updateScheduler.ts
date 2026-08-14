export const STARTUP_DELAY_MS = 15_000;
export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1_000;
export const IDLE_POLL_MS = 30_000;
export const IDLE_REQUIRED_SECONDS = 5 * 60;

export interface UpdateMetadata {
  currentVersion: string;
  version: string;
}

export interface UpdateBackend {
  prepare(): Promise<UpdateMetadata | null>;
  idleSeconds(): Promise<number>;
  install(): Promise<void>;
}

interface AutomaticUpdaterOptions {
  backend: UpdateBackend;
  isBusy: () => boolean;
  onBeforeInstall?: () => void;
  onError?: (error: unknown) => void;
  signal: AbortSignal;
  sleep: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}

export async function runAutomaticUpdater({
  backend,
  isBusy,
  onBeforeInstall = () => undefined,
  onError = console.error,
  signal,
  sleep,
}: AutomaticUpdaterOptions): Promise<void> {
  await sleep(STARTUP_DELAY_MS, signal);
  while (!signal.aborted) {
    try {
      const update = await backend.prepare();
      if (update) {
        while (!signal.aborted) {
          await sleep(IDLE_POLL_MS, signal);
          if (signal.aborted) return;
          if (!isBusy() && await backend.idleSeconds() >= IDLE_REQUIRED_SECONDS) {
            onBeforeInstall();
            await backend.install();
            return;
          }
        }
      }
    } catch (error) {
      onError(error);
    }
    await sleep(CHECK_INTERVAL_MS, signal);
  }
}
