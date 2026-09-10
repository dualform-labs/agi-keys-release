type Task<Value> = (value: Value) => Promise<void>;

type QueueEntry<Owner, Value> = {
  owner: Owner;
  requested: { value: Value; task: Task<Value> } | undefined;
  promise: Promise<void>;
};

/**
 * Runs one task at a time for an owner while collapsing waiting work to the
 * latest request. A replacement owner gets an independent queue so stale work
 * can finish without blocking the replacement lifecycle.
 */
export class LatestTaskQueue<Key, Owner, Value> {
  private readonly entries = new Map<Key, QueueEntry<Owner, Value>>();

  request(key: Key, owner: Owner, value: Value, task: Task<Value>): Promise<void> {
    const active = this.entries.get(key);
    if (active?.owner === owner) {
      active.requested = { value, task };
      return active.promise;
    }

    const entry: QueueEntry<Owner, Value> = {
      owner,
      requested: { value, task },
      promise: Promise.resolve(),
    };
    this.entries.set(key, entry);
    entry.promise = Promise.resolve().then(async () => {
      let failure: unknown;
      try {
        while (entry.requested) {
          const latest = entry.requested;
          entry.requested = undefined;
          try {
            await latest.task(latest.value);
            failure = undefined;
          } catch (error) {
            failure = error;
          }
        }
        if (failure) throw failure;
      } finally {
        if (this.entries.get(key) === entry) this.entries.delete(key);
      }
    });
    return entry.promise;
  }

  detach(key: Key): void {
    this.entries.delete(key);
  }
}
