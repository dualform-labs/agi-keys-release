export type InputReleaseReason = "rollback" | "key-up";
type InputRelease = (reason: InputReleaseReason) => Promise<void>;

type HeldInput = {
  resourceId: string;
  release: InputRelease;
  /** Result of the down operation, retained until the matching release. */
  downResult: unknown;
};

export class InputOwnedError extends Error {
  constructor() { super("E_INPUT_OWNED"); }
}

/** Orders callbacks per Stream Deck action instance and arbitrates shared physical inputs. */
export class InputCoordinator {
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly heldByOwner = new Map<string, HeldInput>();
  private readonly ownerByResource = new Map<string, string>();

  enqueue<T>(ownerId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(ownerId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(task);
    this.queues.set(ownerId, current);
    void current.finally(() => {
      if (this.queues.get(ownerId) === current) this.queues.delete(ownerId);
    }).catch(() => undefined);
    return current;
  }

  press<T>(ownerId: string, resourceId: string, down: () => Promise<T>, release: InputRelease): Promise<T | undefined> {
    return this.enqueue(ownerId, async () => {
      const existing = this.heldByOwner.get(ownerId);
      if (existing) return existing.downResult as T | undefined;
      const currentOwner = this.ownerByResource.get(resourceId);
      if (currentOwner && currentOwner !== ownerId) throw new InputOwnedError();
      this.ownerByResource.set(resourceId, ownerId);
      const held: HeldInput = { resourceId, release, downResult: undefined };
      this.heldByOwner.set(ownerId, held);
      try {
        const result = await down();
        held.downResult = result;
        return result;
      } catch (error) {
        // A rejected down may have posted the physical event before its
        // observer failed. Release it before making the resource available.
        try { await release("rollback"); }
        catch { throw new Error("E_RELEASE_UNVERIFIED", { cause: error }); }
        this.heldByOwner.delete(ownerId);
        if (this.ownerByResource.get(resourceId) === ownerId) this.ownerByResource.delete(resourceId);
        throw error;
      }
    });
  }

  release(ownerId: string): Promise<unknown | undefined> {
    return this.enqueue(ownerId, async () => {
      const held = this.heldByOwner.get(ownerId);
      if (!held) return;
      // A failed release leaves physical state uncertain. Keep the callback
      // and ownership so key-up/disconnect can retry without a competing down.
      await held.release("key-up");
      this.heldByOwner.delete(ownerId);
      if (this.ownerByResource.get(held.resourceId) === ownerId) this.ownerByResource.delete(held.resourceId);
      return held.downResult;
    });
  }

  async pulse<T>(ownerId: string, resourceId: string, down: () => Promise<T>, release: InputRelease): Promise<T | undefined> {
    try {
      return await this.press(ownerId, resourceId, down, release);
    } finally {
      await this.release(ownerId);
    }
  }

  async releaseAll(): Promise<void> {
    const owners = new Set([...this.queues.keys(), ...this.heldByOwner.keys()]);
    await Promise.all([...owners].map((ownerId) => this.release(ownerId)));
  }
}
