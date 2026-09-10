/** SDK feedback fields are JSON-shaped values keyed by the custom layout field. */
export type FeedbackPayload = Record<string, unknown>;

/**
 * Return the top-level fields whose values differ from the previous payload.
 *
 * The caller supplies complete payloads so an omitted field is not interpreted
 * as a reset. Explicit values such as "", 0, false, null, or a native color /
 * font object are preserved in the returned partial payload.
 */
export function feedbackDelta(previous: FeedbackPayload | undefined, next: FeedbackPayload): FeedbackPayload {
  if (previous == null) return { ...next };

  const delta: FeedbackPayload = {};
  for (const key of Object.keys(next)) {
    if (!deepEqual(previous[key], next[key])) delta[key] = next[key];
  }
  return delta;
}

function deepEqual(left: unknown, right: unknown, seen = new WeakMap<object, object>()): boolean {
  if (Object.is(left, right)) return true;
  if (typeof left !== "object" || left === null || typeof right !== "object" || right === null) return false;

  const paired = seen.get(left);
  if (paired === right) return true;
  seen.set(left, right);

  const leftIsArray = Array.isArray(left);
  if (leftIsArray !== Array.isArray(right)) return false;
  if (leftIsArray) {
    const leftArray = left as unknown[];
    const rightArray = right as unknown[];
    if (leftArray.length !== rightArray.length) return false;
    return leftArray.every((value, index) => deepEqual(value, rightArray[index], seen));
  }

  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord);
  const rightKeys = Object.keys(rightRecord);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key) => Object.prototype.hasOwnProperty.call(rightRecord, key)
    && deepEqual(leftRecord[key], rightRecord[key], seen));
}
