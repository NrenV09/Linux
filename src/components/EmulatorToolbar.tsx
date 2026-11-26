import React, { useRef } from 'react';
import {
  Power,
  RotateCcw,
  Pause,
  Play,
  Square,
  HardDriveUpload,
  Save,
  FolderOpen,
  MousePointer2,
  Maximize,
  Minimize,
  Keyboard,
  SlidersHorizontal,
  Download,
  Trash2,
  Database,
  Move,
  Hand,
  Cpu,
  Globe,
} from 'lucide-react';
import type {
  BootDevice,
  EmulatorStatus,
  OSPreset,
  SavedSnapshotMeta,
} from '../types/v86';
import { OS_PRESETS, RAM_OPTIONS_MB, VRAM_OPTIONS_MB, formatBytes } from '../lib/presets';

interface EmulatorToolbarProps {
  status: EmulatorStatus;
  v86Ready: boolean;
  v86Error: string | null;
  ips: number;
  memoryMb: number;
  vramMb: number;
  networkEnabled: boolean;
  turboMode: boolean;
  soundEnabled: boolean;
  selectedPresetId: string;
  customIsoUrl: string;
  localFileName: string | null;
  bootDevice: BootDevice;
  crispScaling: boolean;
  dragMode: boolean;
  showTouchBar: boolean;
  isFullscreen: boolean;
  isPointerLocked: boolean;
  showKeyboard: boolean;
  openMenu: 'config' | 'state' | null;
  snapshots: SavedSnapshotMeta[];
  isSavingState: boolean;
  onToggleMenu: (menu: 'config' | 'state') => void;
  onSelectPreset: (preset: OSPreset) => void;
  onCustomUrlChange: (url: string) => void;
  onBootDeviceChange: (device: BootDevice) => void;
  onMemoryChange: (mb: number) => void;
  onVramChange: (mb: number) => void;
  onToggleNetwork: () => void;
  onToggleTurboMode: () => void;
  onToggleSound: () => void;
  onToggleCrispScaling: () => void;
  onToggleDragMode: () => void;
  onToggleTouchBar: () => void;
  onPowerOn: () => void;
  onPowerOff: () => void;
  onTogglePause: () => void;
  onReset: () => void;
  onUploadIso: (file: File) => void;
  onSaveSnapshotDb: () => void;
  onRestoreSnapshotDb: (id: string) => void;
  onDeleteSnapshotDb: (id: string) => void;
  onDownloadStateFile: () => void;
  onUploadStateFile: (file: File) => void;
  onTogglePointerLock: () => void;
  onToggleFullscreen: () => void;
  onToggleKeyboard: () => void;
  onOpenPuppySetup: () => void;
  onOpenGuestTools: (tab?: 'network' | 'files' | 'web') => void;
  onInputFocusChange: (focused: boolean) => void;
}

const STATUS_LABELS: Record<EmulatorStatus, { label: string; colorClass: string }> = {
  stopped: { label: 'Stopped', colorClass: 'text-slate-400' },
  loading: { label: 'Booting', colorClass: 'text-amber-400' },
  running: { label: 'Running', colorClass: 'text-emerald-400' },
  paused: { label: 'Paused', colorClass: 'text-amber-400' },
  error: { label: 'Error', colorClass: 'text-red-400' },
};

