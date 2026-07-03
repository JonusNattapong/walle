import type { WalleEvent } from '../types.js';

export interface EngineRun {
  /** Resolves when the engine process exits. */
  done: Promise<{ success: boolean; error?: string }>;
  pid?: number;
  kill(): void;
}

export interface EngineAdapter {
  name: string;
  /**
   * Run the engine on `prompt` inside `cwd`, emitting normalized walle
   * events via `onEvent` as they happen.
   */
  run(opts: {
    taskId: string;
    prompt: string;
    cwd: string;
    model?: string;
    onEvent: (e: WalleEvent) => void;
  }): EngineRun;
}
