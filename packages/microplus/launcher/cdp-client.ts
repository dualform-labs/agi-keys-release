import WebSocket from "ws";

type Pending = {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
};

/** Bounded transport for launcher probes. No request is retried automatically. */
export class CdpClient {
  private readonly socket: WebSocket;
  private readonly ready: Promise<void>;
  private readonly pending = new Map<number, Pending>();
  private nextId = 0;

  constructor(url: string, private readonly timeout = 8_000) {
    this.socket = new WebSocket(url, { handshakeTimeout: timeout, maxPayload: 1024 * 1024 });
    this.ready = new Promise<void>((resolve, reject) => {
      this.socket.once("open", resolve);
      this.socket.once("error", () => reject(new Error("E_CDP_CONNECT_FAILED")));
      this.socket.once("close", () => reject(new Error("E_CDP_CLOSED")));
    });
    void this.ready.catch(() => undefined);
    this.socket.on("error", () => this.fail(new Error("E_CDP_CONNECTION_FAILED")));
    this.socket.on("close", () => this.fail(new Error("E_CDP_CLOSED")));
    this.socket.on("message", raw => this.handle(String(raw)));
  }

  connect(): Promise<void> { return this.ready; }

  evaluate(expression: string): Promise<unknown> {
    if (this.socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error("E_CDP_CLOSED"));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("E_CDP_REQUEST_TIMEOUT"));
        this.close();
      }, this.timeout);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.socket.send(JSON.stringify({ id, method: "Runtime.evaluate", params: {
          expression, awaitPromise: true, returnByValue: true,
        } }), error => {
          if (error) this.close();
        });
      } catch {
        this.close();
      }
    });
  }

  close(): void {
    this.fail(new Error("E_CDP_CLOSED"));
    this.socket.terminate();
  }

  private fail(error: Error): void {
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.pending.clear();
  }

  private handle(raw: string): void {
    let message: { id?: number; error?: unknown; result?: { result?: { value?: unknown }; exceptionDetails?: unknown } };
    try { message = JSON.parse(raw); }
    catch { this.close(); return; }
    if (!message || typeof message !== "object") { this.close(); return; }
    if (typeof message.id !== "number") return;
    const request = this.pending.get(message.id);
    if (!request) return;
    this.pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error || message.result?.exceptionDetails) {
      request.reject(new Error("E_CDP_EVALUATION_FAILED"));
    } else request.resolve(message.result?.result?.value);
  }
}
