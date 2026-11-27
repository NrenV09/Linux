import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  X,
  Wifi,
  FolderUp,
  Globe,
  Terminal,
  Copy,
  Check,
  RefreshCw,
  Download,
  Trash2,
  Play,
  Plus,
  ExternalLink,
  HardDrive,
  FileCode2,
} from 'lucide-react';
import type { EmulatorStatus, SharedHostFile, WebServerEngine } from '../types/v86';
import { formatBytes } from '../lib/presets';
import {
  buildAutoNetworkOneLiner,
  buildMount9pOneLiner,
  buildMountDiskOneLiner,
  buildOpenGuestBrowserOneLiner,
  buildWebServerOneLiner,
  compileLiveWebPreview,
  decodeUtf8,
  encodeUtf8,
  guessMimeType,
  sanitizeGuestFilename,
} from '../lib/guestBridge';

interface GuestToolsModalProps {
  open: boolean;
  initialTab?: 'network' | 'files' | 'web';
  status: EmulatorStatus;
  networkEnabled: boolean;
  netDeviceType: 'ne2k' | 'virtio';
  networkRelayUrl: string;
  attachTransferDrive: boolean;
  sharedFiles: SharedHostFile[];
  webServerEngine: WebServerEngine;
  webServerPort: number;
  onClose: () => void;
  onToggleNetwork: () => void;
  onNetDeviceTypeChange: (type: 'ne2k' | 'virtio') => void;
  onNetworkRelayUrlChange: (url: string) => void;
  onToggleTransferDrive: () => void;
  onWebServerEngineChange: (engine: WebServerEngine) => void;
  onWebServerPortChange: (port: number) => void;
  onImportHostFiles: (files: FileList | File[], folder: 'ipad' | 'www') => Promise<void>;
  onSaveWebFile: (name: string, content: string) => Promise<void>;
  onDeleteSharedFile: (name: string, folder: 'ipad' | 'www') => void;
  onPullFromVm9p: (folder: 'ipad' | 'www') => Promise<number>;
  onRunGuestCommand: (command: string, label: string) => void;
  onRebootWithUpdatedDrive: () => void;
  onInputFocusChange: (focused: boolean) => void;
}

const TEXT_EDITABLE_RE = /\.(html?|css|m?js|json|txt|md|svg|sh|py|php|xml|conf|cfg)$/i;

