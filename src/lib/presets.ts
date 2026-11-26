import type { BootDevice, DownloadProgress, OSPreset } from '../types/v86';

export const V86_ASSETS = {
  libUrl: 'https://cdn.jsdelivr.net/npm/v86@latest/build/libv86.js',
  wasmUrl: 'https://cdn.jsdelivr.net/npm/v86@latest/build/v86.wasm',
  biosUrl: 'https://cdn.jsdelivr.net/gh/copy/v86@master/bios/seabios.bin',
  vgaBiosUrl: 'https://cdn.jsdelivr.net/gh/copy/v86@master/bios/vgabios.bin',
} as const;

// Exact SeaBIOS CMOS boot order constants from v86 src/rtc.js
export const BOOT_ORDER: Record<BootDevice, number> = {
  cdrom: 0x123, // CD, Floppy, HD
  hda: 0x312, // HD, CD, Floppy
  fda: 0x321, // Floppy, CD, HD
};

// Tuned for Apple M3 iPad Air (8 GB unified RAM; v86 wasm supports up to 2 GB guest RAM)
export const RAM_OPTIONS_MB = [256, 512, 1024, 1536, 2048] as const;
export const VRAM_OPTIONS_MB = [8, 16] as const;

export const OS_PRESETS: OSPreset[] = [
  {
    id: 'archlinux',
    name: 'Arch Linux (Full Rolling)',
    subtitle: '9p rootfs · GCC, Python 3, Vim, Xorg · 14.8 MB instant state',
    badgeText: 'Most Advanced',
    kind: 'state-9p',
    url: 'https://i.copy.sh/arch_state-v3.bin.zst',
    size: 15493096,
    device: 'hda',
    recommendedRamMb: 512,
    recommendedVramMb: 8,
    graphical: true,
    filesystemBaseUrl: 'https://i.copy.sh/arch/',
    netDeviceType: 'virtio',
    bootHint: 'Instant Arch Linux shell ready. Run "startx" for graphical X11 or use gcc, python3, vim.',
  },
  {
    id: 'slitaz',
    name: 'SliTaz Rolling 2024',
    subtitle: 'Full Openbox X11 desktop · PCManFM, Browser, tazpkg · 54.0 MB',
    badgeText: 'Modern X11 GUI',
    kind: 'disk',
    url: 'https://i.copy.sh/slitaz-rolling-2024.iso',
    size: 56573952,
    device: 'hda',
    recommendedRamMb: 512,
    recommendedVramMb: 16,
    graphical: true,
    bootHint: 'Press Enter at the SliTaz boot menu to launch the full 2024 Openbox graphical desktop.',
  },
  {
    id: 'buildroot6',
    name: 'Buildroot Linux 6.8',
    subtitle: 'Modern Linux 6.8 kernel · 9p filesystem · 9.6 MB',
    badgeText: 'Kernel 6.8',
    kind: 'bzimage',
    url: 'https://i.copy.sh/buildroot-bzimage68.bin',
    size: 10068480,
    device: 'hda',
    recommendedRamMb: 512,
    recommendedVramMb: 8,
    graphical: false,
    cmdline: 'tsc=reliable mitigations=off random.trust_cpu=on',
    bootHint: 'Modern Linux 6.8 kernel with rapid direct bzImage boot.',
  },
  {
    id: 'tinycore',
    name: 'Tiny Core Linux 11',
    subtitle: 'X11/FLTK graphical desktop · 19.0 MB',
    kind: 'disk',
    url: 'https://i.copy.sh/TinyCore-11.0.iso',
    size: 19922944,
    device: 'hda',
    recommendedRamMb: 256,
    recommendedVramMb: 8,
    graphical: true,
  },
  {
    id: 'dsl',
    name: 'Damn Small Linux 4.11',
    subtitle: 'Fluxbox X11 desktop · 50.4 MB',
    kind: 'disk',
    url: 'https://i.copy.sh/dsl-4.11.rc2.iso',
    size: 52824064,
    device: 'cdrom',
    recommendedRamMb: 256,
    recommendedVramMb: 8,
    graphical: true,
    bootHint: 'Press Enter at the DSL boot: prompt (or wait a few seconds) to enter the Fluxbox X11 desktop.',
  },
  {
    id: 'kolibri',
    name: 'KolibriOS',
    subtitle: 'Instant-boot assembly GUI · 1.4 MB',
    kind: 'disk',
    url: 'https://builds.kolibrios.org/en_US/data/data/kolibri.img',
    size: 1474560,
    device: 'fda',
    recommendedRamMb: 256,
    recommendedVramMb: 8,
    graphical: true,
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

export async function fetchBinaryWithProgress(
  url: string,
  options: {
    expectedSize?: number;
    signal?: AbortSignal;
    onProgress?: (progress: DownloadProgress) => void;
  } = {}
): Promise<ArrayBuffer> {
  const fileName = url.split('/').pop()?.split('?')[0] || 'image';

  const response = await fetch(url, {
    method: 'GET',
    mode: 'cors',
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    signal: options.signal,
  });

  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status} while downloading ${fileName}. The host may block direct downloads — download the ISO locally and use "Load Local ISO".`
    );
  }

  const contentType = response.headers.get('content-type') || '';
  if (contentType.toLowerCase().includes('text/html')) {
    throw new Error(
      `Server returned an HTML page instead of a binary image for ${fileName}. Download the ISO locally and use "Load Local ISO".`
    );
  }

  const headerLen = Number(response.headers.get('content-length') || 0);
  const total = headerLen > 0 ? headerLen : (options.expectedSize ?? 0);

  if (!response.body) {
    const buffer = await response.arrayBuffer();
    options.onProgress?.({
      fileName,
      loaded: buffer.byteLength,
      total: buffer.byteLength,
      percent: 100,
    });
    return buffer;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      loaded += value.byteLength;
      options.onProgress?.({
        fileName,
        loaded,
        total,
        percent: total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : null,
      });
    }
  }

  const merged = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return merged.buffer;
}
