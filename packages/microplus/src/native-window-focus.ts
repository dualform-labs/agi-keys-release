import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";

export type NativeWindowRegistration = Readonly<{
  token: string;
  revision: number;
  pid: number;
  bundleId: string;
}>;

type NativeWindowFocusAction = "capture" | "verify-capture" | "focus" | "reset";

export type NativeWindowFocusRequest = Readonly<{
  requestId: string;
  action: NativeWindowFocusAction;
  pid?: number;
  bundleId?: string;
  token?: string;
  revision?: number;
}>;

export type NativeWindowFocusResponse = Readonly<{
  requestId: string;
  ok: boolean;
  token?: string;
  revision?: number;
  error?: string;
}>;

export interface NativeWindowFocusTransport {
  request(request: NativeWindowFocusRequest, timeoutMs: number): Promise<NativeWindowFocusResponse>;
  close(): Promise<void>;
}

export class NativeWindowFocusClient {
  private readonly registrations = new Map<string, NativeWindowRegistration>();
  private stopped = false;

  constructor(
    private readonly transport: NativeWindowFocusTransport,
    private readonly timeoutMs = 1_500,
  ) {}

  async capture(pid: number, bundleId: string): Promise<NativeWindowRegistration> {
    this.assertRunning();
    assertApplicationIdentity(pid, bundleId);
    const response = await this.send({ action: "capture", pid, bundleId });
    if (!isOpaqueToken(response.token) || !isRevision(response.revision)) {
      throw new Error("E_WINDOW_FOCUS_RESPONSE_INVALID");
    }
    const registration = { token: response.token, revision: response.revision, pid, bundleId } as const;
    this.registrations.set(registration.token, registration);
    return registration;
  }

  async verifyCapture(registration: NativeWindowRegistration): Promise<void> {
    await this.registeredRequest("verify-capture", registration);
  }

  async focus(registration: NativeWindowRegistration): Promise<void> {
    await this.registeredRequest("focus", registration);
  }

  async reset(): Promise<void> {
    this.assertRunning();
    await this.send({ action: "reset" });
    this.registrations.clear();
  }

  async close(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.registrations.clear();
    await this.transport.close();
  }

  private async registeredRequest(
    action: "verify-capture" | "focus",
    registration: NativeWindowRegistration,
  ): Promise<void> {
    this.assertRunning();
    const held = this.registrations.get(registration.token);
    if (!held || held !== registration) throw new Error("E_WINDOW_FOCUS_REGISTRATION_STALE");
    await this.send({ action, ...registration });
  }

  private async send(request: Omit<NativeWindowFocusRequest, "requestId">): Promise<NativeWindowFocusResponse> {
    const requestId = randomUUID();
    const response = await this.transport.request({ requestId, ...request }, this.timeoutMs);
    if (response.requestId !== requestId || response.ok !== true) {
      throw new Error(response.requestId === requestId && isFailureCode(response.error)
        ? response.error
        : "E_WINDOW_FOCUS_RESPONSE_INVALID");
    }
    return response;
  }

  private assertRunning(): void {
    if (this.stopped) throw new Error("E_WINDOW_FOCUS_HELPER_STOPPED");
  }
}

export function launchNativeWindowFocusClient(
  executablePath: string,
  timeoutMs = 1_500,
): NativeWindowFocusClient {
  if (!executablePath.startsWith("/")) throw new Error("E_WINDOW_FOCUS_HELPER_PATH_INVALID");
  return new NativeWindowFocusClient(new JsonLineNativeWindowFocusTransport(executablePath), timeoutMs);
}

export class JsonLineNativeWindowFocusTransport implements NativeWindowFocusTransport {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<string, {
    finish: (error: Error | undefined, response?: NativeWindowFocusResponse) => void;
  }>();
  private output = "";
  private terminalError: Error | undefined;

  constructor(executablePath: string) {
    this.child = spawn(executablePath, [], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      shell: false,
    });
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => this.onOutput(chunk));
    this.child.stderr.resume();
    this.child.once("error", () => this.fail(new Error("E_WINDOW_FOCUS_HELPER_FAILED")));
    this.child.once("exit", () => this.fail(new Error("E_WINDOW_FOCUS_HELPER_EXITED")));
  }

  request(request: NativeWindowFocusRequest, timeoutMs: number): Promise<NativeWindowFocusResponse> {
    if (this.terminalError) return Promise.reject(this.terminalError);
    if (this.pending.has(request.requestId)) return Promise.reject(new Error("E_WINDOW_FOCUS_REQUEST_DUPLICATE"));
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => finish(new Error("E_WINDOW_FOCUS_HELPER_TIMEOUT")), timeoutMs);
      const finish = (error: Error | undefined, response?: NativeWindowFocusResponse): void => {
        if (!this.pending.delete(request.requestId)) return;
        clearTimeout(timeout);
        if (error) reject(error);
        else if (response) resolve(response);
        else reject(new Error("E_WINDOW_FOCUS_RESPONSE_INVALID"));
      };
      this.pending.set(request.requestId, { finish });
      this.child.stdin.write(`${JSON.stringify(request)}\n`, (error) => {
        if (error) finish(new Error("E_WINDOW_FOCUS_HELPER_FAILED"));
      });
    });
  }

  async close(): Promise<void> {
    this.fail(new Error("E_WINDOW_FOCUS_HELPER_STOPPED"));
    if (!this.child.killed) this.child.kill();
  }

  private onOutput(chunk: string): void {
    this.output += chunk;
    if (this.output.length > 65_536) return this.fail(new Error("E_WINDOW_FOCUS_RESPONSE_INVALID"));
    while (true) {
      const newline = this.output.indexOf("\n");
      if (newline < 0) return;
      const line = this.output.slice(0, newline);
      this.output = this.output.slice(newline + 1);
      let response: unknown;
      try { response = JSON.parse(line); }
      catch { return this.fail(new Error("E_WINDOW_FOCUS_RESPONSE_INVALID")); }
      if (!isResponse(response)) return this.fail(new Error("E_WINDOW_FOCUS_RESPONSE_INVALID"));
      this.pending.get(response.requestId)?.finish(undefined, response);
    }
  }

  private fail(error: Error): void {
    if (this.terminalError) return;
    this.terminalError = error;
    for (const pending of [...this.pending.values()]) pending.finish(error);
    this.pending.clear();
  }
}

function assertApplicationIdentity(pid: number, bundleId: string): void {
  if (!Number.isSafeInteger(pid) || pid <= 0 || !/^[A-Za-z0-9.-]{1,255}$/.test(bundleId)) {
    throw new Error("E_WINDOW_FOCUS_APP_IDENTITY_INVALID");
  }
}

function isOpaqueToken(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9-]{32,64}$/.test(value);
}

function isRevision(value: unknown): value is number {
  return Number.isSafeInteger(value) && typeof value === "number" && value > 0;
}

function isFailureCode(value: unknown): value is string {
  return typeof value === "string" && /^E_WINDOW_FOCUS_[A-Z_]+$/.test(value);
}

function isResponse(value: unknown): value is NativeWindowFocusResponse {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.requestId === "string" && item.requestId.length > 0 &&
    typeof item.ok === "boolean" &&
    (item.token === undefined || typeof item.token === "string") &&
    (item.revision === undefined || isRevision(item.revision)) &&
    (item.error === undefined || isFailureCode(item.error));
}
