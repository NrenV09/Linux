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
  PresetKind,
  PuppyDirectBootParams,
  SavedSnapshotMeta,
  SharedHostFile,
  V86Config,
  V86Instance,
  WebServerEngine,
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
import {
  buildAutoNetworkScript,
  buildFat16DiskImage,
  buildMount9pScript,
  buildWebServerScript,
  createDefaultWebFiles,
  encodeUtf8,
  guessMimeType,
  listVm9pDirectory,
  readFileFromVm9p,
  sanitizeGuestFilename,
  writeFileToVm9p,
} from './lib/guestBridge';
import {
  FAST_PUPPY_CMDLINE,
  attachFastIsoReadAheadCache,
  inspectAndExtractPuppyIso,
} from './lib/isoPuppyExtractor';
import { EmulatorToolbar } from './components/EmulatorToolbar';
import { VirtualKeyboard } from './components/VirtualKeyboard';
import { TouchMouseBar } from './components/TouchMouseBar';
import { PuppySetupModal } from './components/PuppySetupModal';
import { GuestToolsModal } from './components/GuestToolsModal';

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

const DEFAULT_PRESET = OS_PRESETS[0]; // Arch Linux (Full Rolling)

function isCoarseTouchDevice(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia?.('(pointer: coarse)').matches ||
    'ontouchstart' in window ||
    navigator.maxTouchPoints > 0
  );
}

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

  // Unified mouse button state (shared by physical mouse, trackpad, touch drag, and thumb hold button)
  const mouseButtonsRef = useRef({ left: false, middle: false, right: false });
  const thumbLeftHeldRef = useRef(false);
  const vmwareAbsoluteMouseRef = useRef(false);
  const pointerPosRef = useRef<{ x: number; y: number; initialized: boolean }>({
    x: 0,
    y: 0,
    initialized: false,
  });

  // Touch gesture state (tap, double-tap-and-drag, drag+left-click mode, 550ms long-press & 2-finger right-click, 2-finger scroll)
  const touchStateRef = useRef<{
    active: boolean;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    moved: boolean;
    startTime: number;
    maxTouches: number;
    holdingLeftForDrag: boolean;
    longPressTimer: number | null;
    longPressFired: boolean;
    scrollAccumY: number;
    lastTapTime: number;
    lastTapX: number;
    lastTapY: number;
  }>({
    active: false,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
    moved: false,
    startTime: 0,
    maxTouches: 0,
    holdingLeftForDrag: false,
    longPressTimer: null,
    longPressFired: false,
    scrollAccumY: 0,
    lastTapTime: 0,
    lastTapX: 0,
    lastTapY: 0,
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
  const [vramMb, setVramMb] = useState<number>(DEFAULT_PRESET.recommendedVramMb ?? 8);
  const [networkEnabled, setNetworkEnabled] = useState<boolean>(true);
  const [netDeviceType, setNetDeviceType] = useState<'ne2k' | 'virtio'>('ne2k');
  const [networkRelayUrl, setNetworkRelayUrl] = useState<string>('fetch');
  const [attachTransferDrive, setAttachTransferDrive] = useState<boolean>(false);
  const [activeImageLabel, setActiveImageLabel] = useState<string>(DEFAULT_PRESET.name);

  const [sharedFiles, setSharedFiles] = useState<SharedHostFile[]>(() => createDefaultWebFiles());
  const sharedFilesRef = useRef<SharedHostFile[]>(sharedFiles);
  const activeBootKindRef = useRef<PresetKind>('state-9p');
  const lastBootOptionsRef = useRef<{
    kind: PresetKind;
    sourceUrl?: string;
    localFile?: File | null;
    vmlinuzFile?: File | null;
    initrdFile?: File | null;
    vmlinuzBuffer?: ArrayBuffer;
    initrdBuffer?: ArrayBuffer;
    device: BootDevice;
    ramMb: number;
    vramMb: number;
    sizeHint?: number;
    label: string;
    cmdline?: string;
    filesystemBaseUrl?: string;
    netDeviceType?: 'virtio' | 'ne2k';
    networkRelayUrl?: string;
    bootHint?: string;
  } | null>(null);
  const [webServerEngine, setWebServerEngine] = useState<WebServerEngine>('busybox');
  const [webServerPort, setWebServerPort] = useState<number>(8080);

  const [crispScaling, setCrispScaling] = useState(true);
  const [dragMode, setDragMode] = useState(false);
  const [leftButtonHeldUi, setLeftButtonHeldUi] = useState(false);
  const [showTouchBar, setShowTouchBar] = useState<boolean>(() => isCoarseTouchDevice());
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPointerLocked, setIsPointerLocked] = useState(false);
  const [showKeyboard, setShowKeyboard] = useState(false);
  const [showPuppyModal, setShowPuppyModal] = useState(false);
  const [guestToolsState, setGuestToolsState] = useState<{
    open: boolean;
    tab: 'network' | 'files' | 'web';
  }>({ open: false, tab: 'network' });
  const [openMenu, setOpenMenu] = useState<'config' | 'state' | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  useEffect(() => {
    sharedFilesRef.current = sharedFiles;
  }, [sharedFiles]);

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
    }, 5000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  // Low-level PS/2 + VMware absolute mouse dispatch helpers
  const emitMouseButtons = useCallback((left: boolean, middle: boolean, right: boolean) => {
    const emu = emulatorRef.current;
    mouseButtonsRef.current = { left, middle, right };
    emu?.bus?.send('mouse-click', [left, middle, right]);
  }, []);

  const emitMouseDelta = useCallback((dx: number, dy: number) => {
    const emu = emulatorRef.current;
    if (!emu?.bus || (dx === 0 && dy === 0)) return;
    // PS/2 Y axis is inverted relative to browser screen Y
    emu.bus.send('mouse-delta', [dx, -dy]);
  }, []);

  const emitMouseAbsolute = useCallback((clientX: number, clientY: number) => {
    const emu = emulatorRef.current;
    const container = screenRef.current;
    if (!emu?.bus || !container || document.pointerLockElement) return;
    const canvas = container.querySelector('canvas');
    const targetEl = canvas && canvas.style.display !== 'none' ? canvas : container;
    const rect = targetEl.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
      const y = Math.max(0, Math.min(rect.height, clientY - rect.top));
      emu.bus.send('mouse-absolute', [x, y, rect.width, rect.height]);
    }
  }, []);

  // Linux's vmmouse driver drains VMMouse.queue on PS/2 IRQ 12; re-sending current button state triggers IRQ 12 cleanly
  const pokeVmmouseIrq = useCallback(() => {
    if (!vmwareAbsoluteMouseRef.current || document.pointerLockElement) return;
    const emu = emulatorRef.current;
    if (!emu?.bus) return;
    const b = mouseButtonsRef.current;
    emu.bus.send('mouse-click', [b.left, b.middle, b.right]);
  }, []);

  const emitMouseWheel = useCallback((deltaY: number) => {
    const emu = emulatorRef.current;
    if (!emu?.bus || deltaY === 0) return;
    emu.bus.send('mouse-wheel', [deltaY > 0 ? 1 : -1, 0]);
  }, []);

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

  useEffect(() => {
    const id = window.requestAnimationFrame(() => fitScreenToViewport());
    return () => window.cancelAnimationFrame(id);
  }, [showKeyboard, isFullscreen, fitScreenToViewport]);

  // Global document mouse listeners when Desktop Pointer Lock is active
  useEffect(() => {
    if (!isPointerLocked || status !== 'running') return;

    const handleLockedMove = (e: MouseEvent) => {
      if (e.movementX !== 0 || e.movementY !== 0) {
        emitMouseDelta(e.movementX, e.movementY);
      }
    };

    const handleLockedDown = (e: MouseEvent) => {
      e.preventDefault();
      const b = { ...mouseButtonsRef.current };
      if (e.button === 0) b.left = true;
      else if (e.button === 1) b.middle = true;
      else if (e.button === 2) b.right = true;
      emitMouseButtons(b.left, b.middle, b.right);
    };

    const handleLockedUp = (e: MouseEvent) => {
      e.preventDefault();
      const b = { ...mouseButtonsRef.current };
      if (e.button === 0) b.left = false;
      else if (e.button === 1) b.middle = false;
      else if (e.button === 2) b.right = false;
      emitMouseButtons(b.left, b.middle, b.right);
    };

    const handleLockedWheel = (e: WheelEvent) => {
      e.preventDefault();
      emitMouseWheel(e.deltaY < 0 ? 1 : -1);
    };

    document.addEventListener('mousemove', handleLockedMove);
    document.addEventListener('mousedown', handleLockedDown);
    document.addEventListener('mouseup', handleLockedUp);
    document.addEventListener('wheel', handleLockedWheel, { passive: false });

    return () => {
      document.removeEventListener('mousemove', handleLockedMove);
      document.removeEventListener('mousedown', handleLockedDown);
      document.removeEventListener('mouseup', handleLockedUp);
      document.removeEventListener('wheel', handleLockedWheel);
    };
  }, [emitMouseButtons, emitMouseDelta, emitMouseWheel, isPointerLocked, status]);

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

  useEffect(() => {
    return () => {
      if (touchStateRef.current.longPressTimer !== null) {
        window.clearTimeout(touchStateRef.current.longPressTimer);
        touchStateRef.current.longPressTimer = null;
      }
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

  useEffect(() => {
    const doc = document as SafariDocument;
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(doc.fullscreenElement || doc.webkitFullscreenElement));
    };
    const handlePointerLockChange = () => {
      const locked = Boolean(document.pointerLockElement);
      setIsPointerLocked(locked);
      emulatorRef.current?.bus?.send('mouse-pointer-lock', locked);
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
    if (touchStateRef.current.longPressTimer !== null) {
      window.clearTimeout(touchStateRef.current.longPressTimer);
      touchStateRef.current.longPressTimer = null;
    }
    mouseButtonsRef.current = { left: false, middle: false, right: false };
    thumbLeftHeldRef.current = false;
    vmwareAbsoluteMouseRef.current = false;
    setLeftButtonHeldUi(false);

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

  const get9pPrefix = useCallback(() => {
    return activeBootKindRef.current === 'state-9p' ? '/mnt/ipad' : '';
  }, []);

  const syncAllFilesToVm9p = useCallback(
    async (emu: V86Instance) => {
      const prefix = get9pPrefix();
      // Write ready-to-run helper scripts into the live 9p share
      await Promise.all([
        writeFileToVm9p(emu, `${prefix}/net-auto.sh`, encodeUtf8(buildAutoNetworkScript())),
        writeFileToVm9p(emu, `${prefix}/mount-ipad.sh`, encodeUtf8(buildMount9pScript())),
        writeFileToVm9p(
          emu,
          `${prefix}/websrv.sh`,
          encodeUtf8(buildWebServerScript(webServerEngine, webServerPort))
        ),
      ]);

      const currentFiles = sharedFilesRef.current;
      const results = await Promise.all(
        currentFiles.map(async (file) => {
          const targetPath =
            file.folder === 'www' ? `${prefix}/www/${file.name}` : `${prefix}/${file.name}`;
          const ok = await writeFileToVm9p(emu, targetPath, file.data);
          return { key: `${file.folder}:${file.name}`, ok };
        })
      );

      const syncedKeys = new Set(results.filter((r) => r.ok).map((r) => r.key));
      if (syncedKeys.size > 0) {
        setSharedFiles((prev) =>
          prev.map((f) =>
            syncedKeys.has(`${f.folder}:${f.name}`) ? { ...f, syncedTo9p: true } : f
          )
        );
      }
    },
    [get9pPrefix, webServerEngine, webServerPort]
  );

  const bootEmulator = useCallback(
    async (options: {
      kind: PresetKind;
      sourceUrl?: string;
      localFile?: File | null;
      vmlinuzFile?: File | null;
      initrdFile?: File | null;
      vmlinuzBuffer?: ArrayBuffer;
      initrdBuffer?: ArrayBuffer;
      device: BootDevice;
      ramMb: number;
      vramMb: number;
      sizeHint?: number;
      label: string;
      cmdline?: string;
      filesystemBaseUrl?: string;
      netDeviceType?: 'virtio' | 'ne2k';
      networkRelayUrl?: string;
      bootHint?: string;
      initialStateBuffer?: ArrayBuffer;
      forceAttachDrive?: boolean;
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
        // Automatically detect Puppy Linux ISOs (e.g. NoblePup32, BookwormPup32) and direct-boot vmlinuz + initrd
        // with pfix=ram,nocopy so Puppy never spends 4+ minutes copying 350 MB of .sfs layers into guest RAM.
        let effectiveKind: PresetKind = options.kind;
        let effectiveVmlinuzBuffer = options.vmlinuzBuffer;
        let effectiveInitrdBuffer = options.initrdBuffer;
        let effectiveCmdline = options.cmdline;
        let effectiveBootHint = options.bootHint;

        if (
          effectiveKind === 'disk' &&
          options.device === 'cdrom' &&
          options.localFile &&
          options.localFile.name.toLowerCase().endsWith('.iso')
        ) {
          setDownloadProgress({
            fileName: `Inspecting ${options.localFile.name}`,
            loaded: 0,
            total: 0,
            percent: null,
          });
          const extracted = await inspectAndExtractPuppyIso(options.localFile);
          if (controller.signal.aborted) return;
          if (extracted) {
            effectiveKind = 'puppy-direct';
            effectiveVmlinuzBuffer = extracted.vmlinuzBuffer;
            effectiveInitrdBuffer = extracted.initrdBuffer;
            effectiveCmdline = effectiveCmdline || FAST_PUPPY_CMDLINE;
            effectiveBootHint =
              'Fast Puppy Direct Boot active (pfix=ram,nocopy + 2 MB ISO read-ahead cache). Tip: use State → Save Snapshot at the desktop for 2-second future boots.';
          }
        }

        activeBootKindRef.current = effectiveKind;
        lastBootOptionsRef.current = {
          kind: effectiveKind,
          sourceUrl: options.sourceUrl,
          localFile: options.localFile,
          vmlinuzFile: options.vmlinuzFile,
          initrdFile: options.initrdFile,
          vmlinuzBuffer: effectiveVmlinuzBuffer,
          initrdBuffer: effectiveInitrdBuffer,
          device: options.device,
          ramMb: options.ramMb,
          vramMb: options.vramMb,
          sizeHint: options.sizeHint,
          label: options.label,
          cmdline: effectiveCmdline,
          filesystemBaseUrl: options.filesystemBaseUrl,
          netDeviceType: options.netDeviceType,
          networkRelayUrl: options.networkRelayUrl,
          bootHint: effectiveBootHint,
        };

        setDownloadProgress({
          fileName: 'SeaBIOS & VGA BIOS',
          loaded: 0,
          total: 0,
          percent: null,
        });
        const { bios, vgaBios } = await loadBiosBuffers(controller.signal);

        let downloadedBuffer: ArrayBuffer | undefined;
        if (!options.localFile && options.sourceUrl) {
          downloadedBuffer = await fetchBinaryWithProgress(options.sourceUrl, {
            expectedSize: options.sizeHint,
            signal: controller.signal,
            onProgress: (prog) => setDownloadProgress(prog),
          });
        }

        if (controller.signal.aborted || !screenRef.current) return;

        resetScreenContainerDom();

        // State-9p presets (e.g. Arch Linux) must match the snapshot's exact RAM/VRAM topology (512 MB).
        // All other Linux presets, local ISOs, and Puppy direct-kernel boots support up to 2048 MB (2 GB).
        const effectiveRamMb =
          effectiveKind === 'state-9p'
            ? 512
            : Math.min(2048, Math.max(256, options.ramMb));
        const effectiveVramMb =
          effectiveKind === 'state-9p' || effectiveKind === 'puppy-direct' ? 8 : options.vramMb;

        const config: V86Config = {
          wasm_path: V86_ASSETS.wasmUrl,
          memory_size: effectiveRamMb * 1024 * 1024,
          vga_memory_size: effectiveVramMb * 1024 * 1024,
          screen_container: screenRef.current,
          bios: { buffer: bios },
          vga_bios: { buffer: vgaBios },
          autostart: true,
          acpi: false,
          disable_jit: false,
          // Disable built-in MouseAdapter so our unified precision Pointer + Touch Drag driver has zero double-events
          disable_mouse: true,
        };

        // Automatic network configuration on ALL Puppy Linux & local ISOs (ne2k_pci + fetch auto-DHCP by default)
        const shouldAttachNet =
          networkEnabled || effectiveKind === 'puppy-direct' || Boolean(options.localFile);
        if (shouldAttachNet) {
          config.net_device = {
            type: options.netDeviceType ?? netDeviceType,
            relay_url: options.networkRelayUrl ?? networkRelayUrl,
          };
        } else if (options.netDeviceType) {
          config.net_device = { type: options.netDeviceType };
        }

        // Build compact 4MB MBR-partitioned FAT16 IPAD_FILES drive only when enabled or when user queued iPad files
        const hasImportedIpadFiles = sharedFilesRef.current.some((f) => f.folder === 'ipad');
        const shouldAttachFatDrive = Boolean(
          options.forceAttachDrive || attachTransferDrive || hasImportedIpadFiles
        );
        const buildHelperDriveIfEnabled = () => {
          if (!shouldAttachFatDrive) return undefined;
          const currentFiles = sharedFilesRef.current;
          const rootEntries = [
            { name: 'net-auto.sh', data: encodeUtf8(buildAutoNetworkScript()) },
            { name: 'mount-ipad.sh', data: encodeUtf8(buildMount9pScript()) },
            {
              name: 'websrv.sh',
              data: encodeUtf8(buildWebServerScript(webServerEngine, webServerPort)),
            },
            ...currentFiles
              .filter((f) => f.folder === 'ipad')
              .map((f) => ({ name: f.name, data: f.data })),
          ];
          const wwwEntries = currentFiles
            .filter((f) => f.folder === 'www')
            .map((f) => ({ name: f.name, data: f.data }));
          return buildFat16DiskImage(rootEntries, wwwEntries, 'IPAD_FILES');
        };

        if (effectiveKind === 'state-9p') {
          if (options.filesystemBaseUrl) {
            config.filesystem = { baseurl: options.filesystemBaseUrl };
          }
          if (options.initialStateBuffer || downloadedBuffer) {
            config.initial_state = {
              buffer: options.initialStateBuffer ?? downloadedBuffer,
            };
          }
          config.preserve_mac_from_state_image = true;
        } else if (effectiveKind === 'puppy-direct') {
          // Direct kernel + initrd boot alongside async-streamed CD-ROM ISO (with 2 MB read-ahead LRU cache)
          if (effectiveVmlinuzBuffer) {
            config.bzimage = { buffer: effectiveVmlinuzBuffer, async: false };
          } else if (options.vmlinuzFile) {
            config.bzimage = { buffer: options.vmlinuzFile };
          }
          if (effectiveInitrdBuffer) {
            config.initrd = { buffer: effectiveInitrdBuffer, async: false };
          } else if (options.initrdFile) {
            config.initrd = { buffer: options.initrdFile };
          }
          if (options.localFile) {
            config.cdrom = { buffer: options.localFile, async: true };
          }
          config.cmdline = effectiveCmdline || FAST_PUPPY_CMDLINE;
          // Enable live 9p share (+ optional compact FAT16 drive if enabled/populated)
          config.filesystem = {};
          const fatDrive = buildHelperDriveIfEnabled();
          if (fatDrive) {
            config.hda = { buffer: fatDrive, async: false };
          }
          if (options.initialStateBuffer) {
            config.initial_state = { buffer: options.initialStateBuffer };
          }
        } else if (effectiveKind === 'bzimage') {
          if (downloadedBuffer) {
            config.bzimage = { buffer: downloadedBuffer, async: false };
          }
          config.cmdline = effectiveCmdline;
          config.filesystem = {};
          if (options.initialStateBuffer) {
            config.initial_state = { buffer: options.initialStateBuffer };
          }
        } else {
          // Standard ISO / IMG / Floppy boot (stream large local files via AsyncFileBuffer + 2 MB read-ahead cache)
          config.boot_order = BOOT_ORDER[options.device];
          const diskPayload = options.localFile ?? downloadedBuffer;
          if (diskPayload) {
            const useAsyncFileBuffer = Boolean(
              options.localFile && options.localFile.size >= 128 * 1024 * 1024
            );
            config[options.device] = {
              buffer: diskPayload,
              async: useAsyncFileBuffer,
            };
          }
          // Attach live 9p share on local ISO boots (avoid extra VirtIO PCI device on legacy presets like DSL/Kolibri)
          if (options.localFile && options.device !== 'fda') {
            config.filesystem = {};
          }
          if (options.device === 'cdrom' && options.localFile) {
            const fatDrive = buildHelperDriveIfEnabled();
            if (fatDrive) {
              config.hda = { buffer: fatDrive, async: false };
            }
          }
          if (options.initialStateBuffer) {
            config.initial_state = { buffer: options.initialStateBuffer };
          }
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

        const isoFileForCache =
          options.localFile && (effectiveKind === 'puppy-direct' || options.device === 'cdrom')
            ? options.localFile
            : null;
        const installIsoCache = () => {
          if (isoFileForCache) {
            attachFastIsoReadAheadCache(emulator, isoFileForCache);
          }
        };

        let hintShown = false;
        let synced9pOnce = false;
        const markRunning = (allowSync9p: boolean) => {
          installIsoCache();
          setDownloadProgress(null);
          setStatus('running');
          lastTickRef.current = performance.now();
          lastInstrRef.current = emulator.get_instruction_counter?.() ?? 0;
          window.requestAnimationFrame(() => fitScreenToViewport());
          window.setTimeout(() => fitScreenToViewport(), 250);
          // Only sync 9p AFTER emulator-loaded (never before restore_state!) and never mutate Arch state-9p on boot
          if (allowSync9p && !synced9pOnce && effectiveKind !== 'state-9p' && config.filesystem) {
            synced9pOnce = true;
            void syncAllFilesToVm9p(emulator);
          }
          if (!hintShown && effectiveBootHint) {
            hintShown = true;
            showToast(effectiveBootHint, 'info');
          }
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

        // Attach 32 MB sliding read-ahead ISO cache as soon as devices.cdrom exists (without mutating UI/9p yet)
        emulator.add_listener('emulator-ready', () => installIsoCache());

        // Wait for emulator-loaded / emulator-started (fires AFTER restore_state and v86.run())
        emulator.add_listener('emulator-loaded', () => markRunning(true));
        emulator.add_listener('emulator-started', () => markRunning(false));

        // Track VMware VMMouse absolute pointer mode (used automatically by NoblePup32, BookwormPup32, modern Linux 6.x)
        emulator.add_listener('vmware-absolute-mouse', (enabled: unknown) => {
          vmwareAbsoluteMouseRef.current = Boolean(enabled);
        });

        // Real v86 ScreenAdapter resize/mode events
        emulator.add_listener('screen-set-size-graphical', () => {
          window.requestAnimationFrame(() => fitScreenToViewport());
        });
        emulator.add_listener('screen-set-size-text', () => {
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
      attachTransferDrive,
      destroyCurrentEmulator,
      fitScreenToViewport,
      loadBiosBuffers,
      netDeviceType,
      networkEnabled,
      networkRelayUrl,
      resetScreenContainerDom,
      showToast,
      syncAllFilesToVm9p,
      webServerEngine,
      webServerPort,
    ]
  );

  const handlePowerOn = useCallback(() => {
    if (localFileRef.current) {
      void bootEmulator({
        kind: 'disk',
        localFile: localFileRef.current,
        device: bootDevice,
        ramMb: memoryMb,
        vramMb,
        label: localFileRef.current.name,
      });
      return;
    }

    const trimmedUrl = customIsoUrl.trim();
    const preset = OS_PRESETS.find((p) => p.id === selectedPresetId && p.url === trimmedUrl);
    if (!trimmedUrl) {
      showToast('Select a Linux preset, enter a CORS-enabled URL, or load a local ISO.', 'error');
      return;
    }

    void bootEmulator({
      kind: preset ? preset.kind : 'disk',
      sourceUrl: trimmedUrl,
      device: preset ? preset.device : bootDevice,
      ramMb: memoryMb,
      vramMb,
      sizeHint: preset?.size,
      label: preset ? preset.name : trimmedUrl.split('/').pop() || 'Custom ISO',
      cmdline: preset?.cmdline,
      filesystemBaseUrl: preset?.filesystemBaseUrl,
      netDeviceType: preset?.netDeviceType,
      bootHint: preset?.bootHint,
    });
  }, [bootDevice, bootEmulator, customIsoUrl, memoryMb, selectedPresetId, showToast, vramMb]);

  const handleBootPresetNow = useCallback(
    (preset: OSPreset) => {
      localFileRef.current = null;
      setLocalFileName(null);
      setSelectedPresetId(preset.id);
      setCustomIsoUrl(preset.url);
      setBootDevice(preset.device);
      setMemoryMb(preset.recommendedRamMb);
      setVramMb(preset.recommendedVramMb ?? 8);
      void bootEmulator({
        kind: preset.kind,
        sourceUrl: preset.url,
        device: preset.device,
        ramMb: preset.recommendedRamMb,
        vramMb: preset.recommendedVramMb ?? 8,
        sizeHint: preset.size,
        label: preset.name,
        cmdline: preset.cmdline,
        filesystemBaseUrl: preset.filesystemBaseUrl,
        netDeviceType: preset.netDeviceType,
        bootHint: preset.bootHint,
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
    setVramMb(preset.recommendedVramMb ?? 8);
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
        kind: 'disk',
        localFile: file,
        device: inferredDevice,
        ramMb: memoryMb,
        vramMb,
        label: file.name,
        bootHint:
          inferredDevice === 'cdrom'
            ? 'Auto-network (ne2k_pci + DHCP) & IPAD_FILES drive (/dev/sda + 9p) attached.'
            : undefined,
      });
    },
    [bootEmulator, memoryMb, vramMb]
  );

  const handleImportHostFiles = useCallback(
    async (fileList: FileList | File[], folder: 'ipad' | 'www') => {
      const files = Array.from(fileList);
      if (files.length === 0) return;

      const emu = emulatorRef.current;
      const prefix = get9pPrefix();
      const imported: SharedHostFile[] = [];

      for (const file of files) {
        const safeName = sanitizeGuestFilename(file.name);
        const buf = await file.arrayBuffer();
        const data = new Uint8Array(buf);
        const targetPath = folder === 'www' ? `${prefix}/www/${safeName}` : `${prefix}/${safeName}`;
        const synced = emu ? await writeFileToVm9p(emu, targetPath, data) : false;

        imported.push({
          name: safeName,
          folder,
          size: data.byteLength,
          mimeType: file.type || guessMimeType(safeName),
          updatedAt: Date.now(),
          syncedTo9p: synced,
          data,
        });
      }

      setSharedFiles((prev) => {
        const map = new Map<string, SharedHostFile>();
        for (const f of prev) map.set(`${f.folder}:${f.name}`, f);
        for (const f of imported) map.set(`${f.folder}:${f.name}`, f);
        return Array.from(map.values());
      });

      const syncedCount = imported.filter((f) => f.syncedTo9p).length;
      showToast(
        syncedCount > 0
          ? `Imported ${imported.length} file(s) and synced live to 9p (${folder === 'www' ? '/mnt/ipad/www' : '/mnt/ipad'}).`
          : `Queued ${imported.length} iPad file(s) for /dev/sda (IPAD_FILES) & 9p share.`,
        'success'
      );
    },
    [get9pPrefix, showToast]
  );

  const handleSaveWebFile = useCallback(
    async (name: string, content: string) => {
      const safeName = sanitizeGuestFilename(name);
      const data = encodeUtf8(content);
      const emu = emulatorRef.current;
      const prefix = get9pPrefix();
      const synced = emu ? await writeFileToVm9p(emu, `${prefix}/www/${safeName}`, data) : false;

      const updated: SharedHostFile = {
        name: safeName,
        folder: 'www',
        size: data.byteLength,
        mimeType: guessMimeType(safeName),
        updatedAt: Date.now(),
        syncedTo9p: synced,
        data,
      };

      setSharedFiles((prev) => {
        const filtered = prev.filter((f) => !(f.folder === 'www' && f.name === safeName));
        return [...filtered, updated];
      });
      showToast(
        synced
          ? `Saved ${safeName} and synced live to /mnt/ipad/www.`
          : `Saved ${safeName} in web root.`,
        'success'
      );
    },
    [get9pPrefix, showToast]
  );

  const handleDeleteSharedFile = useCallback((name: string, folder: 'ipad' | 'www') => {
    setSharedFiles((prev) => prev.filter((f) => !(f.folder === folder && f.name === name)));
  }, []);

  const handlePullFromVm9p = useCallback(
    async (folder: 'ipad' | 'www'): Promise<number> => {
      const emu = emulatorRef.current;
      if (!emu) return 0;
      const prefix = get9pPrefix();
      const dirPath = folder === 'www' ? `${prefix}/www` : prefix || '/';
      const names = listVm9pDirectory(emu, dirPath);
      const skip = new Set(['www', 'net-auto.sh', 'mount-ipad.sh', 'websrv.sh']);
      let pulled = 0;
      const updates: SharedHostFile[] = [];

      for (const name of names) {
        if (folder === 'ipad' && skip.has(name)) continue;
        const fullPath = dirPath === '/' ? `/${name}` : `${dirPath}/${name}`;
        const bytes = await readFileFromVm9p(emu, fullPath);
        if (bytes) {
          pulled++;
          updates.push({
            name,
            folder,
            size: bytes.byteLength,
            mimeType: guessMimeType(name),
            updatedAt: Date.now(),
            syncedTo9p: true,
            data: bytes,
          });
        }
      }

      if (updates.length > 0) {
        setSharedFiles((prev) => {
          const map = new Map<string, SharedHostFile>();
          for (const f of prev) map.set(`${f.folder}:${f.name}`, f);
          for (const f of updates) map.set(`${f.folder}:${f.name}`, f);
          return Array.from(map.values());
        });
        showToast(`Synced ${pulled} live file(s) from VM 9p share.`, 'success');
      } else {
        showToast('No new files detected in live 9p share.', 'info');
      }
      return pulled;
    },
    [get9pPrefix, showToast]
  );

  const handleRunGuestCommand = useCallback(
    (command: string, label: string) => {
      const emu = emulatorRef.current;
      if (!emu || status !== 'running') {
        showToast('Start a Linux/Puppy VM first before sending guest commands.', 'error');
        return;
      }
      emu.keyboard_set_enabled?.(true);
      void emu.keyboard_send_text?.(command);
      showToast(`Sent "${label}" to focused guest terminal.`, 'success');
    },
    [showToast, status]
  );

  const handleRebootWithUpdatedDrive = useCallback(() => {
    const last = lastBootOptionsRef.current;
    if (!last) {
      showToast('No active VM boot configuration to reboot.', 'error');
      return;
    }
    setAttachTransferDrive(true);
    void bootEmulator({ ...last, forceAttachDrive: true });
    showToast('Rebuilt IPAD_FILES (/dev/sda1) FAT16 drive and rebooting VM.', 'info');
  }, [bootEmulator, showToast]);

  const handleBootPuppyDirect = useCallback(
    (params: PuppyDirectBootParams) => {
      const safeRamMb = Math.min(2048, Math.max(256, params.memoryMb));
      localFileRef.current = params.isoFile;
      setLocalFileName(params.isoFile.name);
      setBootDevice('cdrom');
      setMemoryMb(safeRamMb);
      setVramMb(params.vramMb);
      setNetDeviceType(params.netDeviceType);
      setNetworkRelayUrl(params.networkRelayUrl);
      void bootEmulator({
        kind: 'puppy-direct',
        localFile: params.isoFile,
        vmlinuzFile: params.vmlinuzFile,
        initrdFile: params.initrdFile,
        vmlinuzBuffer: params.vmlinuzBuffer,
        initrdBuffer: params.initrdBuffer,
        device: 'cdrom',
        ramMb: safeRamMb,
        vramMb: params.vramMb,
        label: `Puppy Linux (${params.isoFile.name})`,
        cmdline: params.cmdline,
        netDeviceType: params.netDeviceType,
        networkRelayUrl: params.networkRelayUrl,
        bootHint:
          'Puppy direct boot active (pfix=ram,nocopy + 2 MB ISO read-ahead cache). Tip: use State → Save Snapshot once at desktop for 2-second future boots.',
      });
    },
    [bootEmulator]
  );

  const handlePowerOff = useCallback(async () => {
    await destroyCurrentEmulator();
    setStatus('stopped');
    setDownloadProgress(null);
    setErrorMessage(null);
    setIps(0);
    setDragMode(false);
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
            kind: preset ? preset.kind : 'disk',
            localFile: localFileRef.current,
            sourceUrl: localFileRef.current ? undefined : customIsoUrl.trim() || preset?.url,
            device: preset ? preset.device : bootDevice,
            ramMb: record.memoryMb,
            vramMb,
            sizeHint: preset?.size,
            label: record.presetName,
            cmdline: preset?.cmdline,
            filesystemBaseUrl: preset?.filesystemBaseUrl,
            netDeviceType: preset?.netDeviceType,
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
      vramMb,
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
            kind: preset ? preset.kind : 'disk',
            localFile: localFileRef.current,
            sourceUrl: localFileRef.current ? undefined : customIsoUrl.trim() || preset?.url,
            device: preset ? preset.device : bootDevice,
            ramMb: memoryMb,
            vramMb,
            sizeHint: preset?.size,
            label: preset?.name || file.name,
            cmdline: preset?.cmdline,
            filesystemBaseUrl: preset?.filesystemBaseUrl,
            netDeviceType: preset?.netDeviceType,
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
      vramMb,
    ]
  );

  const handleTogglePointerLock = useCallback(() => {
    const target = screenRef.current;
    if (!target) return;

    if (document.pointerLockElement) {
      document.exitPointerLock?.();
      return;
    }

    if (typeof target.requestPointerLock !== 'function') {
      showToast(
        'Pointer lock is unavailable on iPadOS. Use Drag + Click mode or double-tap-and-drag directly on screen.',
        'info'
      );
      return;
    }

    try {
      const result = target.requestPointerLock() as unknown as Promise<void> | undefined;
      if (result && typeof result.catch === 'function') {
        result.catch(() => {
          showToast('Click inside the desktop canvas or use Drag + Click directly.', 'info');
        });
      }
    } catch {
      showToast('Pointer lock unavailable; unlocked drag + left click is already active.', 'info');
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

  // --- UNIFIED PRECISION POINTER DRIVER (Desktop Mouse / iPad Magic Keyboard Trackpad / Apple Pencil) ---
  const handleViewportPointerDown = (e: React.PointerEvent<HTMLElement>) => {
    if ((e.target as HTMLElement | null)?.closest('[data-touch-mouse-bar="true"]')) return;
    if (openMenu) setOpenMenu(null);
    if (status !== 'running' || !emulatorRef.current) return;
    if (e.pointerType === 'touch' || document.pointerLockElement) return;

    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore capture errors on synthetic pointers
    }

    pointerPosRef.current = { x: e.clientX, y: e.clientY, initialized: true };
    emitMouseAbsolute(e.clientX, e.clientY);

    const next = { ...mouseButtonsRef.current };
    if (e.button === 0) next.left = true;
    else if (e.button === 1) next.middle = true;
    else if (e.button === 2) next.right = true;
    emitMouseButtons(next.left, next.middle, next.right);
    window.focus();
  };

  const handleViewportPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    if ((e.target as HTMLElement | null)?.closest('[data-touch-mouse-bar="true"]')) return;
    if (status !== 'running' || !emulatorRef.current) return;
    if (e.pointerType === 'touch' || document.pointerLockElement) return;

    // WebKit / iPadOS Chrome often reports movementX === 0 when unlocked; fall back to client delta
    const prev = pointerPosRef.current;
    let dx = e.movementX;
    let dy = e.movementY;
    if (dx === 0 && dy === 0 && prev.initialized) {
      dx = e.clientX - prev.x;
      dy = e.clientY - prev.y;
    }
    pointerPosRef.current = { x: e.clientX, y: e.clientY, initialized: true };

    // Send mouse-absolute BEFORE mouse-delta so VMMouse.queue is populated before PS/2 IRQ 12 fires
    emitMouseAbsolute(e.clientX, e.clientY);
    emitMouseDelta(dx, dy);
    if (vmwareAbsoluteMouseRef.current && Math.abs(dx) < 1 && Math.abs(dy) < 1) {
      pokeVmmouseIrq();
    }
  };

  const handleViewportPointerUp = (e: React.PointerEvent<HTMLElement>) => {
    if ((e.target as HTMLElement | null)?.closest('[data-touch-mouse-bar="true"]')) return;
    if (status !== 'running' || !emulatorRef.current) return;
    if (e.pointerType === 'touch' || document.pointerLockElement) return;

    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // Ignore release errors
    }

    const next = { ...mouseButtonsRef.current };
    if (e.button === 0) next.left = thumbLeftHeldRef.current;
    else if (e.button === 1) next.middle = false;
    else if (e.button === 2) next.right = false;
    emitMouseButtons(next.left, next.middle, next.right);
  };

  const handleViewportPointerLeave = (e: React.PointerEvent<HTMLElement>) => {
    if (e.pointerType === 'touch') return;
    pointerPosRef.current.initialized = false;
  };

  const handleViewportWheel = (e: React.WheelEvent<HTMLElement>) => {
    if (status !== 'running' || !emulatorRef.current || document.pointerLockElement) return;
    e.preventDefault();
    emitMouseWheel(e.deltaY < 0 ? 1 : -1);
  };

  const handleViewportContextMenu = (e: React.MouseEvent<HTMLElement>) => {
    if (status === 'running') {
      e.preventDefault();
    }
  };

  const getViewportTouches = (touches: React.TouchList): React.Touch[] => {
    const list: React.Touch[] = [];
    for (let i = 0; i < touches.length; i++) {
      const t = touches[i];
      const target = t.target as HTMLElement | null;
      if (!target?.closest('[data-touch-mouse-bar="true"]')) {
        list.push(t);
      }
    }
    return list;
  };

  // --- UNIFIED PRECISION TOUCH DRIVER (iPadOS Touchscreen: VMMouse 1:1 Absolute + PS/2 Relative, Tap, Double-Tap+Drag, Drag+L-Click Mode, 550ms Long-Press & 2-Finger R-Click, 2-Finger Scroll) ---
  const clearLongPressTimer = () => {
    if (touchStateRef.current.longPressTimer !== null) {
      window.clearTimeout(touchStateRef.current.longPressTimer);
      touchStateRef.current.longPressTimer = null;
    }
  };

  const handleTouchStart = (e: React.TouchEvent<HTMLElement>) => {
    if (status !== 'running' || !emulatorRef.current) return;
    const vTouches = getViewportTouches(e.touches);
    const touch = vTouches[0];
    if (!touch) return;

    clearLongPressTimer();

    const now = performance.now();
    const prev = touchStateRef.current;
    const isDoubleTapHold =
      vTouches.length === 1 &&
      !thumbLeftHeldRef.current &&
      now - prev.lastTapTime < 340 &&
      Math.hypot(touch.clientX - prev.lastTapX, touch.clientY - prev.lastTapY) < 42;

    const engageLeftDrag = vTouches.length === 1 && (dragMode || isDoubleTapHold);

    touchStateRef.current = {
      ...prev,
      active: true,
      startX: touch.clientX,
      startY: touch.clientY,
      lastX: touch.clientX,
      lastY: touch.clientY,
      moved: false,
      startTime: now,
      maxTouches: Math.max(prev.active ? prev.maxTouches : 0, vTouches.length),
      holdingLeftForDrag: engageLeftDrag,
      longPressTimer: null,
      longPressFired: false,
      scrollAccumY: 0,
    };

    // Always position VMMouse absolute pointer (NoblePup32 / BookwormPup32 / modern Linux) at touch point first
    emitMouseAbsolute(touch.clientX, touch.clientY);

    if (engageLeftDrag) {
      emitMouseButtons(true, false, false);
      setLeftButtonHeldUi(true);
    } else {
      // Wake VMMouse IRQ 12 immediately so the cursor jumps to finger position on first contact
      pokeVmmouseIrq();
      if (vTouches.length === 1 && !thumbLeftHeldRef.current) {
        touchStateRef.current.longPressTimer = window.setTimeout(() => {
          const ts = touchStateRef.current;
          if (ts.active && !ts.moved && ts.maxTouches === 1 && !ts.holdingLeftForDrag) {
            ts.longPressFired = true;
            ts.longPressTimer = null;
            emitMouseAbsolute(ts.startX, ts.startY);
            emitMouseButtons(false, false, true);
            window.setTimeout(
              () => emitMouseButtons(thumbLeftHeldRef.current, false, false),
              50
            );
          }
        }, 550);
      }
    }
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLElement>) => {
    const ts = touchStateRef.current;
    if (status !== 'running' || !emulatorRef.current || !ts.active) return;

    const vTouches = getViewportTouches(e.touches);
    const touch = vTouches[0];
    if (!touch) return;

    const dx = touch.clientX - ts.lastX;
    const dy = touch.clientY - ts.lastY;
    const totalDist = Math.hypot(touch.clientX - ts.startX, touch.clientY - ts.startY);

    if (totalDist > 6 || vTouches.length >= 2) {
      if (totalDist > 6) ts.moved = true;
      clearLongPressTimer();
    }

    ts.lastX = touch.clientX;
    ts.lastY = touch.clientY;
    ts.maxTouches = Math.max(ts.maxTouches, vTouches.length);

    if (vTouches.length >= 2) {
      // Two-finger vertical scroll
      ts.scrollAccumY += dy;
      const step = 22;
      while (Math.abs(ts.scrollAccumY) >= step) {
        const dir = ts.scrollAccumY > 0 ? 1 : -1;
        emitMouseWheel(dir);
        ts.scrollAccumY -= dir * step;
      }
      return;
    }

    if (dx !== 0 || dy !== 0) {
      const speed = ts.holdingLeftForDrag || thumbLeftHeldRef.current ? 1.15 : 1.4;
      // Queue VMMouse absolute coordinates BEFORE triggering PS/2 IRQ 12 via mouse-delta
      emitMouseAbsolute(touch.clientX, touch.clientY);
      emitMouseDelta(dx * speed, dy * speed);
      if (vmwareAbsoluteMouseRef.current && Math.abs(dx * speed) < 1 && Math.abs(dy * speed) < 1) {
        pokeVmmouseIrq();
      }
    }
  };

  const handleTouchEnd = (e: React.TouchEvent<HTMLElement>) => {
    const ts = touchStateRef.current;
    if (!ts.active) return;

    const remainingViewportTouches = getViewportTouches(e.touches);
    if (remainingViewportTouches.length === 0) {
      clearLongPressTimer();
      const now = performance.now();
      const elapsed = now - ts.startTime;

      if (ts.holdingLeftForDrag) {
        ts.holdingLeftForDrag = false;
        emitMouseButtons(thumbLeftHeldRef.current, false, false);
        setLeftButtonHeldUi(thumbLeftHeldRef.current);
      } else if (status === 'running' && !ts.longPressFired && !ts.moved && elapsed < 300) {
        emitMouseAbsolute(ts.startX, ts.startY);
        if (ts.maxTouches >= 2) {
          // Two-finger tap -> Right Click
          emitMouseButtons(false, false, true);
          window.setTimeout(
            () => emitMouseButtons(thumbLeftHeldRef.current, false, false),
            45
          );
        } else {
          // Single tap -> Left Click + remember tap timestamp for double-tap-and-drag
          ts.lastTapTime = now;
          ts.lastTapX = ts.startX;
          ts.lastTapY = ts.startY;
          emitMouseButtons(true, false, false);
          window.setTimeout(
            () => emitMouseButtons(thumbLeftHeldRef.current, false, false),
            45
          );
        }
      }

      ts.active = false;
      ts.maxTouches = 0;
      ts.longPressFired = false;
    }
  };

  const handleTouchCancel = () => {
    clearLongPressTimer();
    const ts = touchStateRef.current;
    if (ts.holdingLeftForDrag) {
      ts.holdingLeftForDrag = false;
      emitMouseButtons(thumbLeftHeldRef.current, false, false);
      setLeftButtonHeldUi(thumbLeftHeldRef.current);
    }
    ts.active = false;
    ts.maxTouches = 0;
    ts.longPressFired = false;
  };

  // TouchMouseBar thumb hold handlers
  const handleThumbLeftDown = useCallback(() => {
    thumbLeftHeldRef.current = true;
    setLeftButtonHeldUi(true);
    emitMouseButtons(true, false, false);
  }, [emitMouseButtons]);

  const handleThumbLeftUp = useCallback(() => {
    thumbLeftHeldRef.current = false;
    setLeftButtonHeldUi(false);
    emitMouseButtons(false, false, false);
  }, [emitMouseButtons]);

  const handleTouchRightClick = useCallback(() => {
    emitMouseButtons(false, false, true);
    window.setTimeout(() => emitMouseButtons(thumbLeftHeldRef.current, false, false), 45);
  }, [emitMouseButtons]);

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
    const files = e.dataTransfer.files;
    if (!files || files.length === 0) return;
    const first = files[0];
    if (files.length === 1 && /\.(iso|img|bin)$/i.test(first.name)) {
      handleUploadIso(first);
    } else {
      void handleImportHostFiles(files, 'ipad');
      setGuestToolsState({ open: true, tab: 'files' });
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
        vramMb={vramMb}
        networkEnabled={networkEnabled}
        selectedPresetId={selectedPresetId}
        customIsoUrl={customIsoUrl}
        localFileName={localFileName}
        bootDevice={bootDevice}
        crispScaling={crispScaling}
        dragMode={dragMode}
        showTouchBar={showTouchBar}
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
        onVramChange={setVramMb}
        onToggleNetwork={() => setNetworkEnabled((prev) => !prev)}
        onToggleCrispScaling={() => setCrispScaling((prev) => !prev)}
        onToggleDragMode={() => {
          setDragMode((prev) => {
            const next = !prev;
            showToast(
              next
                ? 'Drag + Left Click enabled: touch and drag anywhere to move windows or select text.'
                : 'Normal cursor mode: tap to click, double-tap & hold to drag.',
              'info'
            );
            return next;
          });
        }}
        onToggleTouchBar={() => setShowTouchBar((prev) => !prev)}
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
        onOpenPuppySetup={() => {
          setOpenMenu(null);
          setShowPuppyModal(true);
        }}
        onOpenGuestTools={(tab = 'network') => {
          setOpenMenu(null);
          setGuestToolsState({ open: true, tab });
        }}
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
        className="flex-1 relative bg-black flex items-center justify-center overflow-hidden min-h-0 touch-none"
        onPointerDown={handleViewportPointerDown}
        onPointerMove={handleViewportPointerMove}
        onPointerUp={handleViewportPointerUp}
        onPointerCancel={handleViewportPointerUp}
        onPointerLeave={handleViewportPointerLeave}
        onWheel={handleViewportWheel}
        onContextMenu={handleViewportContextMenu}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchCancel}
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

        {/* Floating iPad / Touch Mouse + Drag Controls Bar */}
        {status === 'running' && (
          <TouchMouseBar
            visible={showTouchBar}
            dragMode={dragMode}
            leftButtonHeld={leftButtonHeldUi}
            onToggleDragMode={() => setDragMode((prev) => !prev)}
            onLeftButtonDown={handleThumbLeftDown}
            onLeftButtonUp={handleThumbLeftUp}
            onRightClick={handleTouchRightClick}
            onScroll={emitMouseWheel}
            onSendScancodes={handleSendScancodes}
            onClose={() => setShowTouchBar(false)}
          />
        )}

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
                  Run full rolling Arch Linux, modern 2024 SliTaz Openbox X11, Linux 6.8, or local Puppy Linux ISOs inside WebAssembly—tuned for Apple Silicon M3 Chrome with touch drag-and-click, double-tap drag, and up to 2 GB RAM.
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
                      <span className="text-[11px] font-mono text-sky-400 opacity-90 group-hover:opacity-100 shrink-0">
                        {preset.badgeText ? `${preset.badgeText} →` : 'Boot →'}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mt-1">{preset.subtitle}</p>
                    <div className="text-[11px] font-mono tabular-nums text-slate-500 mt-2.5">
                      {preset.recommendedRamMb} MB RAM ·{' '}
                      {preset.kind === 'state-9p'
                        ? '9p + Instant State'
                        : preset.kind === 'bzimage'
                          ? 'Direct Kernel'
                          : preset.device.toUpperCase()}{' '}
                      · {preset.graphical ? 'X11 / GUI' : 'Console'}
                    </div>
                  </button>
                ))}
              </div>

              {/* Local Offline ISO Drop Zone */}
              <div className="p-4 rounded-md bg-slate-900/50 border border-dashed border-slate-700 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div>
                  <h2 className="text-xs font-semibold text-slate-200">
                    Boot Local Puppy Linux, Alpine, or Custom x86 ISO Offline
                  </h2>
                  <p className="text-xs text-slate-400 mt-1">
                    Drop any <span className="font-mono text-slate-300">.iso</span> or{' '}
                    <span className="font-mono text-slate-300">.img</span> file here, or use Direct Kernel Boot for BookwormPup32 / NoblePup32 with up to 2 GB RAM.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    disabled={!v86Ready}
                    onClick={() => setShowPuppyModal(true)}
                    className="h-9 px-3.5 rounded-md bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium flex items-center gap-1.5 whitespace-nowrap shrink-0 disabled:opacity-40"
                  >
                    <span>Puppy iPadOS Setup</span>
                  </button>
                  <button
                    type="button"
                    disabled={!v86Ready}
                    onClick={() => fileDropInputRef.current?.click()}
                    className="h-9 px-3.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-100 text-xs font-medium border border-slate-700 flex items-center gap-2 whitespace-nowrap shrink-0 disabled:opacity-40"
                  >
                    <HardDriveUpload className="w-3.5 h-3.5 text-sky-400" />
                    <span>Choose Local ISO</span>
                  </button>
                </div>
              </div>

              {/* Quiet hardware & touch gesture specs footer line */}
              <div className="text-[11px] font-mono tabular-nums text-slate-500 flex flex-wrap items-center gap-x-2 gap-y-1">
                <span>Tap: L-Click</span>
                <span aria-hidden="true">·</span>
                <span>Double-Tap &amp; Drag: L-Click + Drag</span>
                <span aria-hidden="true">·</span>
                <span>Long-Press / 2-Finger Tap: R-Click</span>
                <span aria-hidden="true">·</span>
                <span>2-Finger Drag: Scroll</span>
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
                  onClick={() => handleBootPresetNow(OS_PRESETS[0])}
                  className="h-9 px-3.5 rounded-md bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium"
                >
                  Boot Arch Linux
                </button>
                <button
                  type="button"
                  onClick={() => handleBootPresetNow(OS_PRESETS[1])}
                  className="h-9 px-3.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700"
                >
                  Boot SliTaz 2024 GUI
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
                  Launcher
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
            className={`absolute top-4 right-4 z-40 max-w-sm px-3.5 py-2.5 rounded-md border text-xs flex items-center gap-3 shadow-lg ${
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

      {/* Puppy Linux iPadOS WebKit Direct-Kernel Boot & Standalone Config Modal */}
      <PuppySetupModal
        open={showPuppyModal}
        v86Ready={v86Ready}
        onClose={() => setShowPuppyModal(false)}
        onBootPuppyDirect={handleBootPuppyDirect}
        onInputFocusChange={handleInputFocusChange}
      />

      {/* Auto-Network, iPad File Bridge (9p + FAT16) & In-VM Web Server Modal */}
      <GuestToolsModal
        open={guestToolsState.open}
        initialTab={guestToolsState.tab}
        status={status}
        networkEnabled={networkEnabled}
        netDeviceType={netDeviceType}
        networkRelayUrl={networkRelayUrl}
        attachTransferDrive={attachTransferDrive}
        sharedFiles={sharedFiles}
        webServerEngine={webServerEngine}
        webServerPort={webServerPort}
        onClose={() => setGuestToolsState((prev) => ({ ...prev, open: false }))}
        onToggleNetwork={() => setNetworkEnabled((prev) => !prev)}
        onNetDeviceTypeChange={setNetDeviceType}
        onNetworkRelayUrlChange={setNetworkRelayUrl}
        onToggleTransferDrive={() => setAttachTransferDrive((prev) => !prev)}
        onWebServerEngineChange={setWebServerEngine}
        onWebServerPortChange={setWebServerPort}
        onImportHostFiles={handleImportHostFiles}
        onSaveWebFile={handleSaveWebFile}
        onDeleteSharedFile={handleDeleteSharedFile}
        onPullFromVm9p={handlePullFromVm9p}
        onRunGuestCommand={handleRunGuestCommand}
        onRebootWithUpdatedDrive={handleRebootWithUpdatedDrive}
        onInputFocusChange={handleInputFocusChange}
      />
    </div>
  );
}
