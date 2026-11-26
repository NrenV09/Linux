import type { V86Instance } from '../types/v86';

export interface ExtractedPuppyIso {
  vmlinuzName: string;
  vmlinuzBuffer: ArrayBuffer;
  initrdName: string;
  initrdBuffer: ArrayBuffer;
  sfsFiles: string[];
}

export const FAST_PUPPY_CMDLINE =
  'pfix=ram,nocopy pmedia=cd acpi=off tsc=reliable mitigations=off';

interface IsoDirEntry {
  name: string;
  lowerName: string;
  lba: number;
  size: number;
  isDir: boolean;
}

const SECTOR_SIZE = 2048;

function decodeAscii(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += String.fromCharCode(bytes[i]);
  }
  return out;
}

function decodeUtf16Be(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    const code = (bytes[i] << 8) | bytes[i + 1];
    if (code === 0) break;
    out += String.fromCharCode(code);
  }
  return out;
}

function normalizeIsoName(raw: string): string {
  let name = raw;
  const semi = name.indexOf(';');
  if (semi >= 0) name = name.slice(0, semi);
  if (name.endsWith('.')) name = name.slice(0, -1);
  return name;
}

function extractRockRidgeName(
  buf: Uint8Array,
  suStart: number,
  recordEnd: number
): string | null {
  let pos = suStart;
  let fullName = '';
  while (pos + 4 <= recordEnd) {
    const sig1 = buf[pos];
    const sig2 = buf[pos + 1];
    const entryLen = buf[pos + 2];
    if (entryLen < 4 || pos + entryLen > recordEnd) break;
    // 'NM' = 0x4E, 0x4D (POSIX Alternate Name)
    if (sig1 === 0x4e && sig2 === 0x4d && entryLen > 5) {
      const flags = buf[pos + 4];
      // Skip special '.', '..' flags (bits 1, 2)
      if ((flags & 0x06) === 0) {
        const nameBytes = buf.subarray(pos + 5, pos + entryLen);
        fullName += new TextDecoder('utf-8', { fatal: false }).decode(nameBytes);
      }
      if ((flags & 0x01) === 0 && fullName.length > 0) {
        return fullName;
      }
    }
    pos += entryLen;
  }
  return fullName.length > 0 ? fullName : null;
}

function parseIsoDirectory(
  buf: Uint8Array,
  isJoliet: boolean
): IsoDirEntry[] {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const entries: IsoDirEntry[] = [];
  let pos = 0;

  while (pos < buf.byteLength) {
    const len = buf[pos];
    if (len === 0) {
      // Advance to next 2048-byte sector boundary
      const nextSector = (Math.floor(pos / SECTOR_SIZE) + 1) * SECTOR_SIZE;
      if (nextSector <= pos) break;
      pos = nextSector;
      continue;
    }
    if (len < 34 || pos + len > buf.byteLength) break;

    const lba = view.getUint32(pos + 2, true);
    const size = view.getUint32(pos + 10, true);
    const flags = buf[pos + 25];
    const isDir = (flags & 0x02) !== 0;
    const nameLen = buf[pos + 32];

    if (nameLen > 0 && pos + 33 + nameLen <= pos + len) {
      const nameBytes = buf.subarray(pos + 33, pos + 33 + nameLen);
      // Skip '.' (0x00) and '..' (0x01)
      if (!(nameLen === 1 && (nameBytes[0] === 0 || nameBytes[0] === 1))) {
        let name: string;
        if (isJoliet) {
          name = normalizeIsoName(decodeUtf16Be(nameBytes));
        } else {
          const suStart = pos + 33 + nameLen + (nameLen % 2 === 0 ? 1 : 0);
          const rrName = extractRockRidgeName(buf, suStart, pos + len);
          name = rrName ?? normalizeIsoName(decodeAscii(nameBytes));
        }
        if (name) {
          entries.push({
            name,
            lowerName: name.toLowerCase(),
            lba,
            size,
            isDir,
          });
        }
      }
    }

    pos += len;
  }

  return entries;
}

async function readIsoDirectoryEntries(
  file: File,
  lba: number,
  size: number,
  isJoliet: boolean
): Promise<IsoDirEntry[]> {
  const offset = lba * SECTOR_SIZE;
  const clampedSize = Math.min(size, 512 * 1024); // cap directory scan at 512 KB
  if (offset < 0 || offset + clampedSize > file.size || clampedSize <= 0) {
    return [];
  }
  const ab = await file.slice(offset, offset + clampedSize).arrayBuffer();
  return parseIsoDirectory(new Uint8Array(ab), isJoliet);
}

/**
 * Inspects any local .iso via ISO-9660 Primary/Joliet volume descriptors (< 25ms)
 * and extracts vmlinuz + initrd.gz automatically when a Puppy Linux ISO is detected
 * (e.g. NoblePup32, BookwormPup32, S15Pup32, FossaPup, etc.).
 */
