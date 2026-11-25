import type { OSPreset } from '../types/v86';

export const V86_ASSETS = {
  libUrl: 'https://cdn.jsdelivr.net/npm/v86@latest/build/libv86.js',
  wasmUrl: 'https://cdn.jsdelivr.net/npm/v86@latest/build/v86.wasm',
  biosUrl: 'https://cdn.jsdelivr.net/gh/copy/v86@master/bios/seabios.bin',
  vgaBiosUrl: 'https://cdn.jsdelivr.net/gh/copy/v86@master/bios/vgabios.bin',
} as const;

export const RAM_OPTIONS_MB = [256, 384, 512] as const;

export const OS_PRESETS: OSPreset[] = [
  {
    id: 'tinycore',
    name: 'Tiny Core Linux 11',
    subtitle: 'X11/FLTK graphical desktop · 19.0 MB',
    url: 'https://i.copy.sh/TinyCore-11.0.iso',
    size: 19922944,
    device: 'hda',
    recommendedRamMb: 256,
    graphical: true,
  },
  {
    id: 'dsl',
    name: 'Damn Small Linux 4.11',
    subtitle: 'Fluxbox X11 desktop · 50.4 MB',
    url: 'https://i.copy.sh/dsl-4.11.rc2.iso',
    size: 52824064,
    device: 'cdrom',
    recommendedRamMb: 256,
    graphical: true,
  },
  {
    id: 'kolibri',
    name: 'KolibriOS',
    subtitle: 'Instant-boot assembly GUI · 1.4 MB',
    url: 'https://i.copy.sh/kolibri.img',
    size: 1474560,
    device: 'fda',
    recommendedRamMb: 256,
    graphical: true,
  },
  {
    id: 'linux4',
    name: 'Minimal Linux 4',
    subtitle: 'Fast BusyBox console · 7.4 MB',
    url: 'https://i.copy.sh/linux4.iso',
    size: 7731200,
    device: 'cdrom',
    recommendedRamMb: 256,
    graphical: false,
  },
];

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}
