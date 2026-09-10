import type { MicroActionSlot, MicroLayout, MicroLayoutSlot } from "./types.js";

export type EffectivePhysicalBinding = NonNullable<MicroLayout["slots"][MicroLayoutSlot]>;

/**
 * Resolve a physical Micro action against the native microphone layout rules.
 *
 * With separate microphone keys disabled, the native wide key is represented by
 * ACT10_ACT11. ACT10 and ACT11 entries in that same snapshot are stale
 * per-switch details: ACT10 uses the composite binding and ACT11 is inactive.
 * Do not fall back to either stale entry when the composite binding is absent.
 * Older snapshots without the flag retain their direct-slot behavior.
 */
export function resolveEffectivePhysicalSlot(
  layout: MicroLayout,
  slot: MicroActionSlot,
): EffectivePhysicalBinding | undefined {
  if (layout.separateMicrophoneKeys === false) {
    if (slot === "ACT11") return undefined;
    if (slot === "ACT10") return layout.slots.ACT10_ACT11;
  }
  return layout.slots[slot];
}
