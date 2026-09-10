import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import WebSocket from 'ws';
import { Cdp } from './cdp.js';
import { validateNativeEvent, type NativeMapping } from './native-event.js';

const exec = promisify(execFile);

export const BUILD = {
  version: '26.901.51231',
  asarHash: '64fc2f27d2dddfa968acfacbe5e4e0328071bdc406351ff4a7d18f0b4692c83d',
  executable: '/Applications/ChatGPT.app/Contents/MacOS/ChatGPT',
};

export interface OwnedEndpoint {
  pid: number;
  port: number;
  version: string;
  asarHash: string;
}

export interface NativeSlot {
  id: number;
  threadKey: string | null;
  title: string | null;
  status: string;
  selected: boolean;
}

const NATIVE_SLOT_STATUSES = new Set([
  'off',
  'error',
  'idle',
  'working',
  'unread',
  'awaiting-approval',
  'awaiting-response',
]);

function isNativeSlot(value: unknown, id: number): value is NativeSlot {
  if (!value || typeof value !== 'object') return false;
  const slot = value as Partial<NativeSlot>;
  return slot.id === id
    && (slot.threadKey === null || typeof slot.threadKey === 'string')
    && (slot.title === null || typeof slot.title === 'string')
    && typeof slot.selected === 'boolean'
    && typeof slot.status === 'string'
    && NATIVE_SLOT_STATUSES.has(slot.status);
}

export function parseSlots(value: unknown): NativeSlot[] {
  if (!Array.isArray(value) || value.length !== 6) {
    throw Error('Native six-slot store unavailable');
  }
  return value.map((slot, id) => {
    if (!isNativeSlot(slot, id)) throw Error('Invalid native slot shape');
    return {
      id: slot.id,
      threadKey: slot.threadKey,
      title: slot.title,
      status: slot.status,
      selected: slot.selected,
    };
  });
}

export function validateEndpoint(endpoint: OwnedEndpoint): void {
  if (
    !Number.isInteger(endpoint.pid)
    || endpoint.pid < 1
    || !Number.isInteger(endpoint.port)
    || endpoint.port < 1024
    || endpoint.port > 65535
    || endpoint.version !== BUILD.version
    || endpoint.asarHash !== BUILD.asarHash
  ) {
    throw Error('Unrecognized owned Codex endpoint/build');
  }
}

export async function launchPreflight() {
  const [{ stdout }, bytes] = await Promise.all([
    exec('/bin/ps', ['-axo', 'pid=,comm=']),
    readFile('/Applications/ChatGPT.app/Contents/Resources/app.asar'),
  ]);
  const running = stdout.split('\n').filter((line) => line.trim().endsWith(BUILD.executable));
  const hash = createHash('sha256').update(bytes).digest('hex');
  return {
    allowed: running.length === 0 && hash === BUILD.asarHash,
    running: running.length > 0,
    buildMatched: hash === BUILD.asarHash,
    reason: running.length
      ? 'Codex is running. Save your work and manually quit before dedicated launch.'
      : hash !== BUILD.asarHash
        ? 'Unsupported Codex build'
        : 'Ready for explicit dedicated launch',
    argv: [BUILD.executable, '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0'],
    automaticallyRestarted: false,
  };
}

// Read-only acquisition of the actual React scope store. No alternate store is created.
// app-initial d0t (Db) stores {scope,get,set,node} in a useRef; V1t is that scope.
const context = `const m=await import('/assets/app-initial-cadb12d4a15e.js');const s=await import('/assets/codex-micro-slot-signals-126fe72fdb24.js');if(!s.n)throw Error('Native slot module is not initialized');const bus=m.Kun;if(!bus?.handlers?.get('codex-micro-hid-event')?.size||!bus?.handlers?.get('codex-micro-joystick-event')?.size)throw Error('Native Micro handlers not mounted');let stores=new Set(),seen=new Set();function inspect(v){if(v?.current?.scope===m.V1t&&typeof v.current.get==='function')stores.add(v.current)}function walk(f){if(!f||seen.has(f))return;seen.add(f);for(let h=f.memoizedState,n=0;h&&n++<500;h=h.next)inspect(h.memoizedState);walk(f.child);walk(f.sibling)}for(const el of document.querySelectorAll('*'))for(const k of Object.keys(el))if(k.startsWith('__reactFiber$'))walk(el[k]);let candidates=[];for(const store of stores){try{let slots=store.get(s.n);if(Array.isArray(slots)&&slots.length===6)candidates.push({store,slots})}catch{}}if(!candidates.length)throw Error('Native Micro store not mounted');const signatures=new Set(candidates.map(c=>JSON.stringify(c.slots)));if(signatures.size!==1)throw Error('Ambiguous native Micro stores');const {store}=candidates[0];`;

interface CdpTarget {
  type: string;
  url: string;
  webSocketDebuggerUrl: string;
}

export class DesktopAdapter {
  private readonly heldAct = new Set<string>();
  private cdp?: Cdp;
  private reason = 'Dedicated Codex launch required; no owned endpoint configured';

  constructor(
    private readonly endpoint?: OwnedEndpoint,
    private readonly mapping?: NativeMapping,
  ) {}

  capability() {
    return {
      available: !!this.cdp,
      backend: 'native-desktop',
      reason: this.cdp ? null : this.reason,
      commands: ['native.key', 'native.encoder', 'native.joystick'],
      runtimeVerified: false,
    };
  }