export async function inspectAndExtractPuppyIso(
  file: File
): Promise<ExtractedPuppyIso | null> {
  try {
    if (file.size < 20 * SECTOR_SIZE) return null;

    // Read Volume Descriptors (sectors 16..31 = 32 KB)
    const vdSlice = await file.slice(16 * SECTOR_SIZE, 32 * SECTOR_SIZE).arrayBuffer();
    const vdBytes = new Uint8Array(vdSlice);
    const vdView = new DataView(vdSlice);

    let pvdRoot: { lba: number; size: number } | null = null;
    let jolietRoot: { lba: number; size: number } | null = null;

    for (let s = 0; s < 16; s++) {
      const off = s * SECTOR_SIZE;
      const type = vdBytes[off];
      const magic = decodeAscii(vdBytes.subarray(off + 1, off + 6));
      if (magic !== 'CD001') break;

      if (type === 1) {
        const rootLba = vdView.getUint32(off + 156 + 2, true);
        const rootSize = vdView.getUint32(off + 156 + 10, true);
        pvdRoot = { lba: rootLba, size: rootSize };
      } else if (type === 2) {
        // Joliet UCS-2 escape sequences: %/@, %/C, %/E at offset 88..90
        const esc0 = vdBytes[off + 88];
        const esc1 = vdBytes[off + 89];
        const esc2 = vdBytes[off + 90];
        if (esc0 === 0x25 && esc1 === 0x2f && (esc2 === 0x40 || esc2 === 0x43 || esc2 === 0x45)) {
          const rootLba = vdView.getUint32(off + 156 + 2, true);
          const rootSize = vdView.getUint32(off + 156 + 10, true);
          jolietRoot = { lba: rootLba, size: rootSize };
        }
      } else if (type === 255) {
        break;
      }
    }

    const rootInfo = pvdRoot ?? jolietRoot;
    if (!rootInfo) return null;

    // Prefer PVD (with Rock Ridge support), fall back to Joliet if PVD has no matches
    let rootEntries = await readIsoDirectoryEntries(
      file,
      rootInfo.lba,
      rootInfo.size,
      rootInfo === jolietRoot
    );
    if (rootEntries.length === 0 && jolietRoot && rootInfo !== jolietRoot) {
      rootEntries = await readIsoDirectoryEntries(file, jolietRoot.lba, jolietRoot.size, true);
    }

    const allCandidates: IsoDirEntry[] = [...rootEntries];

    // Also inspect /boot or /puppy depth-1 subdirectories if present
    for (const dir of rootEntries) {
      if (dir.isDir && (dir.lowerName === 'boot' || dir.lowerName === 'puppy')) {
        const sub = await readIsoDirectoryEntries(
          file,
          dir.lba,
          dir.size,
          rootInfo === jolietRoot
        );
        allCandidates.push(...sub);
      }
    }

    const sfsFiles = allCandidates
      .filter((e) => !e.isDir && e.lowerName.endsWith('.sfs'))
      .map((e) => e.name);

    const isPuppyNamed = /pup|dpup|upup|s15pup|bionic|fossa|noble|bookworm|vanilla/i.test(
      file.name
    );
    const hasPuppySfs =
      sfsFiles.some((n) => /(puppy|zdrv|fdrv|adrv|ydrv|upup|dpup)/i.test(n)) ||
      (sfsFiles.length > 0 && isPuppyNamed);

    if (!hasPuppySfs) return null;

    const kernelEntry = allCandidates.find(
      (e) =>
        !e.isDir &&
        (e.lowerName === 'vmlinuz' || e.lowerName === 'bzimage') &&
        e.size >= 512 * 1024 &&
        e.size <= 32 * 1024 * 1024
    );

    const initrdEntry = allCandidates.find(
      (e) =>
        !e.isDir &&
        (e.lowerName === 'initrd.gz' ||
          e.lowerName === 'initrd.xz' ||
          e.lowerName === 'initrd.zst' ||
          e.lowerName === 'initrd.lz' ||
          e.lowerName === 'initrd') &&
        e.size >= 32 * 1024 &&
        e.size <= 64 * 1024 * 1024
    );

    if (!kernelEntry || !initrdEntry) return null;

    const kOff = kernelEntry.lba * SECTOR_SIZE;
    const iOff = initrdEntry.lba * SECTOR_SIZE;
    if (kOff + kernelEntry.size > file.size || iOff + initrdEntry.size > file.size) {
      return null;
    }

    const [vmlinuzBuffer, initrdBuffer] = await Promise.all([
      file.slice(kOff, kOff + kernelEntry.size).arrayBuffer(),
      file.slice(iOff, iOff + initrdEntry.size).arrayBuffer(),
    ]);

    return {
      vmlinuzName: kernelEntry.name,
      vmlinuzBuffer,
      initrdName: initrdEntry.name,
      initrdBuffer,
      sfsFiles,
    };
  } catch {
    return null;
  }
}

