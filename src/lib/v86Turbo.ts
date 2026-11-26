import type { DownloadProgress, V86Instance } from '../types/v86';
import { V86_ASSETS, fetchBinaryWithProgress } from './presets';

let cachedWasmModule: WebAssembly.Module | null = null;
let wasmCompilePromise: Promise<WebAssembly.Module> | null = null;

let cachedBiosBuffers: { bios: ArrayBuffer; vgaBios: ArrayBuffer } | null = null;
let biosFetchPromise: Promise<{ bios: ArrayBuffer; vgaBios: ArrayBuffer }> | null = null;

/**
 * Fetches and compiles v86.wasm once per session so subsequent boots, preset switches,
 * and snapshot restores skip network download and Wasm compilation completely.
 */
export async function getCompiledV86WasmModule(
  wasmUrl: string = V86_ASSETS.wasmUrl,
  onProgress?: (progress: DownloadProgress) => void
): Promise<WebAssembly.Module> {
  if (cachedWasmModule) {
    return cachedWasmModule;
  }
  if (wasmCompilePromise) {
    return wasmCompilePromise;
  }

  wasmCompilePromise = (async () => {
    const compileUrl = async (url: string): Promise<WebAssembly.Module> => {
      const bytes = await fetchBinaryWithProgress(url, { onProgress });
      return WebAssembly.compile(bytes);
    };

    try {
      const mod = await compileUrl(wasmUrl);
      cachedWasmModule = mod;
      return mod;
    } catch (primaryErr) {
      // Fall back to v86-fallback.wasm for browsers without newer Wasm SIMD extensions
      const fallbackUrl = wasmUrl.replace('v86.wasm', 'v86-fallback.wasm');
      if (fallbackUrl !== wasmUrl) {
        try {
          const fallbackMod = await compileUrl(fallbackUrl);
          cachedWasmModule = fallbackMod;
          return fallbackMod;
        } catch {
          wasmCompilePromise = null;
          throw primaryErr;
        }
      }
      wasmCompilePromise = null;
      throw primaryErr;
    }
  })();

  return wasmCompilePromise;
}

/**
 * Fetches SeaBIOS and VGA BIOS once per session and returns fresh ArrayBuffer clones.
 */
export async function getCachedBiosBuffers(
  signal?: AbortSignal
): Promise<{ bios: ArrayBuffer; vgaBios: ArrayBuffer }> {
  if (cachedBiosBuffers) {
    return {
      bios: cachedBiosBuffers.bios.slice(0),
      vgaBios: cachedBiosBuffers.vgaBios.slice(0),
    };
  }

  if (!biosFetchPromise) {
    biosFetchPromise = Promise.all([
      fetchBinaryWithProgress(V86_ASSETS.biosUrl),
      fetchBinaryWithProgress(V86_ASSETS.vgaBiosUrl),
    ])
      .then(([bios, vgaBios]) => {
        cachedBiosBuffers = { bios, vgaBios };
        return cachedBiosBuffers;
      })
      .catch((err) => {
        biosFetchPromise = null;
        throw err;
      });
  }

  const resolved = await biosFetchPromise;
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }
  return {
    bios: resolved.bios.slice(0),
    vgaBios: resolved.vgaBios.slice(0),
  };
}

/**
 * Silently pre-warms v86.wasm compilation + SeaBIOS/VGABIOS in the background on app load.
 */
export function prewarmV86Runtime(): void {
  if (typeof WebAssembly === 'undefined') return;
  void getCompiledV86WasmModule().catch(() => {
    // Non-fatal; boot path will retry with full error reporting
  });
  void getCachedBiosBuffers().catch(() => {
    // Non-fatal; boot path will retry
  });
}

/**
 * Creates a V86Config.wasm_fn backed by the cached compiled WebAssembly.Module.
 */
