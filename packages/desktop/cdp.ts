import WebSocket from 'ws';

interface RuntimeEvaluateResult {
  exceptionDetails?: {
    exception?: {
      description?: string;
    };
  };
  result: {
    value: unknown;
  };
}

interface CdpResponse {
  id?: number;
  error?: {
    message: string;
  };
  result?: RuntimeEvaluateResult;
}

interface PendingRequest {
  resolve: (value: RuntimeEvaluateResult) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export class Cdp {
  private sequence = 0;
  private readonly pending = new Map<number, PendingRequest>();

  constructor(private readonly socket: WebSocket) {
    socket.on('error', () => socket.close());
    socket.on('message', (data) => {
      let response: CdpResponse;
      try {
        response = JSON.parse(data.toString()) as CdpResponse;
      } catch {
        socket.close();
        return;
      }

      const id = response.id;
      const request = id === undefined ? undefined : this.pending.get(id);
      if (!request || id === undefined) return;

      clearTimeout(request.timeout);
      this.pending.delete(id);
      if (response.error) {
        request.reject(Error(response.error.message));
      } else {
        request.resolve(response.result!);
      }
    });
    socket.on('close', () => {
      for (const request of this.pending.values()) {
        clearTimeout(request.timeout);
        request.reject(Error('CDP disconnected; operation outcome may be unknown'));
      }
      this.pending.clear();
    });
  }

  async evaluate(expression: string): Promise<unknown> {
    const id = ++this.sequence;
    const result = await new Promise<RuntimeEvaluateResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(Error('CDP timeout; operation outcome may be unknown'));
      }, 5000);
      this.pending.set(id, { resolve, reject, timeout });
      this.socket.send(JSON.stringify({
        id,
        method: 'Runtime.evaluate',
        params: {
          expression,
          awaitPromise: true,
          returnByValue: true,
        },
      }));
    });

    if (result.exceptionDetails) {
      throw Error(result.exceptionDetails.exception?.description ?? 'Native evaluation failed');
    }
    return result.result.value;
  }

  close(): void {
    this.socket.close();
  }
}
