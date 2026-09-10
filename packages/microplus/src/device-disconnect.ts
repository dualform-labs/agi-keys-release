import { bridgeFailureCode } from "./bridge-error.js";

export type DisconnectInputReleaser = {
  releaseHeldInputs(): Promise<void>;
};

export type DisconnectDictationReleaser = {
  releaseAll(): Promise<void>;
};

export type DisconnectLogger = {
  error(message: string): void;
};

/** Release physical holds on device loss while keeping the plugin connection usable. */
export async function releaseOnDeviceDisconnect(
  inputs: DisconnectInputReleaser,
  globalDictation: DisconnectDictationReleaser,
  logger: DisconnectLogger,
): Promise<void> {
  const results = await Promise.allSettled([
    inputs.releaseHeldInputs(),
    globalDictation.releaseAll(),
  ]);
  const inputResult = results[0];
  const dictationResult = results[1];
  if (inputResult?.status === "rejected") {
    logger.error(`Held input disconnect release failed: ${bridgeFailureCode(inputResult.reason)}`);
  }
  if (dictationResult?.status === "rejected") {
    logger.error(`Global dictation disconnect release failed: ${bridgeFailureCode(dictationResult.reason)}`);
  }
}
