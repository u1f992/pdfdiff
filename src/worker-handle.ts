import Worker from "web-worker";

import { assetQuery } from "./assets.ts";

export type ErrorMessage = {
  type: "error";
  message: string;
};

export function workerUrl(name: string): URL {
  const file = `${name}${import.meta.url.endsWith(".ts") ? ".ts" : ".js"}`;
  return new URL(`./${file}${assetQuery(file)}`, import.meta.url);
}

export class WorkerHandle<Request, Response extends { type: string }> {
  private readonly worker: InstanceType<typeof Worker>;
  private pendingResolve: ((data: Response) => void) | null = null;
  private pendingReject: ((reason: unknown) => void) | null = null;
  private failure: Error | null = null;

  constructor(url: URL) {
    this.worker = new Worker(url, { type: "module" });
    this.worker.addEventListener("message", (e: MessageEvent<Response | ErrorMessage>) => {
      const data = e.data;
      const resolve = this.pendingResolve;
      const reject = this.pendingReject;
      this.pendingResolve = null;
      this.pendingReject = null;
      if (data.type === "error") {
        reject?.(new Error(`worker: ${(data as ErrorMessage).message}`));
      } else {
        resolve?.(data as Response);
      }
    });
    this.worker.addEventListener("error", (e: Event) => {
      const { error, message } = e as Partial<ErrorEvent>;
      this.failure = error ?? new Error(message || `Failed to load worker ${url}`);
      const reject = this.pendingReject;
      this.pendingResolve = null;
      this.pendingReject = null;
      reject?.(this.failure);
    });
  }

  request<T extends Response>(msg: Request, transfer: Transferable[] = []): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (this.failure !== null) {
        reject(this.failure);
        return;
      }
      this.pendingResolve = resolve as (data: Response) => void;
      this.pendingReject = reject;
      this.worker.postMessage(msg, transfer);
    });
  }

  terminate() {
    this.worker.terminate();
  }
}
