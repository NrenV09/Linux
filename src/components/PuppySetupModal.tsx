import React, { useState } from 'react';
import { X, Play, Copy, Check, Download, HardDriveUpload, ShieldCheck } from 'lucide-react';
import type { PuppyDirectBootParams } from '../types/v86';
import { formatBytes } from '../lib/presets';
import { FAST_PUPPY_CMDLINE, inspectAndExtractPuppyIso } from '../lib/isoPuppyExtractor';

interface PuppySetupModalProps {
  open: boolean;
  v86Ready: boolean;
  onClose: () => void;
  onBootPuppyDirect: (params: PuppyDirectBootParams) => void;
  onInputFocusChange: (focused: boolean) => void;
}

const DEFAULT_PUPPY_CMDLINE = FAST_PUPPY_CMDLINE;

const DIRECTORY_LAYOUT = `repo-root/
├── index.html                  # Standalone v86 iPadOS WebKit entry point
├── emulator-config.js          # v86 (32-bit BookwormPup32/NoblePup32) + QEMU-Wasm (VoidPup64)
├── _headers                    # Cloudflare Pages Cache-Control, MIME, Range & optional COOP/COEP
└── puppy/                      # Extracted directly from BookwormPup32 or NoblePup32 ISO
    ├── vmlinuz                 # 32-bit i686 Linux kernel (loaded directly via bzimage)
    ├── initrd.gz               # Initial ramdisk (loaded directly via initrd)
    ├── BookwormPup32.iso       # Original ISO served with HTTP Range (async: true, 256KB chunks)
    │                           #   Contains on-demand SquashFS layers (never copied into RAM):
    │                           #   ├── puppy_dpupbw32_*.sfs   (core Xorg/JWM desktop & apps)
    │                           #   ├── zdrv_dpupbw32_*.sfs    (kernel modules: ne2k_pci, virtio)
    │                           #   └── fdrv_dpupbw32_*.sfs    (firmware blobs)
    └── (optional) puppy64/     # For secondary QEMU-Wasm x86_64 setup (VoidPup64)
        ├── vmlinuz
        ├── initrd.gz
        └── VoidPup64.iso`;

const QEMU_WASM_SNIPPET = `// Secondary Engine: QEMU-Wasm 64-bit x86_64 (e.g. VoidPup64)
// Requires Cross-Origin Isolation (COOP/COEP) + SharedArrayBuffer pthreads
const canRunQemuWasm =
  window.crossOriginIsolated === true && typeof SharedArrayBuffer !== 'undefined';

export const qemuVoidPup64Args = [
  '-machine', 'pc,acpi=off',
  '-cpu', 'max,-svm,-vmx',
  '-smp', '2',
  '-m', '512M',                  // Strict iPadOS WebKit ceiling
  '-vga', 'std',                 // Standard Bochs/VBE VGA for Xorg/JWM (no Wayland)
  '-display', 'sdl',
  '-kernel', '/pack/vmlinuz',
  '-initrd', '/pack/initrd.gz',
  '-cdrom', '/pack/VoidPup64.iso',
  '-append', 'pfix=ram,nocopy pmedia=cd acpi=off mitigations=off vga=791',
  '-netdev', 'user,id=net0',
  '-device', 'virtio-net-pci,netdev=net0',
  '-device', 'usb-ehci',
  '-device', 'usb-tablet',
];`;

const HEADERS_SNIPPET = `# Cloudflare Pages (_headers) — GitHub Pages works with v86 out of the box (no COOP/COEP needed)
/*.wasm
  Content-Type: application/wasm
  Cache-Control: public, max-age=31536000, immutable
  Access-Control-Allow-Origin: *

/puppy/*.iso
  Content-Type: application/octet-stream
  Cache-Control: public, max-age=604800
  Access-Control-Allow-Origin: *
  Access-Control-Expose-Headers: Content-Length, Content-Range, Accept-Ranges

/puppy/vmlinuz
  Content-Type: application/octet-stream
  Cache-Control: public, max-age=604800

/puppy/initrd.gz
  Content-Type: application/gzip
  Cache-Control: public, max-age=604800

# Optional — Required ONLY for multi-threaded QEMU-Wasm (VoidPup64):
# /*
#   Cross-Origin-Opener-Policy: same-origin
#   Cross-Origin-Embedder-Policy: require-corp
#   Cross-Origin-Resource-Policy: cross-origin`;