  async connect(): Promise<void> {
    try {
      if (!this.endpoint) throw Error(this.reason);
      const endpoint = this.endpoint;
      validateEndpoint(endpoint);

      const { stdout } = await exec('/bin/ps', [
        '-p',
        String(endpoint.pid),
        '-o',
        'uid=,comm=,args=',
      ]);
      if (
        !stdout.trim().startsWith(String(process.getuid?.()))
        || !stdout.includes(BUILD.executable)
        || !stdout.includes('--remote-debugging-port=')
      ) {
        throw Error('PID is not owned dedicated Codex');
      }

      const hash = createHash('sha256')
        .update(await readFile('/Applications/ChatGPT.app/Contents/Resources/app.asar'))
        .digest('hex');
      if (hash !== endpoint.asarHash) throw Error('Codex bundle changed');

      const { stdout: listeners } = await exec('/usr/sbin/lsof', [
        '-nP',
        '-a',
        '-p',
        String(endpoint.pid),
        '-iTCP:' + endpoint.port,
        '-sTCP:LISTEN',
      ]);
      if (!listeners.includes('127.0.0.1:' + endpoint.port)) {
        throw Error('CDP listener is not owned loopback endpoint');
      }

      const response = await fetch(`http://127.0.0.1:${endpoint.port}/json/list`, {
        signal: AbortSignal.timeout(3000),
      });
      const targets = await response.json() as CdpTarget[];
      const main = targets.filter(
        (target) => target.type === 'page' && /^app:\/\/[^/]+\/index\.html(?:[?#].*)?$/.test(target.url),
      );
      if (main.length !== 1) throw Error('Expected exactly one Codex main renderer');

      const url = new URL(main[0].webSocketDebuggerUrl);
      if (url.protocol !== 'ws:' || url.hostname !== '127.0.0.1' || Number(url.port) !== endpoint.port) {
        throw Error('Unexpected CDP target endpoint');
      }

      const socket = new WebSocket(url, { handshakeTimeout: 3000, maxPayload: 1024 * 1024 });
      await new Promise<void>((resolve, reject) => {
        socket.once('open', resolve);
        socket.once('error', reject);
      });
      this.cdp = new Cdp(socket);
      await this.snapshot();
    } catch (error) {
      this.close();
      this.reason = (error as Error).message;
      throw error;
    }
  }

  async snapshot() {
    if (!this.cdp) throw Error(this.reason);
    const slots = await this.cdp.evaluate(
      `(async()=>{${context}return store.get(s.n).map(({id,threadKey,title,status,selected})=>({id,threadKey,title,status,selected}))})()`,
    );
    return { backend: 'native-desktop', slots: parseSlots(slots) };
  }

  async execute(commandId: string, args: Record<string, unknown> = {}) {
    if (!this.cdp) throw Error(this.reason);

    const { event, type } = validateNativeEvent(commandId, args, this.mapping, BUILD.asarHash);
    const eventKey = String(event.key);
    const release = commandId === 'native.key'
      && eventKey.startsWith('ACT')
      && event.act === 0
      && this.heldAct.has(eventKey);
    const selected = args.expectedThreadKey;
    if (!release && event.slot === undefined && typeof selected !== 'string') {
      throw Error('Selected thread binding required');
    }
    if (commandId === 'native.key' && eventKey.startsWith('ACT') && event.act === 1) {
      this.heldAct.add(eventKey);
    }

    await this.cdp.evaluate(
      `(async()=>{${context}const event=${JSON.stringify(event)},slots=store.get(s.n);if(event.slot!==undefined){if(slots[event.slot]?.threadKey!==event.threadKey)throw Error('Slot binding changed')}else if(!${JSON.stringify(release)}&&!slots.some(x=>x.selected&&x.threadKey===${JSON.stringify(selected ?? null)}))throw Error('Selected thread changed');bus.dispatchHostMessage({type:${JSON.stringify(type)},event});return true})()`,
    );

    if (release) this.heldAct.delete(eventKey);
    if (event.slot !== undefined && event.act === 1) {
      const after = await this.snapshot();
      const observed = after.slots.some(
        (slot) => slot.selected && slot.threadKey === event.threadKey,
      );
      return {
        dispatched: true,
        observed,
        backend: 'native-desktop',
        reason: observed ? null : 'Native selection not yet observed; do not retry automatically',
      };
    }
    return {
      dispatched: true,
      observed: false,
      backend: 'native-desktop',
      reason: 'Native handler dispatched; downstream effect requires observation',
    };
  }

  async releaseHeld() {
    const results = [];
    for (const key of [...this.heldAct]) {
      results.push(await this.execute('native.key', { key, act: 0 }));
    }
    return results;
  }

  close(): void {
    this.cdp?.close();
    this.cdp = undefined;
  }
}

export async function readOwnedEndpoint(path: string): Promise<OwnedEndpoint> {
  const stat = await lstat(path);
  if (
    !stat.isFile()
    || stat.isSymbolicLink()
    || stat.uid !== process.getuid?.()
    || (stat.mode & 0o077) !== 0
  ) {
    throw Error('Endpoint descriptor must be owner-only regular file');
  }
  const endpoint = JSON.parse(await readFile(path, 'utf8')) as OwnedEndpoint;
  validateEndpoint(endpoint);
  return endpoint;
}
