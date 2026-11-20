import type {
  SerialPortLike,
  SerialPortLikeInfo,
  SerialPortLikeOptions,
  SerialPortLikeSignals,
  SerialPortLikeSignalsState,
} from '../../src/serial-port-like/serial-port-like.ts';

export class TestTools {
  static sleep(duration: number, signal?: AbortSignal): Promise<void> {
    return new Promise<void>((resolve: () => void, reject: (reason?: unknown) => void): void => {
      signal?.throwIfAborted();

      const end = (): void => {
        signal?.removeEventListener('abort', onAbort);
        clearTimeout(timer);
      };

      const onAbort = (): void => {
        end();
        reject(signal!.reason);
      };

      signal?.addEventListener('abort', onAbort);

      const timer: any = setTimeout((): void => {
        end();
        resolve();
      }, duration);
    });
  }

  static polyfillRequestIdleCallback(): void {
    globalThis.requestIdleCallback ??= (
      callback: IdleRequestCallback,
      { timeout = 0 }: IdleRequestOptions = {},
    ): number => {
      return setTimeout(callback, timeout);
    };

    globalThis.cancelIdleCallback ??= (handle: number): void => {
      clearTimeout(handle);
    };
  }

  static gc(): void {
    if (typeof (globalThis as any).gc === 'function') {
      return (globalThis as any).gc!();
    } else {
      throw new Error('Missing `gc` function. Did you `--expose-gc` ?');
    }
  }
}

/**
 * Scriptable in-memory `SerialPortLike` mock for tests: the test controls the
 * bytes the device sends back, and the bytes written by the host are recorded.
 */
export class MockSerialPort implements SerialPortLike {
  #readableController: ReadableStreamDefaultController<Uint8Array> | undefined;
  #readable: ReadableStream<Uint8Array> | null = null;
  #writable: WritableStream<Uint8Array> | null = null;
  #opened: boolean = false;
  #options: SerialPortLikeOptions | undefined;
  #signals: SerialPortLikeSignalsState = {
    clearToSend: false,
    dataCarrierDetect: false,
    dataSetReady: false,
    ringIndicator: false,
  };

  /** Bytes written by the host since the port was opened. */
  readonly written: Uint8Array[] = [];

  /**
   * Invoked on every chunk written by the host; its returned bytes are
   * delivered to the readable stream, simulating the device's response.
   */
  respond: (bytes: Uint8Array) => Uint8Array[] | undefined = (): undefined => undefined;

  get readable(): ReadableStream<Uint8Array> | null {
    return this.#readable;
  }

  get writable(): WritableStream<Uint8Array> | null {
    return this.#writable;
  }

  get opened(): boolean {
    return this.#opened;
  }

  get options(): SerialPortLikeOptions | undefined {
    return this.#options;
  }

  async open(options: SerialPortLikeOptions): Promise<void> {
    if (this.#opened) {
      throw new Error('port is already open');
    }
    this.#opened = true;
    this.#options = options;
    this.#readable = new ReadableStream<Uint8Array>({
      start: (controller: ReadableStreamDefaultController<Uint8Array>): void => {
        this.#readableController = controller;
      },
    });
    this.#writable = new WritableStream<Uint8Array>({
      write: async (bytes: Uint8Array): Promise<void> => {
        return this.#onWritten(bytes);
      },
    });
  }

  /** Delivers device-to-host bytes to the readable stream. */
  push(bytes: Uint8Array): void {
    this.#readableController?.enqueue(bytes);
  }

  /**
   * Accepts signal changes and ignores them: the Web Serial API `getSignals`
   * reports input signals only, which the mock keeps fixed.
   */
  async setSignals(_signals?: SerialPortLikeSignals): Promise<void> {}

  async getSignals(): Promise<SerialPortLikeSignalsState> {
    return this.#signals;
  }

  getInfo(): SerialPortLikeInfo {
    return { usbVendorId: 0x10c4, usbProductId: 0xea60 };
  }

  /**
   * Closes the port, mirroring the spec-faithful close of a real port: the
   * readable stream is cancelled and the writable stream aborted — which
   * rejects with the streams' `TypeError` while a reader or writer holds a
   * lock, leaving the port open — and once both succeed the port reports
   * itself closed.
   */
  async close(): Promise<void> {
    const readable: ReadableStream<Uint8Array> | null = this.#readable;
    const writable: WritableStream<Uint8Array> | null = this.#writable;
    await Promise.all([readable?.cancel(), writable?.abort()]);
    this.#opened = false;
    this.#readable = null;
    this.#writable = null;
  }

  async #onWritten(bytes: Uint8Array): Promise<void> {
    this.written.push(bytes);
    const responses: Uint8Array[] | undefined = this.respond(bytes);
    if (responses !== undefined) {
      for (const response of responses) {
        this.push(response);
      }
    }
  }
}
