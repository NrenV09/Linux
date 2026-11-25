export type EmulatorStatus = 'stopped' | 'loading' | 'running' | 'paused' | 'error';

export type BootDevice = 'cdrom' | 'hda' | 'fda';

export type PresetKind = 'disk' | 'bzimage' | 'state-9p' | 'puppy-direct';

export interface PuppyDirectBootParams {
  vmlinuzFile: File;
  initrdFile: File;
  isoFile: File;
  memoryMb: number;
  vramMb: number;
  cmdline: string;
  netDeviceType: 'ne2k' | 'virtio';
  networkRelayUrl: string;
}

export interface OSPreset {
  id: string;
  name: string;
  subtitle: string;
  badgeText?: string;
  kind: PresetKind;
  url: string;
  size: number;
  device: BootDevice;
  recommendedRamMb: number;
  recommendedVramMb?: number;
  graphical: boolean;
  cmdline?: string;
  filesystemBaseUrl?: string;
  netDeviceType?: 'virtio' | 'ne2k';
  bootHint?: string;
}

export interface DownloadProgress {
  fileName: string;
  loaded: number;
  total: number;
  percent: number | null;
}

export interface SavedSnapshotMeta {
  id: string;
  name: string;
  presetName: string;
  memoryMb: number;
  byteLength: number;
  savedAt: number;
}

export interface SavedSnapshotRecord extends SavedSnapshotMeta {
  data: ArrayBuffer;
}

export interface V86ImageSource {
  url?: string;
  buffer?: ArrayBuffer | File;
  size?: number;
  async?: boolean;
  fixed_chunk_size?: number;
  use_parts?: boolean;
}

export interface V86Config {
  wasm_path: string;
  memory_size: number;
  vga_memory_size: number;
  screen_container: HTMLElement;
  bios: V86ImageSource;
  vga_bios: V86ImageSource;
  cdrom?: V86ImageSource;
  hda?: V86ImageSource;
  fda?: V86ImageSource;
  bzimage?: V86ImageSource;
  initrd?: V86ImageSource;
  cmdline?: string;
  filesystem?: {
    baseurl?: string;
    basefs?: string | { url: string; size?: number };
  };
  initial_state?: V86ImageSource;
  boot_order?: number;
  autostart?: boolean;
  acpi?: boolean;
  disable_jit?: boolean;
  disable_mouse?: boolean;
  network_relay_url?: string;
  net_device?: {
    type?: 'virtio' | 'ne2k';
    relay_url?: string;
  };
  preserve_mac_from_state_image?: boolean;
}

export interface V86Bus {
  send: (name: string, data?: unknown) => void;
}

export interface V86Instance {
  bus?: V86Bus;
  run: () => Promise<void> | void;
  stop: () => Promise<void> | void;
  destroy: () => Promise<void> | void;
  restart: () => void;
  is_running: () => boolean;
  save_state: () => Promise<ArrayBuffer>;
  restore_state: (state: ArrayBuffer) => Promise<void>;
  get_instruction_counter: () => number;
  lock_mouse: () => Promise<void> | void;
  mouse_set_enabled: (enabled: boolean) => void;
  keyboard_set_enabled: (enabled: boolean) => void;
  keyboard_send_scancodes: (codes: number[], delay?: number) => Promise<void> | void;
  keyboard_send_text: (text: string, delay?: number) => Promise<void> | void;
  screen_set_scale: (sx: number, sy: number) => void;
  screen_make_screenshot: () => HTMLImageElement;
  add_listener: (event: string, listener: (...args: unknown[]) => void) => void;
  remove_listener: (event: string, listener: (...args: unknown[]) => void) => void;
}

export interface V86Constructor {
  new (config: V86Config): V86Instance;
}

declare global {
  interface Window {
    V86?: V86Constructor;
  }
}
