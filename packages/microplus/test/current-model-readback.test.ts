import assert from "node:assert/strict";
import test from "node:test";
import {
  readNativeCurrentModel,
  selectNativeModelPickerOwner,
} from "../src/codex-micro-renderer-bridge.js";

type Fiber = {
  alternate: Fiber | null;
  child?: Fiber | null;
  memoizedProps?: Record<string, unknown>;
  return: Fiber | null;
  sibling?: Fiber | null;
  stateNode: any;
  tag?: number;
  type?: (...args: any[]) => unknown;
};

class BoundElement {
  children: BoundElement[] = [];
  contains(candidate: BoundElement): boolean {
    return candidate === this || this.children.some((child) => child.contains(candidate));
  }
}

function NativePIrFixture(props: {
  modelPickerTriggerConfig?: unknown;
  onBeforeSelectModel?: unknown;
  onSelectModel?: unknown;
  triggerButton?: unknown;
}): unknown {
  return [props.modelPickerTriggerConfig, props.onBeforeSelectModel, props.onSelectModel, props.triggerButton];
}

function ownerProps(model: string, displayName: string, selectionMode: "default" | "model" = "model") {
  return {
    model,
    models: [{ model, displayName }],
    selectionMode,
    onSelectModel: () => {},
    onOpenChange: () => {},
  };
}

function attachTree(options: {
  stale?: boolean;
  committedProps?: Record<string, unknown>;
  attachedProps?: Record<string, unknown>;
} = {}) {
  const composer = new BoundElement();
  const trigger = new BoundElement();
  composer.children.push(trigger);
  const committedProps = options.committedProps ?? ownerProps("gpt-6", "GPT-6 Astra");
  const attachedProps = options.attachedProps ?? committedProps;

  const committedRoot = { alternate: null, return: null, stateNode: null, tag: 3 } as Fiber;
  committedRoot.stateNode = { current: committedRoot };
  const committedComposer = { alternate: null, return: committedRoot, stateNode: composer } as Fiber;
  const committedOwner = {
    alternate: null,
    memoizedProps: committedProps,
    return: committedComposer,
    stateNode: null,
    type: NativePIrFixture,
  } as Fiber;
  const committedTrigger = { alternate: null, return: committedOwner, stateNode: trigger } as Fiber;
  committedRoot.child = committedComposer;
  committedComposer.child = committedOwner;
  committedOwner.child = committedTrigger;

  let attachedTrigger = committedTrigger;
  if (options.stale) {
    const attachedRoot = { alternate: committedRoot, return: null, stateNode: committedRoot.stateNode, tag: 3 } as Fiber;
    const attachedComposer = { alternate: committedComposer, return: attachedRoot, stateNode: composer } as Fiber;
    const attachedOwner = {
      alternate: committedOwner,
      memoizedProps: attachedProps,
      return: attachedComposer,
      stateNode: null,
      type: NativePIrFixture,
    } as Fiber;
    attachedTrigger = { alternate: committedTrigger, return: attachedOwner, stateNode: trigger } as Fiber;
    attachedRoot.child = attachedComposer;
    attachedComposer.child = attachedOwner;
    attachedOwner.child = attachedTrigger;
    committedRoot.alternate = attachedRoot;
    committedComposer.alternate = attachedComposer;
    committedOwner.alternate = attachedOwner;
    committedTrigger.alternate = attachedTrigger;
  }
  Object.defineProperty(trigger, "__reactFiber$readback", { configurable: true, value: attachedTrigger });
  return { composer, trigger, committedRoot, committedOwner, committedTrigger };
}

test("current-model readback returns canonical ID, native label, and selection mode only after asset verification", () => {
  const { composer, trigger } = attachTree({
    committedProps: ownerProps("provider:model@2026", "  Provider   Model  ", "default"),
  });
  assert.equal(readNativeCurrentModel(composer as unknown as Element, trigger as unknown as Element, false), null);
  assert.deepEqual(readNativeCurrentModel(composer as unknown as Element, trigger as unknown as Element, true), {
    modelId: "provider:model@2026",
    modelLabel: "Provider Model",
    selectionMode: "default",
  });
});

test("current-model readback normalizes a stale DOM fiber to the HostRoot committed branch", () => {
  const { composer, trigger } = attachTree({
    stale: true,
    attachedProps: ownerProps("old-model", "Old Model"),
    committedProps: ownerProps("new-model", "New Model"),
  });
  assert.deepEqual(readNativeCurrentModel(composer as unknown as Element, trigger as unknown as Element, true), {
    modelId: "new-model",
    modelLabel: "New Model",
    selectionMode: "model",
  });
});

test("native owner resolution fails closed for an invalid root, ambiguous fiber keys, and ambiguous owners", () => {
  {
    const { composer, trigger, committedRoot } = attachTree();
    committedRoot.stateNode.current = null;
    assert.equal(selectNativeModelPickerOwner(composer as unknown as Element, trigger as unknown as Element, true), null);
  }
  {
    const { composer, trigger } = attachTree();
    Object.defineProperty(trigger, "__reactFiber$other", { configurable: true, value: {} });
    assert.equal(selectNativeModelPickerOwner(composer as unknown as Element, trigger as unknown as Element, true), null);
  }
  {
    const { composer, trigger, committedOwner } = attachTree();
    const composerFiber = committedOwner.return!;
    const duplicate = {
      alternate: null,
      memoizedProps: ownerProps("other", "Other"),
      return: composerFiber,
      stateNode: null,
      type: NativePIrFixture,
    } as Fiber;
    composerFiber.child = duplicate;
    duplicate.child = committedOwner;
    committedOwner.return = duplicate;
    assert.equal(selectNativeModelPickerOwner(composer as unknown as Element, trigger as unknown as Element, true), null);
  }
  {
    const { composer, trigger, committedOwner } = attachTree();
    committedOwner.return!.stateNode = new BoundElement();
    assert.equal(selectNativeModelPickerOwner(composer as unknown as Element, trigger as unknown as Element, true), null);
  }
});

test("current-model readback accepts a committed bailout subtree shared with the old root", () => {
  const composer = new BoundElement();
  const trigger = new BoundElement();
  composer.children.push(trigger);

  const stateNode: { current: Fiber | null } = { current: null };
  const currentRoot = { alternate: null, return: null, stateNode, tag: 3 } as Fiber;
  const oldRoot = { alternate: currentRoot, return: null, stateNode, tag: 3 } as Fiber;
  currentRoot.alternate = oldRoot;
  stateNode.current = currentRoot;

  const sharedComposer = { alternate: null, return: oldRoot, stateNode: composer } as Fiber;
  const sharedOwner = {
    alternate: null,
    memoizedProps: ownerProps("shared-current", "Shared Current"),
    return: sharedComposer,
    stateNode: null,
    type: NativePIrFixture,
  } as Fiber;
  const sharedTrigger = { alternate: null, return: sharedOwner, stateNode: trigger } as Fiber;
  currentRoot.child = sharedComposer;
  oldRoot.child = sharedComposer;
  sharedComposer.child = sharedOwner;
  sharedOwner.child = sharedTrigger;
  Object.defineProperty(trigger, "__reactFiber$bailout", { configurable: true, value: sharedTrigger });

  assert.deepEqual(readNativeCurrentModel(composer as unknown as Element, trigger as unknown as Element, true), {
    modelId: "shared-current",
    modelLabel: "Shared Current",
    selectionMode: "model",
  });
});
