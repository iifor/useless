import { describe, expect, it } from "vitest";

import {
  CHECK_INTERVAL_MS,
  IDLE_REQUIRED_SECONDS,
  IDLE_POLL_MS,
  STARTUP_DELAY_MS,
  runAutomaticUpdater,
  type UpdateBackend,
} from "../../src/update/updateScheduler";

const metadata = { currentVersion: "0.2.0", version: "0.2.1" };

describe("automatic updater", () => {
  it("checks after startup and retries every six hours when no update exists", async () => {
    const controller = new AbortController();
    const sleeps: number[] = [];
    let checks = 0;
    const backend: UpdateBackend = {
      idleSeconds: async () => 0,
      install: async () => undefined,
      prepare: async () => {
        checks += 1;
        return null;
      },
    };

    await runAutomaticUpdater({
      backend,
      isBusy: () => false,
      signal: controller.signal,
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
        if (sleeps.length === 3) controller.abort();
      },
    });

    expect(checks).toBe(2);
    expect(sleeps).toEqual([
      STARTUP_DELAY_MS,
      CHECK_INTERVAL_MS,
      CHECK_INTERVAL_MS,
    ]);
  });

  it("installs once only after five idle minutes and no pet interaction", async () => {
    const sleeps: number[] = [];
    const busy = [false, true, false];
    const idle = [IDLE_REQUIRED_SECONDS - 1, IDLE_REQUIRED_SECONDS];
    let installs = 0;
    let beforeInstall = 0;
    const backend: UpdateBackend = {
      prepare: async () => metadata,
      idleSeconds: async () => idle.shift() ?? IDLE_REQUIRED_SECONDS,
      install: async () => { installs += 1; },
    };

    await runAutomaticUpdater({
      backend,
      isBusy: () => busy.shift() ?? false,
      onBeforeInstall: () => { beforeInstall += 1; },
      signal: new AbortController().signal,
      sleep: async (milliseconds) => { sleeps.push(milliseconds); },
    });

    expect(sleeps).toEqual([
      STARTUP_DELAY_MS,
      IDLE_POLL_MS,
      IDLE_POLL_MS,
      IDLE_POLL_MS,
    ]);
    expect(beforeInstall).toBe(1);
    expect(installs).toBe(1);
  });

  it("logs a failed check and retries on the normal interval", async () => {
    const controller = new AbortController();
    const errors: unknown[] = [];
    let checks = 0;
    const backend: UpdateBackend = {
      idleSeconds: async () => 0,
      install: async () => undefined,
      prepare: async () => {
        checks += 1;
        if (checks === 1) throw new Error("offline");
        return null;
      },
    };

    await runAutomaticUpdater({
      backend,
      isBusy: () => false,
      onError: (error) => errors.push(error),
      signal: controller.signal,
      sleep: async (milliseconds) => {
        if (milliseconds === CHECK_INTERVAL_MS && checks === 2) controller.abort();
      },
    });

    expect(checks).toBe(2);
    expect(errors).toHaveLength(1);
  });
});