interface V86AsyncFileBufferLike {
  file?: File;
  byteLength?: number;
  get?: (offset: number, len: number, cb: (data: Uint8Array) => void) => void;
  __fastReadAheadPatched?: boolean;
}

/**
 * Replaces v86's uncached AsyncFileBuffer.get() (which creates a new FileReader per 2KB–32KB read)
 * with a bounded 32 MB LRU cache of 2 MB aligned read-ahead chunks.
 * Cuts iPadOS File IPC stalls during Puppy Linux SquashFS boot by ~60x while keeping WebKit RAM flat.
 */
export function attachFastIsoReadAheadCache(
  emulator: V86Instance,
  file: File,
  chunkSizeBytes = 2 * 1024 * 1024,
  maxCachedChunks = 16
): boolean {
  const cdromBuffer = emulator.v86?.cpu?.devices?.cdrom?.buffer as
    | V86AsyncFileBufferLike
    | undefined;
  if (!cdromBuffer || typeof cdromBuffer.get !== 'function') {
    return false;
  }
  if (cdromBuffer.__fastReadAheadPatched) {
    return true;
  }
  // Only patch AsyncFileBuffer instances (those backed by a File, not full-RAM ArrayBuffers)
  if (!cdromBuffer.file) {
    return false;
  }

  const origGet = cdromBuffer.get.bind(cdromBuffer);
  const cache = new Map<number, Uint8Array>();
  const inflight = new Map<number, Promise<Uint8Array>>();
  const totalSize = file.size;

  const getChunkSync = (chunkIndex: number): Uint8Array | undefined => {
    const hit = cache.get(chunkIndex);
    if (hit) {
      // Refresh LRU position
      cache.delete(chunkIndex);
      cache.set(chunkIndex, hit);
    }
    return hit;
  };

  const loadChunk = (chunkIndex: number): Promise<Uint8Array> => {
    const cached = getChunkSync(chunkIndex);
    if (cached) return Promise.resolve(cached);

    const existing = inflight.get(chunkIndex);
    if (existing) return existing;

    const start = chunkIndex * chunkSizeBytes;
    const end = Math.min(totalSize, start + chunkSizeBytes);
    const promise = file
      .slice(start, end)
      .arrayBuffer()
      .then((ab) => {
        const bytes = new Uint8Array(ab);
        cache.set(chunkIndex, bytes);
        if (cache.size > maxCachedChunks) {
          const oldestKey = cache.keys().next().value;
          if (oldestKey !== undefined) {
            cache.delete(oldestKey);
          }
        }
        inflight.delete(chunkIndex);
        return bytes;
      })
      .catch((err) => {
        inflight.delete(chunkIndex);
        throw err;
      });

    inflight.set(chunkIndex, promise);
    return promise;
  };

  cdromBuffer.get = (offset: number, len: number, cb: (data: Uint8Array) => void) => {
    if (offset < 0 || len <= 0 || offset + len > totalSize) {
      origGet(offset, len, cb);
      return;
    }

    const startChunk = Math.floor(offset / chunkSizeBytes);
    const endChunk = Math.floor((offset + len - 1) / chunkSizeBytes);

    // Fast synchronous path: entire read fits in a single cached 2 MB chunk
    if (startChunk === endChunk) {
      const hit = getChunkSync(startChunk);
      if (hit) {
        const rel = offset - startChunk * chunkSizeBytes;
        cb(hit.subarray(rel, rel + len));
        return;
      }
      loadChunk(startChunk)
        .then((chunk) => {
          const rel = offset - startChunk * chunkSizeBytes;
          cb(chunk.subarray(rel, rel + len));
        })
        .catch(() => origGet(offset, len, cb));
      return;
    }

    // Multi-chunk read spanning a 2 MB boundary
    const promises: Promise<Uint8Array>[] = [];
    for (let c = startChunk; c <= endChunk; c++) {
      promises.push(loadChunk(c));
    }
    Promise.all(promises)
      .then((chunks) => {
        const out = new Uint8Array(len);
        let written = 0;
        for (let i = 0; i < chunks.length; i++) {
          const cIdx = startChunk + i;
          const chunkStart = cIdx * chunkSizeBytes;
          const copyStart = Math.max(offset, chunkStart) - chunkStart;
          const copyEnd = Math.min(offset + len, chunkStart + chunks[i].byteLength) - chunkStart;
          out.set(chunks[i].subarray(copyStart, copyEnd), written);
          written += copyEnd - copyStart;
        }
        cb(out);
      })
      .catch(() => origGet(offset, len, cb));
  };

  cdromBuffer.__fastReadAheadPatched = true;
  return true;
}