export const EmulatorToolbar: React.FC<EmulatorToolbarProps> = ({
  status,
  v86Ready,
  v86Error,
  ips,
  memoryMb,
  vramMb,
  networkEnabled,
  turboMode,
  soundEnabled,
  selectedPresetId,
  customIsoUrl,
  localFileName,
  bootDevice,
  crispScaling,
  dragMode,
  showTouchBar,
  isFullscreen,
  isPointerLocked,
  showKeyboard,
  openMenu,
  snapshots,
  isSavingState,
  onToggleMenu,
  onSelectPreset,
  onCustomUrlChange,
  onBootDeviceChange,
  onMemoryChange,
  onVramChange,
  onToggleNetwork,
  onToggleTurboMode,
  onToggleSound,
  onToggleCrispScaling,
  onToggleDragMode,
  onToggleTouchBar,
  onPowerOn,
  onPowerOff,
  onTogglePause,
  onReset,
  onUploadIso,
  onSaveSnapshotDb,
  onRestoreSnapshotDb,
  onDeleteSnapshotDb,
  onDownloadStateFile,
  onUploadStateFile,
  onTogglePointerLock,
  onToggleFullscreen,
  onToggleKeyboard,
  onOpenPuppySetup,
  onOpenGuestTools,
  onInputFocusChange,
}) => {
  const isoInputRef = useRef<HTMLInputElement>(null);
  const stateInputRef = useRef<HTMLInputElement>(null);

  const isActive = status === 'running' || status === 'paused' || status === 'loading';
  const statusInfo = STATUS_LABELS[status];

  const handleIsoFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onUploadIso(file);
    if (isoInputRef.current) isoInputRef.current.value = '';
  };

  const handleStateFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onUploadStateFile(file);
    if (stateInputRef.current) stateInputRef.current.value = '';
  };

  const btnBase =
    'h-9 px-3 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 disabled:opacity-40 disabled:cursor-not-allowed';

  return (
    <header className="relative z-30 bg-slate-900 border-b border-slate-800 shrink-0">
      <div className="flex items-center justify-between gap-3 px-3 py-2 overflow-x-auto">
        {/* Left: Primary VM Power & Image Controls */}
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-sm font-semibold tracking-tight text-slate-100 mr-2 whitespace-nowrap hidden xl:inline">
            Web Desktop Emulator
          </span>

          {!isActive ? (
            <button
              type="button"
              onClick={onPowerOn}
              disabled={!v86Ready || !!v86Error}
              className={`${btnBase} bg-sky-600 hover:bg-sky-500 text-white`}
            >
              <Power className="w-3.5 h-3.5" />
              <span>Power On</span>
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={onTogglePause}
                disabled={status === 'loading'}
                title={status === 'paused' ? 'Resume execution' : 'Pause execution'}
                className={`${btnBase} bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700`}
              >
                {status === 'paused' ? (
                  <>
                    <Play className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Resume</span>
                  </>
                ) : (
                  <>
                    <Pause className="w-3.5 h-3.5 text-amber-400" />
                    <span>Pause</span>
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={onReset}
                disabled={status === 'loading'}
                title="Reboot virtual machine"
                className={`${btnBase} bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700`}
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Reset</span>
              </button>
              <button
                type="button"
                onClick={onPowerOff}
                title="Power off virtual machine"
                className={`${btnBase} bg-slate-800 hover:bg-red-900/60 text-slate-200 hover:text-red-100 border border-slate-700 hover:border-red-800`}
              >
                <Square className="w-3 h-3" />
                <span className="hidden sm:inline">Power Off</span>
              </button>
            </>
          )}

          <div className="w-px h-5 bg-slate-800 mx-1 shrink-0" />

          {/* Local ISO quick loader */}
          <input
            ref={isoInputRef}
            type="file"
            accept=".iso,.img,.bin"
            onChange={handleIsoFile}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => isoInputRef.current?.click()}
            disabled={!v86Ready}
            title="Boot a local Puppy Linux, Debian, Alpine, or Tiny Core ISO/IMG offline"
            className={`${btnBase} bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700`}
          >
            <HardDriveUpload className="w-3.5 h-3.5 text-sky-400" />
            <span>Load ISO</span>
          </button>

          {/* Puppy Linux iPadOS Direct-Kernel Setup & Standalone Export */}
          <button
            type="button"
            onClick={onOpenPuppySetup}
            title="Puppy Linux iPadOS WebKit setup (direct vmlinuz + initrd + async ISO, up to 2 GB RAM & QEMU-Wasm config)"
            className={`${btnBase} bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700`}
          >
            <Cpu className="w-3.5 h-3.5 text-emerald-400" />
            <span>Puppy iPadOS</span>
          </button>

          {/* Auto-Network, iPad Files & Web Server Studio */}
          <button
            type="button"
            onClick={() => onOpenGuestTools('network')}
            title="Auto-network setup, import local iPad files into Puppy Linux, and run an in-VM web server"
            className={`${btnBase} bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700`}
          >
            <Globe className="w-3.5 h-3.5 text-sky-400" />
            <span>Net · Files · Web</span>
          </button>

          {/* Hardware / Image Configuration Drawer Toggle */}
          <button
            type="button"
            onClick={() => onToggleMenu('config')}
            aria-expanded={openMenu === 'config'}
            className={`${btnBase} border ${
              openMenu === 'config'
                ? 'bg-slate-700 text-white border-slate-500'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
            }`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span>Linux & Hardware</span>
          </button>

          {/* State Persistence Drawer Toggle */}
          <button
            type="button"
            onClick={() => onToggleMenu('state')}
            aria-expanded={openMenu === 'state'}
            disabled={!v86Ready}
            className={`${btnBase} border ${
              openMenu === 'state'
                ? 'bg-slate-700 text-white border-slate-500'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
            }`}
          >
            <Save className="w-3.5 h-3.5" />
            <span>State</span>
            {snapshots.length > 0 && (
              <span className="font-mono tabular-nums text-[11px] text-slate-400">
                ({snapshots.length})
              </span>
            )}
          </button>
        </div>

        {/* Right: Live Telemetry (Clean unboxed tabular metadata) & Mouse/Viewport Controls */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="hidden lg:flex items-center gap-2 text-xs font-mono tabular-nums text-slate-400 whitespace-nowrap">
            <span className={`font-sans font-medium ${statusInfo.colorClass}`}>
              {statusInfo.label}
            </span>
            <span aria-hidden="true" className="text-slate-600">
              ·
            </span>
            <span>{memoryMb} MB</span>
            <span aria-hidden="true" className="text-slate-600">
              ·
            </span>
            <span className="w-20 text-right text-slate-200">
              {(ips / 1_000_000).toFixed(2)} MIPS
            </span>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {/* Drag + Left Click Mode Toggle */}
            <button
              type="button"
              onClick={onToggleDragMode}
              disabled={status !== 'running'}
              title={
                dragMode
                  ? 'Drag + Left Click Active (touch drag holds left mouse button)'
                  : 'Enable Drag + Left Click Mode (for moving windows & selecting text)'
              }
              aria-pressed={dragMode}
              className={`${btnBase} border ${
                dragMode
                  ? 'bg-amber-600 text-white border-amber-400'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
              }`}
            >
              <Move className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Drag + Click</span>
            </button>

            {/* Touch Mouse Controls Bar Toggle */}
            <button
              type="button"
              onClick={onToggleTouchBar}
              disabled={status !== 'running'}
              title="Toggle iPad Touch Mouse Bar (Hold L-Click, Drag, R-Click, Scroll)"
              aria-pressed={showTouchBar}
              className={`h-9 w-9 rounded-md flex items-center justify-center transition-colors border disabled:opacity-40 disabled:cursor-not-allowed ${
                showTouchBar
                  ? 'bg-sky-600 text-white border-sky-500'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
              }`}
            >
              <Hand className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={onToggleKeyboard}
              title="Toggle Virtual Keyboard"
              aria-pressed={showKeyboard}
              className={`h-9 w-9 rounded-md flex items-center justify-center transition-colors border ${
                showKeyboard
                  ? 'bg-sky-600 text-white border-sky-500'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
              }`}
            >
              <Keyboard className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={onTogglePointerLock}
              disabled={status !== 'running'}
              title={isPointerLocked ? 'Unlock Pointer (Esc)' : 'Lock Pointer (Desktop)'}
              aria-pressed={isPointerLocked}
              className={`h-9 w-9 rounded-md flex items-center justify-center transition-colors border disabled:opacity-40 disabled:cursor-not-allowed ${
                isPointerLocked
                  ? 'bg-sky-600 text-white border-sky-500'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
              }`}
            >
              <MousePointer2 className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={onToggleFullscreen}
              title={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
              className="h-9 w-9 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 flex items-center justify-center transition-colors"
            >
              {isFullscreen ? (
                <Minimize className="w-4 h-4" />
              ) : (
                <Maximize className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Slide-down Image & Hardware Configuration Panel */}
      {openMenu === 'config' && (
        <div className="border-t border-slate-800 bg-slate-900/98 px-4 py-4 max-h-[75dvh] overflow-y-auto">
          <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Column 1: Built-in CORS-verified OS Images */}
            <div className="md:col-span-2">
              <h3 className="text-xs font-semibold text-slate-300 mb-2">
                Linux Distributions (Optimized for Apple M3 / WebAssembly)
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {OS_PRESETS.map((preset) => {
                  const selected = selectedPresetId === preset.id && !localFileName;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => onSelectPreset(preset)}
                      className={`text-left px-3 py-2.5 rounded-md border transition-colors ${
                        selected
                          ? 'bg-sky-950/60 border-sky-500 text-slate-100'
                          : 'bg-slate-950/60 border-slate-800 hover:border-slate-700 text-slate-300'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-slate-100">{preset.name}</span>
                        {preset.badgeText && (
                          <span className="text-[10px] font-mono text-sky-400 shrink-0">
                            {preset.badgeText}
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5">{preset.subtitle}</div>
                    </button>
                  );
                })}
              </div>

              {/* Custom Direct ISO URL */}
              <div className="mt-3">
                <label
                  htmlFor="custom-iso-url"
                  className="block text-xs font-medium text-slate-400 mb-1"
                >
                  Custom Remote ISO / Disk URL (must allow CORS)
                </label>
                <div className="flex gap-2">
                  <input
                    id="custom-iso-url"
                    type="url"
                    value={customIsoUrl}
                    onChange={(e) => onCustomUrlChange(e.target.value)}
                    onFocus={() => onInputFocusChange(true)}
                    onBlur={() => onInputFocusChange(false)}
                    placeholder="https://example.com/puppy-linux.iso"
                    className="flex-1 h-9 px-3 rounded-md bg-slate-950 border border-slate-700 text-xs font-mono text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-sky-500"
                  />
                  <button
                    type="button"
                    onClick={onPowerOn}
                    disabled={!v86Ready}
                    className="h-9 px-3.5 rounded-md bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium whitespace-nowrap shrink-0 transition-colors disabled:opacity-40"
                  >
                    Boot Image
                  </button>
                </div>
                {localFileName && (
                  <p className="text-[11px] text-sky-400 mt-1.5">
                    Local image queued: <span className="font-mono">{localFileName}</span>
                  </p>
                )}
              </div>
            </div>

            {/* Column 2: Memory, VRAM, Boot Bus, Network & Display Scaling */}
            <div className="space-y-4">
              <div>
                <div className="text-xs font-semibold text-slate-300 mb-2">
                  System Memory (RAM)
                </div>
                <div className="flex items-center gap-1 p-1 bg-slate-950 rounded-md border border-slate-800">
                  {RAM_OPTIONS_MB.map((mb) => (
                    <button
                      key={mb}
                      type="button"
                      onClick={() => onMemoryChange(mb)}
                      className={`flex-1 h-7 rounded text-xs font-mono tabular-nums transition-colors ${
                        memoryMb === mb
                          ? 'bg-sky-600 text-white font-medium'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {mb >= 1024 ? `${mb / 1024} GB` : `${mb}`}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-slate-500 mt-1">
                  Up to 2 GB RAM for 8 GB M3 iPad Air (Arch snapshot uses fixed 512 MB).
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-xs font-semibold text-slate-300 mb-1.5">VGA RAM</div>
                  <div className="flex items-center gap-1 p-1 bg-slate-950 rounded-md border border-slate-800">
                    {VRAM_OPTIONS_MB.map((mb) => (
                      <button
                        key={mb}
                        type="button"
                        onClick={() => onVramChange(mb)}
                        className={`flex-1 h-7 rounded text-xs font-mono tabular-nums transition-colors ${
                          vramMb === mb
                            ? 'bg-slate-700 text-white font-medium'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {mb} MB
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="text-xs font-semibold text-slate-300 mb-1.5">Boot Bus</div>
                  <div className="flex items-center gap-1 p-1 bg-slate-950 rounded-md border border-slate-800">
                    {(['cdrom', 'hda', 'fda'] as BootDevice[]).map((dev) => (
                      <button
                        key={dev}
                        type="button"
                        onClick={() => onBootDeviceChange(dev)}
                        className={`flex-1 h-7 rounded text-[11px] font-mono uppercase transition-colors ${
                          bootDevice === dev
                            ? 'bg-slate-700 text-white font-medium'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {dev}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-slate-800">
                <div>
                  <div className="text-xs font-medium text-slate-200">Turbo Engine</div>
                  <div className="text-[11px] text-slate-500">
                    Burst CPU scheduler, larger JIT blocks &amp; 30 FPS VGA pacing
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={turboMode}
                  onClick={onToggleTurboMode}
                  className={`h-6 w-11 rounded-full transition-colors p-0.5 flex items-center shrink-0 ${
                    turboMode ? 'bg-emerald-600 justify-end' : 'bg-slate-700 justify-start'
                  }`}
                >
                  <span className="w-5 h-5 rounded-full bg-white block" />
                </button>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-slate-800">
                <div>
                  <div className="text-xs font-medium text-slate-200">Virtual Sound Card</div>
                  <div className="text-[11px] text-slate-500">
                    Off by default for faster CPU &amp; WebKit stability (next boot)
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={soundEnabled}
                  onClick={onToggleSound}
                  className={`h-6 w-11 rounded-full transition-colors p-0.5 flex items-center shrink-0 ${
                    soundEnabled ? 'bg-sky-600 justify-end' : 'bg-slate-700 justify-start'
                  }`}
                >
                  <span className="w-5 h-5 rounded-full bg-white block" />
                </button>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-slate-800">
                <div>
                  <div className="text-xs font-medium text-slate-200">Browser Fetch Network</div>
                  <div className="text-[11px] text-slate-500">
                    Virtual NIC bridge for Arch/Linux HTTP access
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={networkEnabled}
                  onClick={onToggleNetwork}
                  className={`h-6 w-11 rounded-full transition-colors p-0.5 flex items-center shrink-0 ${
                    networkEnabled ? 'bg-sky-600 justify-end' : 'bg-slate-700 justify-start'
                  }`}
                >
                  <span className="w-5 h-5 rounded-full bg-white block" />
                </button>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-slate-800">
                <div>
                  <div className="text-xs font-medium text-slate-200">Crisp Pixel Scaling</div>
                  <div className="text-[11px] text-slate-500">
                    Sharp X11 text on Retina / HiDPI displays
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={crispScaling}
                  onClick={onToggleCrispScaling}
                  className={`h-6 w-11 rounded-full transition-colors p-0.5 flex items-center shrink-0 ${
                    crispScaling ? 'bg-sky-600 justify-end' : 'bg-slate-700 justify-start'
                  }`}
                >
                  <span className="w-5 h-5 rounded-full bg-white block" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Slide-down Machine State Persistence Panel */}
      {openMenu === 'state' && (
        <div className="border-t border-slate-800 bg-slate-900/98 px-4 py-4">
          <div className="max-w-4xl mx-auto flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-xs font-semibold text-slate-200">
                  Machine State Snapshots
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Save full CPU registers and RAM to browser IndexedDB or export a portable .bin file for instant resume.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={onSaveSnapshotDb}
                  disabled={(status !== 'running' && status !== 'paused') || isSavingState}
                  className={`${btnBase} bg-sky-600 hover:bg-sky-500 text-white`}
                >
                  <Database className="w-3.5 h-3.5" />
                  <span>{isSavingState ? 'Saving...' : 'Save to Browser'}</span>
                </button>
                <button
                  type="button"
                  onClick={onDownloadStateFile}
                  disabled={(status !== 'running' && status !== 'paused') || isSavingState}
                  className={`${btnBase} bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700`}
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Export .bin</span>
                </button>
                <input
                  ref={stateInputRef}
                  type="file"
                  accept=".bin,.zst"
                  onChange={handleStateFile}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => stateInputRef.current?.click()}
                  className={`${btnBase} bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700`}
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                  <span>Load .bin File</span>
                </button>
              </div>
            </div>

            {snapshots.length === 0 ? (
              <div className="text-xs text-slate-500 py-3 border-t border-slate-800">
                No browser snapshots saved yet. Boot an OS to its desktop and click &ldquo;Save to Browser&rdquo; for near-instant restores.
              </div>
            ) : (
              <div className="border-t border-slate-800 pt-3 divide-y divide-slate-800/80">
                {snapshots.map((snap) => (
                  <div
                    key={snap.id}
                    className="py-2 flex items-center justify-between gap-3 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="font-medium text-slate-200 truncate">{snap.name}</div>
                      <div className="text-[11px] text-slate-400 font-mono tabular-nums">
                        {snap.presetName} · {snap.memoryMb} MB · {formatBytes(snap.byteLength)} ·{' '}
                        {new Date(snap.savedAt).toLocaleString()}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => onRestoreSnapshotDb(snap.id)}
                        className="h-8 px-3 rounded bg-slate-800 hover:bg-sky-600 text-slate-100 text-xs font-medium border border-slate-700 hover:border-sky-500 transition-colors"
                      >
                        Restore
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteSnapshotDb(snap.id)}
                        aria-label={`Delete snapshot ${snap.name}`}
                        className="h-8 w-8 rounded bg-slate-800 hover:bg-red-900/60 text-slate-400 hover:text-red-200 border border-slate-700 flex items-center justify-center transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </header>
  );
};
