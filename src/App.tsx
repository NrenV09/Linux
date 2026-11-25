import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  HardDriveUpload,
  Monitor,
  Play,
  RefreshCw,
  X,
} from 'lucide-react';
import type {
  BootDevice,
  DownloadProgress,
  EmulatorStatus,
  OSPreset,
  SavedSnapshotMeta,
  V86Config,
  V86Instance,
} from './types/v86';
import {
  BOOT_ORDER,
  OS_PRESETS,
  V86_ASSETS,
  fetchBinaryWithProgress,
  formatBytes,
} from './lib/presets';
import {
  deleteSnapshotFromDb,
  listSnapshotsFromDb,
  loadSnapshotFromDb,
  saveSnapshotToDb,
} from './lib/snapshotDb';
import { EmulatorToolbar } from './components/EmulatorToolbar';
import { VirtualKeyboard } from './components/VirtualKeyboard';

interface ToastMessage {
  id: number;
  tone: 'info' | 'success' | 'error';
  text: string;
}

interface SafariDocument extends Document {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
}

interface SafariElement extends HTMLElement {
  webkitRequestFullscreen?: () => Promise<void> | void;
}

const DEFAULT_PRESET = OS_PRESETS[0];

export default function App() {
  const viewportRef = useRef<HTMLElement>(null);
  const screenRef = useRef<HTMLDivElement>(null);
  const emulatorRef = useRef<V86Instance | null>(null);
  const localFileRef = useRef<File | null>(null);
  const fileDropInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const biosCacheRef = useRef<{ bios: ArrayBuffer; vgaBios: ArrayBuffer } | null>(null);

  // Track IPS accurately with 32-bit wrap-around handling
  const lastInstrRef = useRef(0);
  const lastTickRef = useRef(0);

  // Touch-to-mouse gesture tracking
  const touchStateRef = useRef<{
    active: boolean;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    moved: boolean;
    startTime: number;
    maxTouches: number;
  }>({
    active: false,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
    moved: false,
    startTime: 0,
    maxTouches: 0,
  });

  const [v86Ready, setV86Ready] = useState<boolean>(
    () => typeof window !== 'undefined' && !!window.V86
  );
  const [v86Error, setV86Error] = useState<string | null>(null);
  const [scriptAttempt, setScriptAttempt] = useState(0);

  const [status, setStatus] = useState<EmulatorStatus>('stopped');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);
  const [ips, setIps] = useState(0);

  const [selectedPresetId, setSelectedPresetId] = useState<string>(DEFAULT_PRESET.id);
  const [customIsoUrl, setCustomIsoUrl] = useState<string>(DEFAULT_PRESET.url);
  const [localFileName, setLocalFileName] = useState<string | null>(null);
  const [bootDevice, setBootDevice] = useState<BootDevice>(DEFAULT_PRESET.device);
  const [memoryMb, setMemoryMb] = useState<number>(DEFAULT_PRESET.recommendedRamMb);
  const [activeImageLabel, setActiveImageLabel] = useState<string>(DEFAULT_PRESET.name);

  const [crispScaling, setCrispScaling] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPointerLocked, setIsPointerLocked] = useState(false);
  const [showKeyboard, setShowKeyboard] = useState(false);
  const [openMenu, setOpenMenu] = useState<'config' | 'state' | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const [snapshots, setSnapshots] = useState<SavedSnapshotMeta[]>([]);
  const [isSavingState, setIsSavingState] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  const showToast = useCallback((text: string, tone: ToastMessage['tone'] = 'info') => {
    const id = Date.now();
    setToast({ id, tone, text });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => {
      setToast((current) => (current?.id === toast.id ? null : current));
    }, 4200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  // Scale v86 text/canvas output cleanly to fit viewport while preserving aspect ratio
  const fitScreenToViewport = useCallback(() => {
    const viewport = viewportRef.current;
    const container = screenRef.current;
    const emu = emulatorRef.current;
    if (!viewport || !container || !emu) return;

    const vw = viewport.clientWidth;
    const vh = viewport.clientHeight;
    if (vw <= 0 || vh <= 0) return;

    const canvas = container.querySelector('canvas');
    const textEl = container.querySelector('div');

    if (canvas && canvas.style.display !== 'none' && canvas.width > 0 && canvas.height > 0) {
      const scale = Math.min(vw / canvas.width, vh / canvas.height);
      const targetW = Math.max(1, Math.floor(canvas.width * scale));
      const targetH = Math.max(1, Math.floor(canvas.height * scale));
      canvas.style.width = `${targetW}px`;
      canvas.style.height = `${targetH}px`;
      return;
    }

    if (textEl && textEl.style.display !== 'none') {
      textEl.style.transform = '';
      const rect = textEl.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        const scale = Math.min(vw / rect.width, vh / rect.height, 2);
        textEl.style.transform = scale !== 1 ? `scale(${scale.toFixed(4)})` : '';
      }
    }
  }, []);

  useEffect(() => {
    const onResize = () => fitScreenToViewport();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [fitScreenToViewport]);

  // Re-fit display when virtual keyboard toggles
  useEffect(() => {
    const id = window.requestAnimationFrame(() => fitScreenToViewport());
    return () => window.cancelAnimationFrame(id);
  }, [showKeyboard, isFullscreen, fitScreenToViewport]);

  // StrictMode-safe libv86.js script loader
  useEffect(() => {
    if (window.V86) {
      setV86Ready(true);
      setV86Error(null);
      return;
    }

    const scriptId = 'v86-runtime-script';
    let script = document.getElementById(scriptId) as HTMLScriptElement | null;

    const handleLoad = () => {
      if (window.V86) {
        setV86Ready(true);
        setV86Error(null);
      } else {
        setV86Error('v86 runtime loaded, but window.V86 was not initialized.');
      }
    };

    const handleError = () => {
      setV86Error('Unable to load libv86.js from CDN. Check network connectivity or retry.');
    };

    if (!script) {
      script = document.createElement('script');
      script.id = scriptId;
      script.src = V86_ASSETS.libUrl;
      script.async = true;
      script.crossOrigin = 'anonymous';
      document.head.appendChild(script);
    }

    script.addEventListener('load', handleLoad);
    script.addEventListener('error', handleError);

    return () => {
      script?.removeEventListener('load', handleLoad);
      script?.removeEventListener('error', handleError);
    };
  }, [scriptAttempt]);

  // Load saved IndexedDB snapshots on mount
  const refreshSnapshots = useCallback(async () => {
    try {
      const list = await listSnapshotsFromDb();
      setSnapshots(list);
    } catch {
      // IndexedDB unavailable in private browsing or restricted iframe
    }
  }, []);

  useEffect(() => {
    refreshSnapshots();
  }, [refreshSnapshots]);

  // Cleanly abort downloads and destroy VM on unmount
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
      if (emulatorRef.current) {
        void emulatorRef.current.destroy();
        emulatorRef.current = null;
      }
    };
  }, []);

  // Poll IPS once per second
  useEffect(() => {
    if (status !== 'running') {
      setIps(0);
      return;
    }

    const interval = window.setInterval(() => {
      const emu = emulatorRef.current;
      if (!emu) return;

      const now = performance.now();
      const instr = emu.get_instruction_counter?.() ?? 0;
      const elapsedSec = (now - lastTickRef.current) / 1000;

      if (elapsedSec > 0.1) {
        let deltaInstr = instr - lastInstrRef.current;
        if (deltaInstr < 0) {
          deltaInstr += 0x100000000;
        }
        setIps(Math.max(0, Math.round(deltaInstr / elapsedSec)));
        lastInstrRef.current = instr;
        lastTickRef.current = now;
      }
    }, 1000);

    return () => window.clearInterval(interval);
  }, [status]);

  // Fullscreen & Pointer Lock browser listeners
  useEffect(() => {
    const doc = document as SafariDocument;
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(doc.fullscreenElement || doc.webkitFullscreenElement));
    };
    const handlePointerLockChange = () => {
      setIsPointerLocked(Boolean(document.pointerLockElement));
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.addEventListener('pointerlockchange', handlePointerLockChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
      document.removeEventListener('pointerlockchange', handlePointerLockChange);
    };
  }, []);

  const resetScreenContainerDom = useCallback(() => {
    const container = screenRef.current;
    if (!container) return;
    container.innerHTML = '';
    const textLayer = document.createElement('div');
    const canvasLayer = document.createElement('canvas');
    canvasLayer.style.display = 'none';
    container.appendChild(textLayer);
    container.appendChild(canvasLayer);
  }, []);

  const destroyCurrentEmulator = useCallback(async () => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;

    const emu = emulatorRef.current;
    emulatorRef.current = null;
    if (emu) {
      try {
        await emu.destroy();
      } catch {
        // Ignore teardown errors from interrupted boots
      }
    }
    resetScreenContainerDom();
  }, [resetScreenContainerDom]);

  const loadBiosBuffers = useCallback(async (signal: AbortSignal) => {
    if (biosCacheRef.current) {
      return {
        bios: biosCacheRef.current.bios.slice(0),
        vgaBios: biosCacheRef.current.vgaBios.slice(0),
      };
    }

    const [bios, vgaBios] = await Promise.all([
      fetchBinaryWithProgress(V86_ASSETS.biosUrl, { signal }),
      fetchBinaryWithProgress(V86_ASSETS.vgaBiosUrl, { signal }),
    ]);

    biosCacheRef.current = { bios, vgaBios };
    return {
      bios: bios.slice(0),
      vgaBios: vgaBios.slice(0),
    };
  }, []);

  const bootEmulator = useCallback(
    async (options: {
      sourceUrl?: string;
      localFile?: File | null;
      device: BootDevice;
      ramMb: number;
      sizeHint?: number;
      label: string;
      initialStateBuffer?: ArrayBuffer;
    }) => {
      if (!window.V86 || !screenRef.current) {
        showToast('v86 engine is still loading.', 'error');
        return;
      }

      setOpenMenu(null);
      setErrorMessage(null);
      setDownloadProgress(null);
      setStatus('loading');
      setIps(0);
      setActiveImageLabel(options.label);

      await destroyCurrentEmulator();

      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        setDownloadProgress({
          fileName: 'SeaBIOS & VGA BIOS',
          loaded: 0,
          total: 0,
          percent: null,
        });
        const { bios, vgaBios } = await loadBiosBuffers(controller.signal);

        let imageBuffer: ArrayBuffer | File | undefined;
        if (options.localFile) {
          imageBuffer = options.localFile;
        } else if (options.sourceUrl) {
          imageBuffer = await fetchBinaryWithProgress(options.sourceUrl, {
            expectedSize: options.sizeHint,
            signal: controller.signal,
            onProgress: (prog) => setDownloadProgress(prog),
          });
        }

        if (controller.signal.aborted || !screenRef.current) return;

        // Ensure fresh text/canvas layers exist right before ScreenAdapter attaches
        resetScreenContainerDom();

        const config: V86Config = {
          wasm_path: V86_ASSETS.wasmUrl,
          memory_size: options.ramMb * 1024 * 1024,
          vga_memory_size: 8 * 1024 * 1024,
          screen_container: screenRef.current,
          bios: { buffer: bios },
          vga_bios: { buffer: vgaBios },
          boot_order: BOOT_ORDER[options.device],
          autostart: true,
          acpi: false,
          disable_jit: false,
        };

        if (options.initialStateBuffer) {
          config.initial_state = { buffer: options.initialStateBuffer };
        }

        if (imageBuffer) {
          config[options.device] = {
            buffer: imageBuffer,
            async: false,
          };
        }

        setDownloadProgress({
          fileName: 'v86.wasm',
          loaded: 0,
          total: 0,
          percent: null,
        });

        const emulator = new window.V86(config);
        emulatorRef.current = emulator;
        lastTickRef.current = performance.now();
        lastInstrRef.current = 0;

        const markRunning = () => {
          setDownloadProgress(null);
          setStatus('running');
          lastTickRef.current = performance.now();
          lastInstrRef.current = emulator.get_instruction_counter?.() ?? 0;
          window.requestAnimationFrame(() => fitScreenToViewport());
        };

        emulator.add_listener('download-progress', (rawEvent: unknown) => {
          const ev = rawEvent as {
            file_name?: string;
            loaded?: number;
            total?: number;
            lengthComputable?: boolean;
          };
          const loaded = ev.loaded ?? 0;
          const total = ev.total ?? 0;
          const fileName = (ev.file_name ?? 'v86.wasm').split('/').pop() || 'v86.wasm';
          const percent =
            ev.lengthComputable && total > 0
              ? Math.min(100, Math.round((loaded / total) * 100))
              : null;
          setDownloadProgress({ fileName, loaded, total, percent });
        });

        emulator.add_listener('emulator-ready', markRunning);
        emulator.add_listener('emulator-loaded', markRunning);
        emulator.add_listener('emulator-started', markRunning);

        emulator.add_listener('screen-set-size', () => {
          window.requestAnimationFrame(() => fitScreenToViewport());
        });

        emulator.add_listener('screen-set-mode', () => {
          window.requestAnimationFrame(() => fitScreenToViewport());
        });

        emulator.add_listener('emulator-stopped', () => {
          setStatus((prev) => (prev === 'error' || prev === 'stopped' ? prev : 'paused'));
        });

        emulator.add_listener('download-error', (rawEvent: unknown) => {
          const ev = rawEvent as { file_name?: string } | undefined;
          const failedFile = ev?.file_name ? ` (${ev.file_name})` : '';
          setDownloadProgress(null);
          setStatus('error');
          setErrorMessage(
            `Failed to download runtime asset${failedFile}. Check network access or load an ISO locally.`
          );
        });
      } catch (err) {
        if (controller.signal.aborted) return;
        const message =
          err instanceof Error
            ? err.message
            : 'Unexpected network or WebAssembly initialization failure.';
        setDownloadProgress(null);
        setStatus('error');
        setErrorMessage(message);
      }
    },
    [
      destroyCurrentEmulator,
      fitScreenToViewport,
      loadBiosBuffers,
      resetScreenContainerDom,
      showToast,
    ]
  );

  const handlePowerOn = useCallback(() => {
    if (localFileRef.current) {
      void bootEmulator({
        localFile: localFileRef.current,
        device: bootDevice,
        ramMb: memoryMb,
        label: localFileRef.current.name,
      });
      return;
    }

    const preset = OS_PRESETS.find((p) => p.id === selectedPresetId && p.url === customIsoUrl.trim());
    const trimmedUrl = customIsoUrl.trim();
    if (!trimmedUrl) {
      showToast('Select a preset, enter a CORS-enabled URL, or load a local ISO file.', 'error');
      return;
    }

    void bootEmulator({
      sourceUrl: trimmedUrl,
      device: preset ? preset.device : bootDevice,
      ramMb: memoryMb,
      sizeHint: preset?.size,
      label: preset ? preset.name : trimmedUrl.split('/').pop() || 'Custom ISO',
    });
  }, [bootDevice, bootEmulator, customIsoUrl, memoryMb, selectedPresetId, showToast]);

  const handleBootPresetNow = useCallback(
    (preset: OSPreset) => {
      localFileRef.current = null;
      setLocalFileName(null);
      setSelectedPresetId(preset.id);
      setCustomIsoUrl(preset.url);
      setBootDevice(preset.device);
      setMemoryMb(preset.recommendedRamMb);
      void bootEmulator({
        sourceUrl: preset.url,
        device: preset.device,
        ramMb: preset.recommendedRamMb,
        sizeHint: preset.size,
        label: preset.name,
      });
    },
    [bootEmulator]
  );

  const handleSelectPreset = useCallback((preset: OSPreset) => {
    localFileRef.current = null;
    setLocalFileName(null);
    setSelectedPresetId(preset.id);
    setCustomIsoUrl(preset.url);
    setBootDevice(preset.device);
    setMemoryMb(preset.recommendedRamMb);
  }, []);

  const handleUploadIso = useCallback(
    (file: File) => {
      localFileRef.current = file;
      setLocalFileName(file.name);
      const lower = file.name.toLowerCase();
      const inferredDevice: BootDevice = lower.endsWith('.iso')
        ? 'cdrom'
        : file.size <= 2_949_120
          ? 'fda'
          : 'hda';
      setBootDevice(inferredDevice);
      void bootEmulator({
        localFile: file,
        device: inferredDevice,
        ramMb: memoryMb,
        label: file.name,
      });
    },
    [bootEmulator, memoryMb]
  );

  const handlePowerOff = useCallback(async () => {
    await destroyCurrentEmulator();
    setStatus('stopped');
    setDownloadProgress(null);
    setErrorMessage(null);
    setIps(0);
    showToast('Virtual machine powered off.', 'info');
  }, [destroyCurrentEmulator, showToast]);

  const handleTogglePause = useCallback(async () => {
    const emu = emulatorRef.current;
    if (!emu) return;
    if (status === 'running') {
      await emu.stop();
      setStatus('paused');
    } else if (status === 'paused') {
      await emu.run();
      lastTickRef.current = performance.now();
      lastInstrRef.current = emu.get_instruction_counter?.() ?? 0;
      setStatus('running');
    }
  }, [status]);

  const handleReset = useCallback(() => {
    const emu = emulatorRef.current;
    if (!emu) return;
    emu.restart();
    setStatus('running');
    showToast('System reset signal sent.', 'info');
  }, [showToast]);

  const handleSaveSnapshotDb = useCallback(async () => {
    const emu = emulatorRef.current;
    if (!emu) return;
    setIsSavingState(true);
    try {
      const stateBuffer = await emu.save_state();
      const now = Date.now();
      const id = `snap-${now}`;
      await saveSnapshotToDb({
        id,
        name: `${activeImageLabel} · ${new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
        presetName: activeImageLabel,
        memoryMb,
        byteLength: stateBuffer.byteLength,
        savedAt: now,
        data: stateBuffer,
      });
      await refreshSnapshots();
      showToast(`Saved ${formatBytes(stateBuffer.byteLength)} snapshot to browser storage.`, 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to save machine state.';
      showToast(msg, 'error');
    } finally {
      setIsSavingState(false);
    }
  }, [activeImageLabel, memoryMb, refreshSnapshots, showToast]);

  const handleRestoreSnapshotDb = useCallback(
    async (id: string) => {
      try {
        const record = await loadSnapshotFromDb(id);
        if (!record) {
          showToast('Snapshot not found in browser storage.', 'error');
          return;
        }

        const emu = emulatorRef.current;
        if (emu && (status === 'running' || status === 'paused')) {
          await emu.stop();
          await emu.restore_state(record.data);
          await emu.run();
          setStatus('running');
          setOpenMenu(null);
          window.requestAnimationFrame(() => fitScreenToViewport());
          showToast(`Restored "${record.name}".`, 'success');
        } else {
          const preset = OS_PRESETS.find((p) => p.id === selectedPresetId);
          await bootEmulator({
            localFile: localFileRef.current,
            sourceUrl: localFileRef.current ? undefined : customIsoUrl.trim() || preset?.url,
            device: preset ? preset.device : bootDevice,
            ramMb: record.memoryMb,
            sizeHint: preset?.size,
            label: record.presetName,
            initialStateBuffer: record.data,
          });
          showToast(`Booted from snapshot "${record.name}".`, 'success');
        }
      } catch (err) {
        const msg =
          err instanceof Error
            ? err.message
            : 'Snapshot restore failed. Ensure the same OS image and RAM size are active.';
        showToast(msg, 'error');
      }
    },
    [
      bootDevice,
      bootEmulator,
      customIsoUrl,
      fitScreenToViewport,
      selectedPresetId,
      showToast,
      status,
    ]
  );

  const handleDeleteSnapshotDb = useCallback(
    async (id: string) => {
      try {
        await deleteSnapshotFromDb(id);
        await refreshSnapshots();
        showToast('Snapshot deleted.', 'info');
      } catch {
        showToast('Could not delete snapshot.', 'error');
      }
    },
    [refreshSnapshots, showToast]
  );

  const handleDownloadStateFile = useCallback(async () => {
    const emu = emulatorRef.current;
    if (!emu) return;
    setIsSavingState(true);
    try {
      const stateBuffer = await emu.save_state();
      const blob = new Blob([stateBuffer], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const slug = activeImageLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      link.href = url;
      link.download = `${slug || 'v86'}-state.bin`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      showToast(`Exported ${formatBytes(stateBuffer.byteLength)} snapshot file.`, 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to export state file.';
      showToast(msg, 'error');
    } finally {
      setIsSavingState(false);
    }
  }, [activeImageLabel, showToast]);

  const handleUploadStateFile = useCallback(
    async (file: File) => {
      try {
        const buffer = await file.arrayBuffer();
        const emu = emulatorRef.current;
        if (emu && (status === 'running' || status === 'paused')) {
          await emu.stop();
          await emu.restore_state(buffer);
          await emu.run();
          setStatus('running');
          setOpenMenu(null);
          window.requestAnimationFrame(() => fitScreenToViewport());
          showToast(`Restored state from ${file.name}.`, 'success');
        } else {
          const preset = OS_PRESETS.find((p) => p.id === selectedPresetId);
          await bootEmulator({
            localFile: localFileRef.current,
            sourceUrl: localFileRef.current ? undefined : customIsoUrl.trim() || preset?.url,
            device: preset ? preset.device : bootDevice,
            ramMb: memoryMb,
            sizeHint: preset?.size,
            label: preset?.name || file.name,
            initialStateBuffer: buffer,
          });
          showToast(`Booted with snapshot ${file.name}.`, 'success');
        }
      } catch (err) {
        const msg =
          err instanceof Error
            ? err.message
            : 'Unable to restore snapshot file. Match the RAM size and OS image used when saving.';
        showToast(msg, 'error');
      }
    },
    [
      bootDevice,
      bootEmulator,
      customIsoUrl,
      fitScreenToViewport,
      memoryMb,
      selectedPresetId,
      showToast,
      status,
    ]
  );

  const handleTogglePointerLock = useCallback(() => {
    const emu = emulatorRef.current;
    if (!emu) return;

    if (document.pointerLockElement) {
      document.exitPointerLock?.();
      return;
    }

    if (typeof document.documentElement.requestPointerLock !== 'function') {
      showToast('Pointer lock is unavailable on touch devices. Drag directly on screen to move cursor.', 'info');
      return;
    }

    try {
      emu.lock_mouse();
    } catch {
      showToast('Click inside the desktop canvas to capture the mouse pointer.', 'info');
    }
  }, [showToast]);

  const handleToggleFullscreen = useCallback(() => {
    const doc = document as SafariDocument;
    const root = document.documentElement as SafariElement;

    if (!doc.fullscreenElement && !doc.webkitFullscreenElement) {
      if (root.requestFullscreen) {
        root.requestFullscreen().catch(() => {
          showToast('Fullscreen request was blocked by the browser.', 'info');
        });
      } else if (root.webkitRequestFullscreen) {
        root.webkitRequestFullscreen();
      } else {
        showToast('Fullscreen API is not supported in this browser.', 'info');
      }
    } else if (doc.exitFullscreen) {
      doc.exitFullscreen().catch(() => {});
    } else if (doc.webkitExitFullscreen) {
      doc.webkitExitFullscreen();
    }
  }, [showToast]);

  const handleInputFocusChange = useCallback((focused: boolean) => {
    emulatorRef.current?.keyboard_set_enabled?.(!focused);
  }, []);

  const handleSendScancodes = useCallback((codes: number[]) => {
    emulatorRef.current?.keyboard_send_scancodes?.(codes);
  }, []);

  const handleSendText = useCallback((text: string) => {
    emulatorRef.current?.keyboard_send_text?.(text);
  }, []);

  // Touch-to-mouse emulation for iPadOS Safari / tablets
  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (status !== 'running' || !emulatorRef.current) return;
    const touch = e.touches[0];
    if (!touch) return;
    touchStateRef.current = {
      active: true,
      startX: touch.clientX,
      startY: touch.clientY,
      lastX: touch.clientX,
      lastY: touch.clientY,
      moved: false,
      startTime: performance.now(),
      maxTouches: Math.max(touchStateRef.current.maxTouches, e.touches.length),
    };
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    const emu = emulatorRef.current;
    const ts = touchStateRef.current;
    if (status !== 'running' || !emu || !ts.active) return;

    const touch = e.touches[0];
    if (!touch) return;

    const dx = touch.clientX - ts.lastX;
    const dy = touch.clientY - ts.lastY;
    const totalDist = Math.hypot(touch.clientX - ts.startX, touch.clientY - ts.startY);

    if (totalDist > 6) {
      ts.moved = true;
    }

    ts.lastX = touch.clientX;
    ts.lastY = touch.clientY;
    ts.maxTouches = Math.max(ts.maxTouches, e.touches.length);

    if (emu.bus && (dx !== 0 || dy !== 0)) {
      emu.bus.send('mouse-delta', [dx * 1.4, -dy * 1.4]);
    }
  };

  const handleTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    const emu = emulatorRef.current;
    const ts = touchStateRef.current;
    if (!ts.active) return;

    if (e.touches.length === 0) {
      const elapsed = performance.now() - ts.startTime;
      if (status === 'running' && emu?.bus && !ts.moved && elapsed < 300) {
        if (ts.maxTouches >= 2) {
          emu.bus.send('mouse-click', [false, false, true]);
          window.setTimeout(() => emu.bus?.send('mouse-click', [false, false, false]), 45);
        } else {
          emu.bus.send('mouse-click', [true, false, false]);
          window.setTimeout(() => emu.bus?.send('mouse-click', [false, false, false]), 45);
        }
      }
      ts.active = false;
      ts.maxTouches = 0;
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    if (e.currentTarget === e.target) {
      setIsDragOver(false);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file && /\.(iso|img|bin)$/i.test(file.name)) {
      handleUploadIso(file);
    } else if (file) {
      showToast('Drop a bootable .iso, .img, or .bin disk image.', 'error');
    }
  };

  const retryScriptLoad = () => {
    const existing = document.getElementById('v86-runtime-script');
    existing?.remove();
    setV86Error(null);
    setScriptAttempt((n) => n + 1);
  };

  return (
    <div
      className="flex flex-col h-dvh w-screen bg-[#090d16] text-slate-200 overflow-hidden select-none"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <EmulatorToolbar
        status={status}
        v86Ready={v86Ready}
        v86Error={v86Error}
        ips={ips}
        memoryMb={memoryMb}
        selectedPresetId={selectedPresetId}
        customIsoUrl={customIsoUrl}
        localFileName={localFileName}
        bootDevice={bootDevice}
        crispScaling={crispScaling}
        isFullscreen={isFullscreen}
        isPointerLocked={isPointerLocked}
        showKeyboard={showKeyboard}
        openMenu={openMenu}
        snapshots={snapshots}
        isSavingState={isSavingState}
        onToggleMenu={(menu) => setOpenMenu((prev) => (prev === menu ? null : menu))}
        onSelectPreset={handleSelectPreset}
        onCustomUrlChange={(val) => {
          localFileRef.current = null;
          setLocalFileName(null);
          setCustomIsoUrl(val);
        }}
        onBootDeviceChange={setBootDevice}
        onMemoryChange={setMemoryMb}
        onToggleCrispScaling={() => setCrispScaling((prev) => !prev)}
        onPowerOn={handlePowerOn}
        onPowerOff={() => void handlePowerOff()}
        onTogglePause={() => void handleTogglePause()}
        onReset={handleReset}
        onUploadIso={handleUploadIso}
        onSaveSnapshotDb={() => void handleSaveSnapshotDb()}
        onRestoreSnapshotDb={(id) => void handleRestoreSnapshotDb(id)}
        onDeleteSnapshotDb={(id) => void handleDeleteSnapshotDb(id)}
        onDownloadStateFile={() => void handleDownloadStateFile()}
        onUploadStateFile={(file) => void handleUploadStateFile(file)}
        onTogglePointerLock={handleTogglePointerLock}
        onToggleFullscreen={handleToggleFullscreen}
        onToggleKeyboard={() => setShowKeyboard((prev) => !prev)}
        onInputFocusChange={handleInputFocusChange}
      />

      {/* Always-mounted hidden file input for idle & error states */}
      <input
        ref={fileDropInputRef}
        type="file"
        accept=".iso,.img,.bin"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleUploadIso(file);
          if (fileDropInputRef.current) fileDropInputRef.current.value = '';
        }}
        className="hidden"
      />

      {/* Main Display Viewport */}
      <main
        ref={viewportRef}
        className="flex-1 relative bg-black flex items-center justify-center overflow-hidden min-h-0"
        onClick={() => {
          if (openMenu) setOpenMenu(null);
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/*
          v86 Screen Target:
          - Always rendered in layout (never display: none) so ScreenAdapter.getBoundingClientRect() never measures 0x0.
          - Empty in JSX so React never reconciles or overwrites the imperative <div> and <canvas> managed by v86.
        */}
        <div
          ref={screenRef}
          id="screen_container"
          className={`v86-screen-host ${crispScaling ? 'v86-crisp' : ''}`}
        />

        {/* Boot / Image Download Progress Overlay */}
        {status === 'loading' && (
          <div className="absolute inset-0 z-20 bg-[#090d16]/95 flex flex-col items-center justify-center px-6">
            <div className="w-full max-w-md space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-slate-200 truncate">
                  Loading {activeImageLabel}
                </span>
                <span className="font-mono tabular-nums text-slate-400 shrink-0 ml-2">
                  {downloadProgress?.percent != null
                    ? `${downloadProgress.percent}%`
                    : downloadProgress && downloadProgress.loaded > 0
                      ? formatBytes(downloadProgress.loaded)
                      : 'Preparing'}
                </span>
              </div>
              <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-sky-500 transition-[width] duration-150"
                  style={{
                    width:
                      downloadProgress?.percent != null ? `${downloadProgress.percent}%` : '25%',
                  }}
                />
              </div>
              <p className="text-[11px] font-mono text-slate-500 truncate">
                {downloadProgress
                  ? `Fetching ${downloadProgress.fileName}${downloadProgress.total > 0 ? ` (${formatBytes(downloadProgress.loaded)} / ${formatBytes(downloadProgress.total)})` : ''}`
                  : 'Allocating x86 memory and SeaBIOS ROM...'}
              </p>
            </div>
          </div>
        )}

        {/* Paused Overlay Banner */}
        {status === 'paused' && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 bg-slate-900/95 border border-slate-700 rounded-md px-4 py-2 flex items-center gap-3 shadow-lg">
            <span className="text-xs font-medium text-amber-300">Execution Paused</span>
            <button
              type="button"
              onClick={() => void handleTogglePause()}
              className="h-7 px-2.5 rounded bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium flex items-center gap-1"
            >
              <Play className="w-3 h-3" />
              <span>Resume</span>
            </button>
          </div>
        )}

        {/* Idle / Standby Launcher */}
        {status === 'stopped' && (
          <div className="absolute inset-0 z-10 overflow-y-auto flex items-center justify-center p-6 bg-[#090d16]">
            <div className="w-full max-w-3xl space-y-6">
              <div className="space-y-2">
                <div className="flex items-center gap-2.5 text-slate-100">
                  <Monitor className="w-6 h-6 text-sky-400 shrink-0" />
                  <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">
                    x86 Desktop Virtual Machine
                  </h1>
                </div>
                <p className="text-sm text-slate-400 max-w-2xl leading-relaxed">
                  Boot lightweight graphical Linux desktops directly inside your browser&apos;s WebAssembly sandbox. Select a verified X11 distribution below or drop a local Puppy Linux / Tiny Core ISO to run offline.
                </p>
              </div>

              {v86Error && (
                <div className="p-4 rounded-md bg-red-950/50 border border-red-800/80 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-2.5 text-xs text-red-200">
                    <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                    <span>{v86Error}</span>
                  </div>
                  <button
                    type="button"
                    onClick={retryScriptLoad}
                    className="h-8 px-3 rounded bg-red-900 hover:bg-red-800 text-red-100 text-xs font-medium flex items-center gap-1.5 shrink-0"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Retry</span>
                  </button>
                </div>
              )}

              {/* Quick-launch OS Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {OS_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    disabled={!v86Ready}
                    onClick={() => handleBootPresetNow(preset)}
                    className="group text-left p-4 rounded-md bg-slate-900/90 hover:bg-slate-800/90 border border-slate-800 hover:border-sky-500/60 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-slate-100 group-hover:text-white">
                        {preset.name}
                      </span>
                      <span className="text-[11px] font-mono text-sky-400 opacity-80 group-hover:opacity-100">
                        Boot →
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mt-1">{preset.subtitle}</p>
                    <div className="text-[11px] font-mono tabular-nums text-slate-500 mt-2.5">
                      {preset.recommendedRamMb} MB RAM · {preset.device.toUpperCase()} ·{' '}
                      {preset.graphical ? 'Graphical Desktop' : 'Terminal'}
                    </div>
                  </button>
                ))}
              </div>

              {/* Local Offline ISO Drop Zone */}
              <div className="p-4 rounded-md bg-slate-900/50 border border-dashed border-slate-700 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div>
                  <h2 className="text-xs font-semibold text-slate-200">
                    Boot Local Puppy Linux or Custom x86 ISO Offline
                  </h2>
                  <p className="text-xs text-slate-400 mt-1">
                    Drag and drop any <span className="font-mono text-slate-300">.iso</span> or{' '}
                    <span className="font-mono text-slate-300">.img</span> file anywhere on this window, or choose one from device storage.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={!v86Ready}
                  onClick={() => fileDropInputRef.current?.click()}
                  className="h-9 px-4 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-100 text-xs font-medium border border-slate-700 flex items-center gap-2 whitespace-nowrap shrink-0 disabled:opacity-40"
                >
                  <HardDriveUpload className="w-3.5 h-3.5 text-sky-400" />
                  <span>Choose Local ISO</span>
                </button>
              </div>

              {/* Quiet hardware specs footer line */}
              <div className="text-[11px] font-mono tabular-nums text-slate-500 flex flex-wrap items-center gap-x-2 gap-y-1">
                <span>Bochs VGA / SeaBIOS</span>
                <span aria-hidden="true">·</span>
                <span>{memoryMb} MB RAM</span>
                <span aria-hidden="true">·</span>
                <span>WebAssembly JIT</span>
                <span aria-hidden="true">·</span>
                <span>{v86Ready ? 'Engine Ready' : 'Loading v86 Runtime...'}</span>
              </div>
            </div>
          </div>
        )}

        {/* Boot Error State */}
        {status === 'error' && (
          <div className="absolute inset-0 z-20 flex items-center justify-center p-6 bg-[#090d16]">
            <div className="w-full max-w-lg p-6 rounded-md bg-slate-900 border border-red-900/70 space-y-4">
              <div className="flex items-center gap-2.5 text-red-400">
                <AlertTriangle className="w-5 h-5 shrink-0" />
                <h2 className="text-base font-semibold text-slate-100">Boot Failed</h2>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                {errorMessage ?? 'Unable to initialize the selected image.'}
              </p>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => handleBootPresetNow(DEFAULT_PRESET)}
                  className="h-9 px-3.5 rounded-md bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium"
                >
                  Boot Tiny Core Linux (Verified)
                </button>
                <button
                  type="button"
                  onClick={() => fileDropInputRef.current?.click()}
                  className="h-9 px-3.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700"
                >
                  Load Local ISO
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setStatus('stopped');
                    setErrorMessage(null);
                  }}
                  className="h-9 px-3.5 rounded-md bg-transparent hover:bg-slate-800 text-slate-400 text-xs font-medium"
                >
                  Return to Launcher
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Drag-and-drop overlay indicator */}
        {isDragOver && (
          <div className="absolute inset-0 z-40 bg-sky-950/80 border-2 border-dashed border-sky-400 flex flex-col items-center justify-center pointer-events-none">
            <HardDriveUpload className="w-10 h-10 text-sky-300 mb-2" />
            <p className="text-sm font-medium text-white">Drop ISO or Disk Image to Boot</p>
          </div>
        )}

        {/* Non-blocking Toast Feedback */}
        {toast && (
          <div
            role="status"
            aria-live="polite"
            className={`absolute bottom-4 right-4 z-40 max-w-sm px-3.5 py-2.5 rounded-md border text-xs flex items-center gap-3 shadow-lg ${
              toast.tone === 'error'
                ? 'bg-red-950/95 border-red-800 text-red-100'
                : toast.tone === 'success'
                  ? 'bg-emerald-950/95 border-emerald-800 text-emerald-100'
                  : 'bg-slate-900/95 border-slate-700 text-slate-100'
            }`}
          >
            <span className="leading-snug">{toast.text}</span>
            <button
              type="button"
              onClick={() => setToast(null)}
              aria-label="Dismiss notification"
              className="text-current opacity-70 hover:opacity-100 shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </main>

      {/* Interactive Virtual Keyboard (Touch / iPadOS + Special Keys) */}
      <VirtualKeyboard
        visible={showKeyboard}
        onClose={() => setShowKeyboard(false)}
        onSendScancodes={handleSendScancodes}
        onSendText={handleSendText}
        onInputFocusChange={handleInputFocusChange}
      />
    </div>
  );
}