export const GuestToolsModal: React.FC<GuestToolsModalProps> = ({
  open,
  initialTab = 'network',
  status,
  networkEnabled,
  netDeviceType,
  networkRelayUrl,
  attachTransferDrive,
  sharedFiles,
  webServerEngine,
  webServerPort,
  onClose,
  onToggleNetwork,
  onNetDeviceTypeChange,
  onNetworkRelayUrlChange,
  onToggleTransferDrive,
  onWebServerEngineChange,
  onWebServerPortChange,
  onImportHostFiles,
  onSaveWebFile,
  onDeleteSharedFile,
  onPullFromVm9p,
  onRunGuestCommand,
  onRebootWithUpdatedDrive,
  onInputFocusChange,
}) => {
  const [tab, setTab] = useState<'network' | 'files' | 'web'>(initialTab);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [selectedWebFile, setSelectedWebFile] = useState<string>('index.html');
  const [editorDraft, setEditorDraft] = useState<string>('');
  const [editorDirty, setEditorDirty] = useState<boolean>(false);
  const [newFileName, setNewFileName] = useState<string>('');
  const [previewEntry, setPreviewEntry] = useState<string>('index.html');
  const [previewNonce, setPreviewNonce] = useState<number>(0);

  const ipadInputRef = useRef<HTMLInputElement>(null);
  const webInputRef = useRef<HTMLInputElement>(null);
  const blobUrlsRef = useRef<string[]>([]);

  useEffect(() => {
    if (open) {
      setTab(initialTab);
    }
  }, [open, initialTab]);

  const ipadFiles = useMemo(
    () => sharedFiles.filter((f) => f.folder === 'ipad'),
    [sharedFiles]
  );
  const wwwFiles = useMemo(
    () => sharedFiles.filter((f) => f.folder === 'www'),
    [sharedFiles]
  );

  // Keep editor draft synced when switching selected web file
  useEffect(() => {
    const target = wwwFiles.find((f) => f.name === selectedWebFile) ?? wwwFiles[0];
    if (target) {
      if (target.name !== selectedWebFile) {
        setSelectedWebFile(target.name);
      }
      if (TEXT_EDITABLE_RE.test(target.name)) {
        setEditorDraft(decodeUtf8(target.data));
      } else {
        setEditorDraft('');
      }
      setEditorDirty(false);
    }
  }, [selectedWebFile, wwwFiles]);

  // Compile live host browser preview HTML with Blob URLs for CSS/JS/images
  const previewSrcDoc = useMemo(() => {
    blobUrlsRef.current.forEach((u) => URL.revokeObjectURL(u));
    blobUrlsRef.current = [];
    if (!open || tab !== 'web') return '';

    const map = new Map<string, Uint8Array>();
    for (const f of wwwFiles) {
      map.set(f.name, f.data);
    }
    if (editorDirty && selectedWebFile && TEXT_EDITABLE_RE.test(selectedWebFile)) {
      map.set(selectedWebFile, encodeUtf8(editorDraft));
    }

    const compiled = compileLiveWebPreview(map, previewEntry);
    blobUrlsRef.current = compiled.blobUrls;
    return compiled.html;
    // previewNonce forces clean reload when user hits Refresh from VM
  }, [open, tab, wwwFiles, previewEntry, editorDirty, selectedWebFile, editorDraft, previewNonce]);

  useEffect(() => {
    return () => {
      blobUrlsRef.current.forEach((u) => URL.revokeObjectURL(u));
      blobUrlsRef.current = [];
    };
  }, []);

  if (!open) return null;

  const isRunning = status === 'running';
  const netOneLiner = buildAutoNetworkOneLiner().trim();
  const mount9pOneLiner = buildMount9pOneLiner().trim();
  const mountDiskOneLiner = buildMountDiskOneLiner().trim();
  const webOneLiner = buildWebServerOneLiner(webServerEngine, webServerPort).trim();

  const handleCopy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey(null), 1800);
    } catch {
      // Clipboard blocked
    }
  };

  const handleDownloadFile = (file: SharedHostFile) => {
    const copy = new Uint8Array(file.data.byteLength);
    copy.set(file.data);
    const blob = new Blob([copy], { type: file.mimeType || guessMimeType(file.name) });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleCreateNewWebFile = async () => {
    const safe = sanitizeGuestFilename(newFileName.trim());
    if (!newFileName.trim() || !safe) return;
    await onSaveWebFile(safe, '');
    setSelectedWebFile(safe);
    setNewFileName('');
  };

  const selectedFileObj = wwwFiles.find((f) => f.name === selectedWebFile) ?? null;
  const isSelectedTextEditable = selectedFileObj ? TEXT_EDITABLE_RE.test(selectedFileObj.name) : false;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-3 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Puppy Linux Network, iPad Files, and Web Server"
      onClick={onClose}
    >
      <div
        className="w-full max-w-5xl max-h-[90dvh] bg-slate-900 border border-slate-700 rounded-lg shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between gap-4 px-5 py-3.5 border-b border-slate-800 shrink-0">
          <div>
            <h2 className="text-sm font-semibold text-slate-100">
              Puppy Linux Network, iPad File Bridge &amp; Web Server
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Automatic virtual NIC + DHCP, live 9p &amp; virtual FAT16 drive for iPad files, and built-in HTTP server
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Network, Files, and Web Server panel"
            className="h-8 w-8 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="px-5 pt-2.5 border-b border-slate-800 flex items-center gap-1 overflow-x-auto shrink-0">
          {[
            { id: 'network', label: 'Auto Network', icon: Wifi },
            { id: 'files', label: `iPad Files (${ipadFiles.length})`, icon: FolderUp },
            { id: 'web', label: `Web Server (${wwwFiles.length})`, icon: Globe },
          ].map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id as typeof tab)}
                className={`px-3.5 py-2 text-xs font-medium border-b-2 transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                  tab === item.id
                    ? 'border-sky-500 text-slate-100'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 text-xs space-y-5">
          {/* TAB 1: AUTOMATIC NETWORK */}
          {tab === 'network' && (
            <div className="space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 rounded-md bg-slate-950 border border-slate-800 space-y-3.5">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-semibold text-slate-100">Automatic Virtual NIC</div>
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        Attached automatically on every Puppy Linux &amp; local ISO boot
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

                  <div>
                    <div className="font-medium text-slate-300 mb-1.5">Virtual Ethernet Driver</div>
                    <div className="flex items-center gap-1 p-1 bg-slate-900 rounded-md border border-slate-800">
                      {(['ne2k', 'virtio'] as const).map((nic) => (
                        <button
                          key={nic}
                          type="button"
                          onClick={() => onNetDeviceTypeChange(nic)}
                          className={`flex-1 h-8 rounded font-mono transition-colors ${
                            netDeviceType === nic
                              ? 'bg-sky-600 text-white font-medium'
                              : 'text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          {nic === 'ne2k' ? 'ne2k_pci (All Puppy ISOs)' : 'virtio-net (Modern)'}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label htmlFor="net-relay-input" className="block font-medium text-slate-300 mb-1.5">
                      Browser Relay Backend (Full Internet vs HTTP-Only)
                    </label>
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      <button
                        type="button"
                        onClick={() => onNetworkRelayUrlChange('wss://relay.widgetry.org/')}
                        className={`h-7 px-2.5 rounded border font-mono text-[11px] ${
                          networkRelayUrl === 'wss://relay.widgetry.org/'
                            ? 'bg-sky-600 border-sky-500 text-white'
                            : 'bg-slate-900 border-slate-700 text-slate-300'
                        }`}
                      >
                        wss://relay.widgetry.org/ (Full Internet)
                      </button>
                      <button
                        type="button"
                        onClick={() => onNetworkRelayUrlChange('fetch')}
                        className={`h-7 px-2.5 rounded border font-mono text-[11px] ${
                          networkRelayUrl === 'fetch'
                            ? 'bg-sky-600 border-sky-500 text-white'
                            : 'bg-slate-900 border-slate-700 text-slate-300'
                        }`}
                      >
                        fetch (CORS-Only Port 80)
                      </button>
                    </div>
                    <input
                      id="net-relay-input"
                      type="text"
                      value={networkRelayUrl}
                      onChange={(e) => onNetworkRelayUrlChange(e.target.value)}
                      onFocus={() => onInputFocusChange(true)}
                      onBlur={() => onInputFocusChange(false)}
                      className="w-full h-9 px-3 rounded-md bg-slate-900 border border-slate-700 font-mono text-slate-100 focus:outline-none focus:border-sky-500"
                    />
                    <p className="text-[11px] text-slate-500 mt-1.5 leading-relaxed">
                      <strong className="text-slate-300">wss://relay.widgetry.org/</strong> enables real DHCP (10.5.x.x), DNS, ICMP ping, TCP/HTTPS, and HTTP without browser CORS errors. <span className="font-mono">fetch</span> only supports port 80 CORS-enabled sites.
                    </p>
                  </div>
                </div>

                <div className="p-4 rounded-md bg-slate-950 border border-slate-800 space-y-3.5">
                  <div className="font-semibold text-slate-100">
                    1-Click Guest Network Auto-Configurator
                  </div>
                  <p className="text-slate-400 leading-relaxed">
                    Every Linux preset &amp; local ISO automatically receives the <span className="font-mono text-slate-200">{netDeviceType === 'ne2k' ? 'ne2k_pci' : 'virtio-net'}</span> NIC and auto-DHCP (<span className="font-mono text-slate-200">pump</span> / <span className="font-mono text-slate-200">udhcpc</span> / <span className="font-mono text-slate-200">dhcpcd</span>). If an ISO does not bring up <span className="font-mono text-slate-200">eth0</span> on its own, open its terminal and click below:
                  </p>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={!isRunning}
                      onClick={() => {
                        onRunGuestCommand(buildAutoNetworkOneLiner(), 'Network auto-configuration');
                        onClose();
                      }}
                      className="h-9 px-3.5 rounded-md bg-sky-600 hover:bg-sky-500 text-white font-medium inline-flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Terminal className="w-3.5 h-3.5" />
                      <span>Run Network Auto-Config in Guest</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleCopy('net', netOneLiner)}
                      className="h-9 px-3 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 inline-flex items-center gap-1.5"
                    >
                      {copiedKey === 'net' ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                      <span>{copiedKey === 'net' ? 'Copied' : 'Copy Command'}</span>
                    </button>
                  </div>

                  <pre className="p-2.5 rounded bg-slate-900 border border-slate-800 font-mono text-[11px] text-slate-300 overflow-x-auto whitespace-pre-wrap break-all">
                    {netOneLiner}
                  </pre>

                  <div className="flex items-center justify-between pt-2 border-t border-slate-800">
                    <div>
                      <div className="font-medium text-slate-200">Auto-Attach IPAD_FILES Drive (/dev/sda1)</div>
                      <div className="text-[11px] text-slate-500">
                        Includes net-auto.sh, mount-ipad.sh, websrv.sh, and queued iPad files on CD boots
                      </div>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={attachTransferDrive}
                      onClick={onToggleTransferDrive}
                      className={`h-6 w-11 rounded-full transition-colors p-0.5 flex items-center shrink-0 ${
                        attachTransferDrive ? 'bg-sky-600 justify-end' : 'bg-slate-700 justify-start'
                      }`}
                    >
                      <span className="w-5 h-5 rounded-full bg-white block" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: IPAD LOCAL FILES BRIDGE */}
          {tab === 'files' && (
            <div className="space-y-4">
              <div className="p-4 rounded-md bg-slate-950 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="font-semibold text-slate-100">
                    Import Local iPad Files into Puppy Linux
                  </div>
                  <p className="text-slate-400 leading-relaxed">
                    Files are delivered via <strong className="text-slate-200 font-medium">two automatic transports</strong>: live VirtIO <span className="font-mono text-slate-200">9p</span> (<span className="font-mono text-slate-200">/mnt/ipad</span> — instant, no reboot on BookwormPup32, NoblePup32, Arch, Buildroot) AND a universal <span className="font-mono text-slate-200">FAT16 IPAD_FILES</span> drive (<span className="font-mono text-slate-200">/dev/sda1</span> — appears as a clickable drive icon on 100% of Puppy Linux desktops).
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <input
                    ref={ipadInputRef}
                    type="file"
                    multiple
                    onChange={(e) => {
                      if (e.target.files?.length) {
                        void onImportHostFiles(e.target.files, 'ipad');
                      }
                      e.target.value = '';
                    }}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => ipadInputRef.current?.click()}
                    className="h-9 px-3.5 rounded-md bg-sky-600 hover:bg-sky-500 text-white font-medium inline-flex items-center gap-1.5 whitespace-nowrap"
                  >
                    <FolderUp className="w-3.5 h-3.5" />
                    <span>Import from iPad Files</span>
                  </button>
                  <button
                    type="button"
                    disabled={!isRunning}
                    onClick={() => void onPullFromVm9p('ipad')}
                    className="h-9 px-3 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 inline-flex items-center gap-1.5 whitespace-nowrap disabled:opacity-40"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Sync from VM</span>
                  </button>
                </div>
              </div>

              {/* Quick Mount Commands for Puppy Terminal */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <button
                  type="button"
                  disabled={!isRunning}
                  onClick={() => {
                    onRunGuestCommand(buildMount9pOneLiner(), 'Mount live 9p /mnt/ipad');
                    onClose();
                  }}
                  className="p-3 rounded-md bg-slate-950 hover:bg-slate-800 border border-slate-800 text-left disabled:opacity-40 transition-colors"
                >
                  <div className="font-medium text-sky-400 flex items-center gap-1.5">
                    <Terminal className="w-3.5 h-3.5" />
                    <span>1. Mount Live 9p (/mnt/ipad)</span>
                  </div>
                  <div className="text-[11px] text-slate-400 mt-1">
                    Instant live sync for BookwormPup32, NoblePup32, Arch, Buildroot
                  </div>
                </button>

                <button
                  type="button"
                  disabled={!isRunning}
                  onClick={() => {
                    onRunGuestCommand(buildMountDiskOneLiner(), 'Mount virtual drive /dev/sda1');
                    onClose();
                  }}
                  className="p-3 rounded-md bg-slate-950 hover:bg-slate-800 border border-slate-800 text-left disabled:opacity-40 transition-colors"
                >
                  <div className="font-medium text-emerald-400 flex items-center gap-1.5">
                    <HardDrive className="w-3.5 h-3.5" />
                    <span>2. Mount FAT16 Drive (/dev/sda1)</span>
                  </div>
                  <div className="text-[11px] text-slate-400 mt-1">
                    Works on every Puppy Linux ISO (or click the sda1 icon on desktop)
                  </div>
                </button>

                <button
                  type="button"
                  disabled={!isRunning}
                  onClick={() => {
                    onRebootWithUpdatedDrive();
                    onClose();
                  }}
                  className="p-3 rounded-md bg-slate-950 hover:bg-slate-800 border border-slate-800 text-left disabled:opacity-40 transition-colors"
                >
                  <div className="font-medium text-amber-400 flex items-center gap-1.5">
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>3. Rebuild FAT16 Drive &amp; Reboot</span>
                  </div>
                  <div className="text-[11px] text-slate-400 mt-1">
                    Repackages newly added iPad files into /dev/sda1 for non-9p ISOs
                  </div>
                </button>
              </div>

              {/* File List */}
              <div className="rounded-md bg-slate-950 border border-slate-800 overflow-hidden">
                <div className="px-3.5 py-2 border-b border-slate-800 flex items-center justify-between text-[11px] font-medium text-slate-400">
                  <span>Shared iPad Files (/mnt/ipad/ &amp; /dev/sda1/)</span>
                  <span className="font-mono tabular-nums">{ipadFiles.length} file(s)</span>
                </div>
                {ipadFiles.length === 0 ? (
                  <div className="p-6 text-center text-slate-500">
                    No iPad files imported yet. Tap <span className="text-slate-300">Import from iPad Files</span> to bring documents, scripts, or media into Puppy Linux.
                  </div>
                ) : (
                  <div className="divide-y divide-slate-800/80 max-h-60 overflow-y-auto">
                    {ipadFiles.map((file) => (
                      <div
                        key={file.name}
                        className="px-3.5 py-2.5 flex items-center justify-between gap-3"
                      >
                        <div className="min-w-0">
                          <div className="font-mono text-slate-200 truncate">{file.name}</div>
                          <div className="text-[11px] font-mono tabular-nums text-slate-500">
                            {formatBytes(file.size)} · {file.syncedTo9p ? 'Live in 9p /mnt/ipad' : 'Queued for next boot / FAT16'}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleDownloadFile(file)}
                            title="Download to iPad"
                            className="h-8 w-8 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700 flex items-center justify-center"
                          >
                            <Download className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onDeleteSharedFile(file.name, 'ipad')}
                            title="Remove file"
                            className="h-8 w-8 rounded bg-slate-900 hover:bg-red-900/60 text-slate-400 hover:text-red-200 border border-slate-700 flex items-center justify-center"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between gap-2 text-[11px] text-slate-400">
                <span>Manual mount command (9p with automatic /dev/sda1 fallback):</span>
                <button
                  type="button"
                  onClick={() => void handleCopy('mount9p', `${mount9pOneLiner}\n# or FAT16 only:\n${mountDiskOneLiner}`)}
                  className="h-7 px-2.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 inline-flex items-center gap-1"
                >
                  {copiedKey === 'mount9p' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  <span>{copiedKey === 'mount9p' ? 'Copied' : 'Copy Mount Cmd'}</span>
                </button>
              </div>
            </div>
          )}

          {/* TAB 3: WEB SERVER STUDIO + LIVE PREVIEW */}
          {tab === 'web' && (
            <div className="space-y-4">
              {/* Server Controls Bar */}
              <div className="p-3.5 rounded-md bg-slate-950 border border-slate-800 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-1 p-1 bg-slate-900 rounded border border-slate-800">
                    {(
                      [
                        { id: 'busybox', label: 'BusyBox httpd' },
                        { id: 'python3', label: 'Python 3' },
                        { id: 'php', label: 'PHP' },
                      ] as const
                    ).map((eng) => (
                      <button
                        key={eng.id}
                        type="button"
                        onClick={() => onWebServerEngineChange(eng.id)}
                        className={`h-7 px-2.5 rounded text-[11px] font-medium transition-colors whitespace-nowrap ${
                          webServerEngine === eng.id
                            ? 'bg-sky-600 text-white'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {eng.label}
                      </button>
                    ))}
                  </div>

                  <label className="flex items-center gap-1.5 text-[11px] text-slate-400">
                    <span>Port</span>
                    <input
                      type="number"
                      min={1024}
                      max={65535}
                      value={webServerPort}
                      onChange={(e) => onWebServerPortChange(Number(e.target.value) || 8080)}
                      onFocus={() => onInputFocusChange(true)}
                      onBlur={() => onInputFocusChange(false)}
                      className="w-20 h-8 px-2 rounded bg-slate-900 border border-slate-700 font-mono tabular-nums text-slate-100 focus:outline-none focus:border-sky-500"
                    />
                  </label>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={!isRunning}
                    onClick={() => {
                      onRunGuestCommand(
                        buildWebServerOneLiner(webServerEngine, webServerPort),
                        `Start ${webServerEngine} web server on port ${webServerPort}`
                      );
                      onClose();
                    }}
                    className="h-8 px-3 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white font-medium inline-flex items-center gap-1.5 whitespace-nowrap disabled:opacity-40"
                  >
                    <Play className="w-3.5 h-3.5" />
                    <span>Start Server in Puppy</span>
                  </button>
                  <button
                    type="button"
                    disabled={!isRunning}
                    onClick={() => {
                      onRunGuestCommand(
                        buildOpenGuestBrowserOneLiner(webServerPort),
                        `Open http://127.0.0.1:${webServerPort} in Puppy browser`
                      );
                      onClose();
                    }}
                    className="h-8 px-3 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-medium inline-flex items-center gap-1.5 whitespace-nowrap disabled:opacity-40"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>Open in Puppy Browser</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleCopy('webcmd', webOneLiner)}
                    className="h-8 px-2.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 inline-flex items-center gap-1"
                  >
                    {copiedKey === 'webcmd' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedKey === 'webcmd' ? 'Copied' : 'Cmd'}</span>
                  </button>
                </div>
              </div>

              {/* Split Workspace: Web Root Editor + Live Sandboxed iPad Browser Preview */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Left: Document Root Editor */}
                <div className="rounded-md bg-slate-950 border border-slate-800 flex flex-col overflow-hidden min-h-[340px]">
                  <div className="px-3 py-2 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-slate-200 font-medium">
                      <FileCode2 className="w-3.5 h-3.5 text-sky-400" />
                      <span>/mnt/ipad/www</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <input
                        ref={webInputRef}
                        type="file"
                        multiple
                        onChange={(e) => {
                          if (e.target.files?.length) {
                            void onImportHostFiles(e.target.files, 'www');
                          }
                          e.target.value = '';
                        }}
                        className="hidden"
                      />
                      <button
                        type="button"
                        onClick={() => webInputRef.current?.click()}
                        className="h-7 px-2.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 inline-flex items-center gap-1 text-[11px]"
                      >
                        <FolderUp className="w-3 h-3 text-sky-400" />
                        <span>Import Assets</span>
                      </button>
                      <button
                        type="button"
                        disabled={!editorDirty || !selectedFileObj}
                        onClick={async () => {
                          if (!selectedFileObj) return;
                          await onSaveWebFile(selectedFileObj.name, editorDraft);
                          setEditorDirty(false);
                          setPreviewNonce((n) => n + 1);
                        }}
                        className="h-7 px-2.5 rounded bg-sky-600 hover:bg-sky-500 text-white font-medium text-[11px] disabled:opacity-40"
                      >
                        Save &amp; Sync
                      </button>
                    </div>
                  </div>

                  {/* File Tabs + New File Input */}
                  <div className="px-2.5 py-2 border-b border-slate-800 flex flex-wrap items-center gap-1.5 bg-slate-900/50">
                    {wwwFiles.map((f) => (
                      <div key={f.name} className="inline-flex items-center rounded bg-slate-900 border border-slate-800 overflow-hidden">
                        <button
                          type="button"
                          onClick={() => setSelectedWebFile(f.name)}
                          className={`h-7 px-2.5 font-mono text-[11px] transition-colors ${
                            selectedWebFile === f.name
                              ? 'bg-sky-600 text-white'
                              : 'text-slate-300 hover:text-white'
                          }`}
                        >
                          {f.name}
                        </button>
                        {wwwFiles.length > 1 && (
                          <button
                            type="button"
                            onClick={() => onDeleteSharedFile(f.name, 'www')}
                            aria-label={`Delete ${f.name}`}
                            className="h-7 px-1.5 text-slate-500 hover:text-red-300"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    ))}
                    <div className="inline-flex items-center gap-1 ml-auto">
                      <input
                        type="text"
                        value={newFileName}
                        onChange={(e) => setNewFileName(e.target.value)}
                        onFocus={() => onInputFocusChange(true)}
                        onBlur={() => onInputFocusChange(false)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void handleCreateNewWebFile();
                        }}
                        placeholder="page.html"
                        className="w-24 h-7 px-2 rounded bg-slate-900 border border-slate-700 font-mono text-[11px] text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-sky-500"
                      />
                      <button
                        type="button"
                        onClick={() => void handleCreateNewWebFile()}
                        aria-label="Create file in web root"
                        className="h-7 w-7 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 flex items-center justify-center"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Code Textarea */}
                  {isSelectedTextEditable ? (
                    <textarea
                      value={editorDraft}
                      onChange={(e) => {
                        setEditorDraft(e.target.value);
                        setEditorDirty(true);
                      }}
                      onFocus={() => onInputFocusChange(true)}
                      onBlur={() => onInputFocusChange(false)}
                      spellCheck={false}
                      className="flex-1 w-full p-3 bg-slate-950 text-slate-100 font-mono text-[11px] leading-relaxed resize-none focus:outline-none min-h-[240px]"
                    />
                  ) : (
                    <div className="flex-1 flex flex-col items-center justify-center p-6 text-slate-500 gap-2">
                      <span className="font-mono text-slate-300">{selectedFileObj?.name}</span>
                      <span>
                        Binary web asset ({selectedFileObj ? formatBytes(selectedFileObj.size) : '0 B'}) — served directly from /mnt/ipad/www
                      </span>
                    </div>
                  )}
                </div>

                {/* Right: Live Host Browser Preview */}
                <div className="rounded-md bg-slate-950 border border-slate-800 flex flex-col overflow-hidden min-h-[340px]">
                  <div className="px-3 py-2 border-b border-slate-800 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0 font-mono text-[11px] text-slate-300 truncate">
                      <Globe className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      <span className="truncate">
                        http://127.0.0.1:{webServerPort}/{previewEntry}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <select
                        value={previewEntry}
                        onChange={(e) => setPreviewEntry(e.target.value)}
                        aria-label="Preview HTML entry file"
                        className="h-7 px-1.5 rounded bg-slate-900 border border-slate-700 font-mono text-[11px] text-slate-200"
                      >
                        {wwwFiles
                          .filter((f) => /\.html?$/i.test(f.name))
                          .map((f) => (
                            <option key={f.name} value={f.name}>
                              {f.name}
                            </option>
                          ))}
                      </select>
                      <button
                        type="button"
                        onClick={async () => {
                          if (isRunning) await onPullFromVm9p('www');
                          setPreviewNonce((n) => n + 1);
                        }}
                        className="h-7 px-2.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 inline-flex items-center gap-1 text-[11px]"
                      >
                        <RefreshCw className="w-3 h-3" />
                        <span>Refresh from VM</span>
                      </button>
                    </div>
                  </div>
                  <iframe
                    key={previewNonce}
                    title="Puppy Linux Web Server Live Preview"
                    sandbox="allow-scripts"
                    srcDoc={previewSrcDoc}
                    className="flex-1 w-full bg-[#0b1120] border-0 min-h-[280px]"
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