export function createCachedWasmFn(
  wasmUrl: string = V86_ASSETS.wasmUrl,
  onProgress?: (progress: DownloadProgress) => void
): (env: WebAssembly.Imports) => Promise<WebAssembly.Exports> {
  return async (env: WebAssembly.Imports) => {
    const mod = await getCompiledV86WasmModule(wasmUrl, onProgress);
    const instance = await WebAssembly.instantiate(mod, env);
    return instance.exports;
  };
}

/**
 * WebKit OOM stability guard for 8 GB iPadOS Safari/Chrome tabs.
 * Returns true when loading the entire ISO into SyncFileBuffer (async: false) fits safely
 * alongside the guest Wasm heap without risking an iPadOS Jetsam tab kill.
 */
export function shouldUseSyncIsoBuffer(ramMb: number, isoSizeBytes: number): boolean {
  const isoMb = isoSizeBytes / (1024 * 1024);
  if (isoMb <= 64) return true;
  if (isoMb > 512) return false;
  return ramMb + isoMb <= 1400;
}

interface InternalV86Core {
  stopping: boolean;
  running: boolean;
  idle: boolean;
  tick_counter: number;
  worker?: Worker | null;
  bus?: { send: (name: string, data?: unknown) => void };
  cpu?: {
    main_loop: () => number;
    set_jit_config?: (index: number, value: number) => void;
  };
  do_tick?: () => void;
  next_tick?: (t: number) => void;
  yield?: (t: number, tick: number) => void;
  yield_callback?: (tick: number) => void;
  unregister_yield?: () => void;
}

interface InternalScreenAdapter {
  update_graphical?: () => void;
}

export interface V86TurboController {
  ensureAttached: () => void;
  setEnabled: (enabled: boolean) => void;
  cleanup: () => void;
}

/**
 * Attaches three real v86 runtime optimizations once v86.wasm finishes instantiating:
 * 1. MessageChannel zero-IPC scheduler + 11 ms time-sliced busy-burst do_tick()
 *    (replaces Worker.postMessage round-trips while keeping 60 Hz touch/UI fluid and idle CPU at ~0%).
 * 2. Safe JIT engine tuning via set_jit_config (larger multi-page code blocks with loop safety kept ON).
 * 3. Smart 30 FPS VGA framebuffer pacing in Turbo Mode (cuts svga_fill_pixel_buffer + putImageData overhead
 *    by 50% on 60 Hz displays and 75% on 120 Hz ProMotion displays).
 */