export const PuppySetupModal: React.FC<PuppySetupModalProps> = ({
  open,
  v86Ready,
  onClose,
  onBootPuppyDirect,
  onInputFocusChange,
}) => {
  const [tab, setTab] = useState<'boot' | 'layout' | 'config'>('boot');
  const [vmlinuzFile, setVmlinuzFile] = useState<File | null>(null);
  const [initrdFile, setInitrdFile] = useState<File | null>(null);
  const [extractedBuffers, setExtractedBuffers] = useState<{
    vmlinuzName: string;
    vmlinuzBuffer: ArrayBuffer;
    initrdName: string;
    initrdBuffer: ArrayBuffer;
  } | null>(null);
  const [extractNote, setExtractNote] = useState<string | null>(null);
  const [isoFile, setIsoFile] = useState<File | null>(null);
  const [memoryMb, setMemoryMb] = useState<number>(512);
  const [netDeviceType, setNetDeviceType] = useState<'ne2k' | 'virtio'>('ne2k');
  const [networkRelayUrl, setNetworkRelayUrl] = useState<string>('fetch');
  const [cmdline, setCmdline] = useState<string>(DEFAULT_PUPPY_CMDLINE);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  if (!open) return null;

  const isCrossOriginIsolated =
    typeof window !== 'undefined' &&
    window.crossOriginIsolated === true &&
    typeof SharedArrayBuffer !== 'undefined';

  const hasKernel = Boolean(vmlinuzFile || extractedBuffers?.vmlinuzBuffer);
  const hasInitrd = Boolean(initrdFile || extractedBuffers?.initrdBuffer);
  const canBootDirect = Boolean(v86Ready && hasKernel && hasInitrd && isoFile);

  const handleCopy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey(null), 2000);
    } catch {
      // Clipboard unavailable
    }
  };

  const tryAutoExtractFromIso = async (file: File) => {
    setExtractNote('Scanning ISO for vmlinuz & initrd.gz...');
    const extracted = await inspectAndExtractPuppyIso(file);
    if (extracted) {
      setExtractedBuffers({
        vmlinuzName: extracted.vmlinuzName,
        vmlinuzBuffer: extracted.vmlinuzBuffer,
        initrdName: extracted.initrdName,
        initrdBuffer: extracted.initrdBuffer,
      });
      setExtractNote(
        `Auto-extracted ${extracted.vmlinuzName} (${formatBytes(extracted.vmlinuzBuffer.byteLength)}) & ${extracted.initrdName} (${formatBytes(extracted.initrdBuffer.byteLength)}) straight from ISO.`
      );
    } else {
      setExtractedBuffers(null);
      setExtractNote(null);
    }
  };

  const handleMultiPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    let pickedIso: File | null = null;
    let pickedKernel = false;
    let pickedInitrd = false;
    for (const f of files) {
      const lower = f.name.toLowerCase();
      if (lower.includes('vmlinuz')) {
        setVmlinuzFile(f);
        pickedKernel = true;
      } else if (lower.includes('initrd')) {
        setInitrdFile(f);
        pickedInitrd = true;
      } else if (lower.endsWith('.iso') || lower.endsWith('.img')) {
        setIsoFile(f);
        pickedIso = f;
      }
    }
    if (pickedIso && (!pickedKernel || !pickedInitrd)) {
      void tryAutoExtractFromIso(pickedIso);
    }
    e.target.value = '';
  };

  const handleLaunch = () => {
    if (!canBootDirect || !isoFile) return;
    onBootPuppyDirect({
      vmlinuzFile: vmlinuzFile ?? null,
      initrdFile: initrdFile ?? null,
      vmlinuzBuffer: vmlinuzFile ? undefined : extractedBuffers?.vmlinuzBuffer,
      initrdBuffer: initrdFile ? undefined : extractedBuffers?.initrdBuffer,
      isoFile,
      memoryMb,
      vramMb: 8,
      cmdline: cmdline.trim() || DEFAULT_PUPPY_CMDLINE,
      netDeviceType,
      networkRelayUrl: networkRelayUrl.trim() || 'fetch',
    });
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Puppy Linux iPadOS WebKit Setup"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl max-h-[88dvh] bg-slate-900 border border-slate-700 rounded-lg shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-4 px-5 py-3.5 border-b border-slate-800 shrink-0">
          <div>
            <h2 className="text-sm font-semibold text-slate-100">
              Puppy Linux iPadOS WebKit Setup (BookwormPup32 / NoblePup32)
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Direct kernel + initrd boot with async ISO streaming &amp; strict 256–512 MB Safari RAM cap
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Puppy Linux setup"
            className="h-8 w-8 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Segmented Tabs */}
        <div className="px-5 pt-3 border-b border-slate-800 flex items-center gap-1 shrink-0">
          {[
            { id: 'boot', label: 'Direct Kernel Boot' },
            { id: 'layout', label: 'ISO Layout & Headers' },
            { id: 'config', label: 'v86 & QEMU-Wasm Export' },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id as typeof tab)}
              className={`px-3.5 py-2 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${
                tab === t.id
                  ? 'border-sky-500 text-slate-100'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5 text-xs">
          {tab === 'boot' && (
            <>
              <div className="p-3.5 rounded-md bg-slate-950 border border-slate-800 flex items-start gap-3">
                <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <div className="space-y-1 text-slate-300 leading-relaxed">
                  <div className="font-medium text-slate-100">
                    iPadOS Safari / WebKit Memory Guardrails Active
                  </div>
                  <p className="text-slate-400">
                    Guest RAM is capped at 256–512 MB, <span className="font-mono text-slate-200">pfix=ram,nocopy</span> prevents Puppy from duplicating <span className="font-mono text-slate-200">.sfs</span> layers into guest RAM, and the ISO mounts via <span className="font-mono text-slate-200">AsyncFileBuffer</span> (on-demand 256 KB slices) instead of buffering the entire ISO twice in browser memory.
                  </p>
                </div>
              </div>

              {/* Multi-file quick picker or individual slots */}
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-slate-200">
                    1. Select Puppy Linux Boot Files (BookwormPup32 / NoblePup32)
                  </span>
                  <label className="h-8 px-3 rounded bg-slate-800 hover:bg-slate-700 text-sky-300 border border-slate-700 cursor-pointer inline-flex items-center gap-1.5 font-medium">
                    <HardDriveUpload className="w-3.5 h-3.5" />
                    <span>Pick All 3 Together</span>
                    <input type="file" multiple onChange={handleMultiPick} className="hidden" />
                  </label>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <label className="p-3 rounded-md bg-slate-950 border border-slate-800 hover:border-slate-600 cursor-pointer block">
                    <div className="font-mono text-[11px] text-slate-400">Kernel (bzimage)</div>
                    <div className="font-medium text-slate-100 mt-1 truncate">
                      {vmlinuzFile
                        ? vmlinuzFile.name
                        : extractedBuffers
                          ? `${extractedBuffers.vmlinuzName} (auto)`
                          : 'Auto-extracted or pick'}
                    </div>
                    <div className="text-[11px] font-mono tabular-nums text-slate-500 mt-0.5">
                      {vmlinuzFile
                        ? formatBytes(vmlinuzFile.size)
                        : extractedBuffers
                          ? formatBytes(extractedBuffers.vmlinuzBuffer.byteLength)
                          : 'Auto from .iso · ~6–10 MB'}
                    </div>
                    <input
                      type="file"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) setVmlinuzFile(f);
                        e.target.value = '';
                      }}
                      className="hidden"
                    />
                  </label>

                  <label className="p-3 rounded-md bg-slate-950 border border-slate-800 hover:border-slate-600 cursor-pointer block">
                    <div className="font-mono text-[11px] text-slate-400">Ramdisk (initrd)</div>
                    <div className="font-medium text-slate-100 mt-1 truncate">
                      {initrdFile
                        ? initrdFile.name
                        : extractedBuffers
                          ? `${extractedBuffers.initrdName} (auto)`
                          : 'Auto-extracted or pick'}
                    </div>
                    <div className="text-[11px] font-mono tabular-nums text-slate-500 mt-0.5">
                      {initrdFile
                        ? formatBytes(initrdFile.size)
                        : extractedBuffers
                          ? formatBytes(extractedBuffers.initrdBuffer.byteLength)
                          : 'Auto from .iso · ~2–4 MB'}
                    </div>
                    <input
                      type="file"
                      accept=".gz,*"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) setInitrdFile(f);
                        e.target.value = '';
                      }}
                      className="hidden"
                    />
                  </label>

                  <label className="p-3 rounded-md bg-slate-950 border border-slate-800 hover:border-slate-600 cursor-pointer block">
                    <div className="font-mono text-[11px] text-slate-400">Puppy ISO (2 MB Read-Ahead)</div>
                    <div className="font-medium text-slate-100 mt-1 truncate">
                      {isoFile ? isoFile.name : 'Select Puppy .iso'}
                    </div>
                    <div className="text-[11px] font-mono tabular-nums text-slate-500 mt-0.5">
                      {isoFile ? `${formatBytes(isoFile.size)} (cached stream)` : 'Just pick .iso — auto-extracts'}
                    </div>
                    <input
                      type="file"
                      accept=".iso,.img"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) {
                          setIsoFile(f);
                          void tryAutoExtractFromIso(f);
                        }
                        e.target.value = '';
                      }}
                      className="hidden"
                    />
                  </label>
                </div>
                {extractNote && (
                  <div className="text-[11px] font-mono text-emerald-400 bg-emerald-950/30 border border-emerald-800/50 rounded px-3 py-1.5">
                    {extractNote}
                  </div>
                )}
              </div>

              {/* Guardrailed RAM + Networking */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <div className="font-semibold text-slate-300 mb-1.5">
                    iPadOS Guardrailed RAM
                  </div>
                  <div className="flex items-center gap-1 p-1 bg-slate-950 rounded-md border border-slate-800">
                    {[256, 384, 512].map((mb) => (
                      <button
                        key={mb}
                        type="button"
                        onClick={() => setMemoryMb(mb)}
                        className={`flex-1 h-7 rounded font-mono tabular-nums transition-colors ${
                          memoryMb === mb
                            ? 'bg-sky-600 text-white font-medium'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {mb} MB
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="font-semibold text-slate-300 mb-1.5">Network Adapter</div>
                  <div className="flex items-center gap-1 p-1 bg-slate-950 rounded-md border border-slate-800">
                    {(['ne2k', 'virtio'] as const).map((nic) => (
                      <button
                        key={nic}
                        type="button"
                        onClick={() => setNetDeviceType(nic)}
                        className={`flex-1 h-7 rounded font-mono transition-colors ${
                          netDeviceType === nic
                            ? 'bg-slate-700 text-white font-medium'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {nic === 'ne2k' ? 'ne2k_pci' : 'virtio'}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label htmlFor="puppy-relay" className="block font-semibold text-slate-300 mb-1.5">
                    Relay Proxy URL
                  </label>
                  <input
                    id="puppy-relay"
                    type="text"
                    value={networkRelayUrl}
                    onChange={(e) => setNetworkRelayUrl(e.target.value)}
                    onFocus={() => onInputFocusChange(true)}
                    onBlur={() => onInputFocusChange(false)}
                    placeholder="fetch or wss://relay.widgetry.org/"
                    className="w-full h-9 px-2.5 rounded-md bg-slate-950 border border-slate-700 font-mono text-slate-100 focus:outline-none focus:border-sky-500"
                  />
                </div>
              </div>

              {/* Kernel Cmdline */}
              <div>
                <label htmlFor="puppy-cmdline" className="block font-semibold text-slate-300 mb-1.5">
                  Kernel Command Line (cmdline)
                </label>
                <input
                  id="puppy-cmdline"
                  type="text"
                  value={cmdline}
                  onChange={(e) => setCmdline(e.target.value)}
                  onFocus={() => onInputFocusChange(true)}
                  onBlur={() => onInputFocusChange(false)}
                  className="w-full h-9 px-3 rounded-md bg-slate-950 border border-slate-700 font-mono text-slate-100 focus:outline-none focus:border-sky-500"
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  Uses 8 MB Bochs/VBE VGA (<span className="font-mono">vga=791</span>) for crisp Xorg/JWM desktop rendering without Wayland.
                </p>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={onClose}
                  className="h-9 px-4 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!canBootDirect}
                  onClick={handleLaunch}
                  className="h-9 px-4 rounded-md bg-sky-600 hover:bg-sky-500 text-white font-medium flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Play className="w-3.5 h-3.5" />
                  <span>Boot Puppy Linux (Direct Kernel)</span>
                </button>
              </div>
            </>
          )}

          {tab === 'layout' && (
            <div className="space-y-5">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold text-slate-200">
                    Exact Puppy Linux ISO Extraction &amp; Hosting Layout
                  </h3>
                  <button
                    type="button"
                    onClick={() => void handleCopy('layout', DIRECTORY_LAYOUT)}
                    className="h-7 px-2.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 inline-flex items-center gap-1.5"
                  >
                    {copiedKey === 'layout' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedKey === 'layout' ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
                <pre className="p-3.5 rounded-md bg-slate-950 border border-slate-800 font-mono text-[11px] text-slate-300 overflow-x-auto leading-relaxed">
                  {DIRECTORY_LAYOUT}
                </pre>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold text-slate-200">
                    HTTP Headers Checklist (GitHub Pages / Cloudflare Pages)
                  </h3>
                  <button
                    type="button"
                    onClick={() => void handleCopy('headers', HEADERS_SNIPPET)}
                    className="h-7 px-2.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 inline-flex items-center gap-1.5"
                  >
                    {copiedKey === 'headers' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedKey === 'headers' ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
                <pre className="p-3.5 rounded-md bg-slate-950 border border-slate-800 font-mono text-[11px] text-slate-300 overflow-x-auto leading-relaxed">
                  {HEADERS_SNIPPET}
                </pre>
              </div>
            </div>
          )}

          {tab === 'config' && (
            <div className="space-y-5">
              {/* Standalone Downloadable Bundle */}
              <div className="p-4 rounded-md bg-slate-950 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <div className="font-semibold text-slate-100">
                    Standalone Puppy Linux Bundle (Ready for GitHub Pages / Cloudflare)
                  </div>
                  <p className="text-slate-400 mt-0.5">
                    Includes complete <span className="font-mono text-slate-200">index.html</span>, <span className="font-mono text-slate-200">emulator-config.js</span>, and <span className="font-mono text-slate-200">_headers</span>.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <a
                    href="./puppy-standalone/index.html"
                    download="index.html"
                    className="h-8 px-3 rounded bg-sky-600 hover:bg-sky-500 text-white font-medium inline-flex items-center gap-1.5"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>index.html</span>
                  </a>
                  <a
                    href="./puppy-standalone/emulator-config.js"
                    download="emulator-config.js"
                    className="h-8 px-3 rounded bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 font-medium inline-flex items-center gap-1.5"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>emulator-config.js</span>
                  </a>
                  <a
                    href="./puppy-standalone/_headers"
                    download="_headers"
                    className="h-8 px-3 rounded bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 font-medium inline-flex items-center gap-1.5"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>_headers</span>
                  </a>
                </div>
              </div>

              {/* Secondary QEMU-Wasm 64-bit VoidPup64 Block */}
              <div>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div>
                    <h3 className="font-semibold text-slate-200">
                      Secondary Engine: QEMU-Wasm 64-bit x86_64 (VoidPup64)
                    </h3>
                    <div className="text-[11px] font-mono text-slate-400 mt-0.5">
                      Current browser SharedArrayBuffer / COOP+COEP:{' '}
                      <span className={isCrossOriginIsolated ? 'text-emerald-400' : 'text-amber-400'}>
                        {isCrossOriginIsolated ? 'Enabled (Ready for QEMU-Wasm)' : 'Disabled (Use v86 single-threaded)'}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleCopy('qemu', QEMU_WASM_SNIPPET)}
                    className="h-7 px-2.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 inline-flex items-center gap-1.5 shrink-0"
                  >
                    {copiedKey === 'qemu' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedKey === 'qemu' ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
                <pre className="p-3.5 rounded-md bg-slate-950 border border-slate-800 font-mono text-[11px] text-slate-300 overflow-x-auto leading-relaxed">
                  {QEMU_WASM_SNIPPET}
                </pre>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