export function attachV86TurboEngine(
  emulator: V86Instance,
  initialEnabled: boolean
): V86TurboController {
  let enabled = initialEnabled;
  let cleanedUp = false;
  let coreAttached = false;
  let screenAttached = false;

  let attachedCore: InternalV86Core | null = null;
  let attachedScreen: InternalScreenAdapter | null = null;
  let channel: MessageChannel | null = null;
  let sleepTimer: number | null = null;
  let lastVgaFrameTs = 0;

  let origDoTick: (() => void) | undefined;
  let origYield: ((t: number, tick: number) => void) | undefined;
  let origUnregister: (() => void) | undefined;
  let origUpdateGraphical: (() => void) | undefined;

  const applyJitConfig = (turbo: boolean) => {
    const core = emulator.v86 as InternalV86Core | undefined;
    const setJit = core?.cpu?.set_jit_config;
    if (typeof setJit !== 'function') return;
    try {
      setJit(0, 0); // JIT enabled
      setJit(1, turbo ? 5 : 3); // MAX_PAGES per compiled Wasm block (default 3)
      setJit(2, 1); // JIT_USE_LOOP_SAFETY = true (always ON for hang/crash safety)
      setJit(3, turbo ? 380 : 250); // MAX_EXTRA_BASIC_BLOCKS (default 250)
    } catch {
      // Ignore if Wasm exports differ
    }
  };

  const clearSleepTimer = () => {
    if (sleepTimer !== null) {
      window.clearTimeout(sleepTimer);
      sleepTimer = null;
    }
  };

  const ensureAttached = () => {
    if (cleanedUp) return;

    const core = emulator.v86 as InternalV86Core | undefined;
    if (
      !coreAttached &&
      core &&
      core.cpu &&
      typeof core.cpu.main_loop === 'function' &&
      typeof core.next_tick === 'function' &&
      typeof core.yield_callback === 'function' &&
      typeof MessageChannel !== 'undefined'
    ) {
      coreAttached = true;
      attachedCore = core;
      origDoTick = core.do_tick;
      origYield = core.yield;
      origUnregister = core.unregister_yield;

      // Terminate stock idle Worker thread if v86 spawned one
      if (core.worker) {
        try {
          core.worker.terminate();
          core.worker = null;
        } catch {
          // Ignore
        }
      }

      channel = new MessageChannel();
      channel.port1.onmessage = (e: MessageEvent<number>) => {
        if (cleanedUp) return;
        core.yield_callback?.(e.data);
      };

      core.yield = function turboYield(t: number, tick: number) {
        if (cleanedUp) return;
        clearSleepTimer();
        if (t < 1) {
          channel?.port2.postMessage(tick);
        } else {
          const delayMs = Math.max(1, Math.min(250, Math.round(t)));
          sleepTimer = window.setTimeout(() => {
            sleepTimer = null;
            if (!cleanedUp) {
              core.yield_callback?.(tick);
            }
          }, delayMs);
        }
      };

      core.do_tick = function turboDoTick() {
        if (core.stopping || !core.running) {
          core.stopping = false;
          core.running = false;
          core.bus?.send('emulator-stopped');
          return;
        }

        core.idle = false;
        const cpu = core.cpu;
        if (!cpu) return;

        if (!enabled) {
          const t = cpu.main_loop();
          core.next_tick?.(t);
          return;
        }

        // Turbo burst: run consecutive busy main_loop() slices up to 11 ms before yielding once
        const sliceStart = performance.now();
        let t = 0;
        let spins = 0;
        do {
          t = cpu.main_loop();
          spins++;
        } while (
          t < 1 &&
          !core.stopping &&
          core.running &&
          spins < 16 &&
          performance.now() - sliceStart < 11
        );

        core.next_tick?.(t);
      };

      core.unregister_yield = function turboUnregisterYield() {
        clearSleepTimer();
        if (channel) {
          channel.port1.onmessage = null;
          try {
            channel.port1.close();
            channel.port2.close();
          } catch {
            // Ignore
          }
          channel = null;
        }
        origUnregister?.call(core);
      };
    }

    const screenAdapter = emulator.screen_adapter as InternalScreenAdapter | undefined;
    if (!screenAttached && screenAdapter && typeof screenAdapter.update_graphical === 'function') {
      screenAttached = true;
      attachedScreen = screenAdapter;
      origUpdateGraphical = screenAdapter.update_graphical;

      screenAdapter.update_graphical = function pacedUpdateGraphical() {
        if (enabled) {
          const now = performance.now();
          if (now - lastVgaFrameTs < 33) {
            return;
          }
          lastVgaFrameTs = now;
        }
        origUpdateGraphical?.call(screenAdapter);
      };
    }

    applyJitConfig(enabled);
  };

  ensureAttached();

  return {
    ensureAttached,
    setEnabled(next: boolean) {
      if (cleanedUp) return;
      enabled = next;
      ensureAttached();
    },
    cleanup() {
      if (cleanedUp) return;
      cleanedUp = true;
      clearSleepTimer();
      if (channel) {
        channel.port1.onmessage = null;
        try {
          channel.port1.close();
          channel.port2.close();
        } catch {
          // Ignore
        }
        channel = null;
      }
      if (attachedCore) {
        if (origDoTick) attachedCore.do_tick = origDoTick;
        if (origYield) attachedCore.yield = origYield;
        if (origUnregister) attachedCore.unregister_yield = origUnregister;
      }
      if (attachedScreen && origUpdateGraphical) {
        attachedScreen.update_graphical = origUpdateGraphical;
      }
    },
  };
}
