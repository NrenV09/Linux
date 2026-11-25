import type { SharedHostFile, V86Instance, WebServerEngine } from '../types/v86';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: false });

export function encodeUtf8(text: string): Uint8Array {
  return encoder.encode(text);
}

export function decodeUtf8(data: Uint8Array): string {
  return decoder.decode(data);
}

export function sanitizeGuestFilename(name: string): string {
  const base = name.split(/[/\\]/).pop() || 'file.bin';
  const cleaned = base.replace(/[^a-zA-Z0-9._ -]/g, '_').trim();
  return cleaned.length > 0 ? cleaned.slice(0, 120) : 'file.bin';
}

export function guessMimeType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    html: 'text/html',
    htm: 'text/html',
    css: 'text/css',
    js: 'application/javascript',
    mjs: 'application/javascript',
    json: 'application/json',
    svg: 'image/svg+xml',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    ico: 'image/x-icon',
    txt: 'text/plain',
    md: 'text/markdown',
    sh: 'text/x-shellscript',
    py: 'text/x-python',
    pdf: 'application/pdf',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    mp4: 'video/mp4',
  };
  return map[ext] || 'application/octet-stream';
}

// --- Guest Shell Scripts & One-Liners (Works across BookwormPup32, NoblePup32, BionicPup, SliTaz, Arch, Alpine) ---

export function buildAutoNetworkScript(): string {
  return `#!/bin/sh
# Automatic Puppy Linux / v86 Network Configurator (ne2k-pci & virtio-net)
echo "[net-auto] Loading virtual NIC kernel modules..."
modprobe 8390 2>/dev/null
modprobe ne2k-pci 2>/dev/null
modprobe virtio_pci 2>/dev/null
modprobe virtio_net 2>/dev/null

IFACE=""
for cand in eth0 enp0s3 enp0s4 ens3 ens4; do
  if [ -d "/sys/class/net/$cand" ]; then
    IFACE="$cand"
    break
  fi
done
if [ -z "$IFACE" ]; then
  IFACE=$(ls /sys/class/net 2>/dev/null | grep -v '^lo$' | head -n 1)
fi

if [ -z "$IFACE" ]; then
  echo "[net-auto] No ethernet interface found yet. Check dmesg | grep -iE 'ne2k|virtio|eth'."
  exit 1
fi

echo "[net-auto] Bringing up $IFACE..."
ip link set "$IFACE" up 2>/dev/null || ifconfig "$IFACE" up 2>/dev/null

# Attempt DHCP first (works with v86 fetch proxy 192.168.86.x and wss relay)
if command -v udhcpc >/dev/null 2>&1; then
  udhcpc -i "$IFACE" -n -q -t 4 2>/dev/null
elif command -v dhcpcd >/dev/null 2>&1; then
  dhcpcd -4 -t 6 "$IFACE" 2>/dev/null
elif command -v dhclient >/dev/null 2>&1; then
  dhclient -1 "$IFACE" 2>/dev/null
fi

# Fallback static config matching v86 built-in fetch relay subnet (192.168.86.0/24)
HAS_IP=$(ip -4 addr show "$IFACE" 2>/dev/null | grep 'inet ' || ifconfig "$IFACE" 2>/dev/null | grep 'inet ')
if [ -z "$HAS_IP" ]; then
  echo "[net-auto] Applying v86 fetch-relay fallback IP (192.168.86.100/24)..."
  ip addr flush dev "$IFACE" 2>/dev/null
  ip addr add 192.168.86.100/24 dev "$IFACE" 2>/dev/null || ifconfig "$IFACE" 192.168.86.100 netmask 255.255.255.0 up
  ip route replace default via 192.168.86.1 dev "$IFACE" 2>/dev/null || route add default gw 192.168.86.1 "$IFACE" 2>/dev/null
  printf "nameserver 192.168.86.1\\nnameserver 1.1.1.1\\n" > /etc/resolv.conf
fi

echo "[net-auto] Active interface state:"
ip -4 addr show "$IFACE" 2>/dev/null || ifconfig "$IFACE"
`;
}

export function buildAutoNetworkOneLiner(): string {
  return (
    `sh -c 'modprobe 8390 2>/dev/null; modprobe ne2k-pci 2>/dev/null; modprobe virtio_net 2>/dev/null; ` +
    `I=$(ls /sys/class/net | grep -v "^lo$" | head -n1); [ -n "$I" ] && (` +
    `ip link set "$I" up 2>/dev/null || ifconfig "$I" up; ` +
    `(udhcpc -i "$I" -n -q -t 4 || dhcpcd -4 -t 5 "$I") 2>/dev/null || (` +
    `ifconfig "$I" 192.168.86.100 netmask 255.255.255.0 up; ` +
    `route add default gw 192.168.86.1 2>/dev/null || ip route replace default via 192.168.86.1; ` +
    `printf "nameserver 192.168.86.1\\nnameserver 1.1.1.1\\n" > /etc/resolv.conf); ` +
    `ip -4 addr show "$I" 2>/dev/null || ifconfig "$I")'\n`
  );
}

export function buildMount9pScript(): string {
  return `#!/bin/sh
# Mount live iPad shared folder (VirtIO 9p host9p) with automatic fallback to virtual FAT16 disk (/dev/sda)
mkdir -p /mnt/ipad
modprobe virtio_pci 2>/dev/null
modprobe 9pnet 2>/dev/null
modprobe 9pnet_virtio 2>/dev/null
modprobe 9p 2>/dev/null

if mount -t 9p -o trans=virtio,version=9p2000.L,cache=none host9p /mnt/ipad 2>/dev/null; then
  echo "[ipad-files] Mounted LIVE 9p share at /mnt/ipad"
elif mount -t 9p -o trans=virtio host9p /mnt/ipad 2>/dev/null; then
  echo "[ipad-files] Mounted LIVE 9p share at /mnt/ipad"
elif [ -b /dev/sda1 ] && mount -t vfat /dev/sda1 /mnt/ipad 2>/dev/null; then
  echo "[ipad-files] Mounted Virtual iPad Drive (/dev/sda1) at /mnt/ipad"
elif [ -b /dev/sda ] && mount -t vfat /dev/sda /mnt/ipad 2>/dev/null; then
  echo "[ipad-files] Mounted Virtual iPad Drive (/dev/sda) at /mnt/ipad"
elif [ -b /dev/sdb1 ] && mount -t vfat /dev/sdb1 /mnt/ipad 2>/dev/null; then
  echo "[ipad-files] Mounted Virtual iPad Drive (/dev/sdb1) at /mnt/ipad"
elif [ -b /dev/sdb ] && mount -t vfat /dev/sdb /mnt/ipad 2>/dev/null; then
  echo "[ipad-files] Mounted Virtual iPad Drive (/dev/sdb) at /mnt/ipad"
else
  echo "[ipad-files] Could not mount host9p or /dev/sda1. Check dmesg | tail -n 20."
  exit 1
fi

ls -la /mnt/ipad
`;
}

export function buildMount9pOneLiner(): string {
  return (
    `sh -c 'mkdir -p /mnt/ipad; modprobe 9pnet_virtio 2>/dev/null; modprobe 9p 2>/dev/null; ` +
    `mount -t 9p -o trans=virtio,version=9p2000.L,cache=none host9p /mnt/ipad 2>/dev/null || ` +
    `mount -t 9p -o trans=virtio host9p /mnt/ipad 2>/dev/null || ` +
    `mount /dev/sda1 /mnt/ipad 2>/dev/null || mount /dev/sda /mnt/ipad 2>/dev/null || mount /dev/sdb1 /mnt/ipad 2>/dev/null; ` +
    `ls -la /mnt/ipad'\n`
  );
}

export function buildMountDiskOneLiner(): string {
  return (
    `sh -c 'mkdir -p /mnt/ipad; (mount -t vfat /dev/sda1 /mnt/ipad || mount -t vfat /dev/sda /mnt/ipad || mount -t vfat /dev/sdb1 /mnt/ipad) 2>/dev/null; ls -la /mnt/ipad'\n`
  );
}

export function buildWebServerScript(engine: WebServerEngine, port: number): string {
  const safePort = Math.max(1024, Math.min(65535, Math.floor(port) || 8080));
  return `#!/bin/sh
# Start an HTTP web server inside Puppy Linux serving /mnt/ipad/www (or /root/www)
PORT=${safePort}
DOCROOT="/mnt/ipad/www"

if [ ! -d "$DOCROOT" ]; then
  mkdir -p /mnt/ipad
  modprobe 9pnet_virtio 2>/dev/null; modprobe 9p 2>/dev/null
  mount -t 9p -o trans=virtio,version=9p2000.L,cache=none host9p /mnt/ipad 2>/dev/null || \\
    mount -t vfat /dev/sda1 /mnt/ipad 2>/dev/null || \\
    mount -t vfat /dev/sda /mnt/ipad 2>/dev/null || \\
    mount -t vfat /dev/sdb1 /mnt/ipad 2>/dev/null
fi

if [ ! -d "$DOCROOT" ]; then
  DOCROOT="/root/www"
  mkdir -p "$DOCROOT"
fi

if [ ! -f "$DOCROOT/index.html" ]; then
  cat > "$DOCROOT/index.html" <<'EOF'
<!doctype html>
<html><head><meta charset="utf-8"><title>Puppy Linux Server</title></head>
<body style="font-family:sans-serif;padding:2rem;background:#0f172a;color:#e2e8f0">
<h1>Puppy Linux Web Server Active</h1>
<p>Serving files from $DOCROOT on port $PORT.</p>
</body></html>
EOF
fi

echo "[websrv] Starting ${engine} HTTP server at http://127.0.0.1:$PORT (root: $DOCROOT)"
${
  engine === 'python3'
    ? `if command -v python3 >/dev/null 2>&1; then
  exec python3 -m http.server "$PORT" --bind 0.0.0.0 --directory "$DOCROOT"
elif command -v busybox >/dev/null 2>&1; then
  exec busybox httpd -f -v -p "$PORT" -h "$DOCROOT"
fi`
    : engine === 'php'
      ? `if command -v php >/dev/null 2>&1; then
  exec php -S "0.0.0.0:$PORT" -t "$DOCROOT"
elif command -v busybox >/dev/null 2>&1; then
  exec busybox httpd -f -v -p "$PORT" -h "$DOCROOT"
fi`
      : `if command -v busybox >/dev/null 2>&1; then
  exec busybox httpd -f -v -p "$PORT" -h "$DOCROOT"
elif command -v python3 >/dev/null 2>&1; then
  exec python3 -m http.server "$PORT" --bind 0.0.0.0 --directory "$DOCROOT"
fi`
}
echo "[websrv] Neither busybox httpd, python3, nor php found in PATH."
`;
}

export function buildWebServerOneLiner(engine: WebServerEngine, port: number): string {
  const safePort = Math.max(1024, Math.min(65535, Math.floor(port) || 8080));
  const mountPrefix =
    `mkdir -p /mnt/ipad; modprobe 9pnet_virtio 2>/dev/null; modprobe 9p 2>/dev/null; ` +
    `mount -t 9p -o trans=virtio,version=9p2000.L,cache=none host9p /mnt/ipad 2>/dev/null || ` +
    `mount -t vfat /dev/sda1 /mnt/ipad 2>/dev/null || mount -t vfat /dev/sda /mnt/ipad 2>/dev/null || true; ` +
    `D=/mnt/ipad/www; [ -d "$D" ] || { D=/root/www; mkdir -p "$D"; }; ` +
    `echo "Serving $D on http://127.0.0.1:${safePort}"; `;

  if (engine === 'python3') {
    return `sh -c '${mountPrefix}python3 -m http.server ${safePort} --bind 0.0.0.0 --directory "$D" || busybox httpd -f -v -p ${safePort} -h "$D"'\n`;
  }
  if (engine === 'php') {
    return `sh -c '${mountPrefix}php -S 0.0.0.0:${safePort} -t "$D" || busybox httpd -f -v -p ${safePort} -h "$D"'\n`;
  }
  return `sh -c '${mountPrefix}busybox httpd -f -v -p ${safePort} -h "$D" || python3 -m http.server ${safePort} --bind 0.0.0.0 --directory "$D"'\n`;
}

export function buildOpenGuestBrowserOneLiner(port: number): string {
  const safePort = Math.max(1024, Math.min(65535, Math.floor(port) || 8080));
  return (
    `sh -c 'URL="http://127.0.0.1:${safePort}/"; ` +
    `(defaultbrowser "$URL" || palemoon "$URL" || firefox "$URL" || light "$URL" || dillo "$URL" || midori "$URL") >/dev/null 2>&1 & ` +
    `curl -sI "$URL" 2>/dev/null || wget -qO- "$URL" | head -n 12'\n`
  );
}

// --- Starter Web Server Files (Zero external requests, crisp offline-first design) ---

export function createDefaultWebFiles(): SharedHostFile[] {
  const now = Date.now();
  const indexHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Puppy Linux Web Server</title>
    <link rel="stylesheet" href="./style.css" />
  </head>
  <body>
    <main class="card">
      <div class="header">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="2" y="3" width="20" height="14" rx="2" />
          <line x1="8" y1="21" x2="16" y2="21" />
          <line x1="12" y1="17" x2="12" y2="21" />
        </svg>
        <h1>Puppy Linux HTTP Server</h1>
      </div>
      <p class="subtitle">
        Hosted inside WebAssembly Linux from <code>/mnt/ipad/www</code>. Edit files inside Puppy Linux (Geany, Vim, or shell) or import files from your iPad to update this site live.
      </p>
      <div class="actions">
        <button id="ping-btn" type="button">Run Interactive Check</button>
        <span id="ping-output" class="status">Ready</span>
      </div>
    </main>
    <script src="./app.js"></script>
  </body>
</html>
`;

  const styleCss = `:root {
  color-scheme: dark;
  --bg: #0b1120;
  --card: #111827;
  --border: #1e293b;
  --text: #e2e8f0;
  --muted: #94a3b8;
  --accent: #0284c7;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 24px;
  background: var(--bg);
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif;
}
.card {
  width: 100%;
  max-width: 560px;
  padding: 24px;
  border-radius: 10px;
  background: var(--card);
  border: 1px solid var(--border);
}
.header {
  display: flex;
  align-items: center;
  gap: 10px;
  color: #38bdf8;
}
h1 {
  margin: 0;
  font-size: 1.25rem;
  color: var(--text);
}
.subtitle {
  margin: 12px 0 20px;
  line-height: 1.6;
  font-size: 0.92rem;
  color: var(--muted);
}
code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  color: #e2e8f0;
  background: #0f172a;
  padding: 2px 6px;
  border-radius: 4px;
}
.actions {
  display: flex;
  align-items: center;
  gap: 12px;
}
button {
  height: 36px;
  padding: 0 14px;
  border-radius: 6px;
  border: none;
  background: var(--accent);
  color: #fff;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
}
.status {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.82rem;
  color: #34d399;
}
`;

  const appJs = `document.getElementById('ping-btn')?.addEventListener('click', () => {
  const out = document.getElementById('ping-output');
  if (out) {
    out.textContent = 'OK @ ' + new Date().toLocaleTimeString();
  }
});
`;

  const raw: Array<{ name: string; content: string; mime: string }> = [
    { name: 'index.html', content: indexHtml, mime: 'text/html' },
    { name: 'style.css', content: styleCss, mime: 'text/css' },
    { name: 'app.js', content: appJs, mime: 'application/javascript' },
  ];

  return raw.map((item) => {
    const data = encodeUtf8(item.content);
    return {
      name: item.name,
      folder: 'www',
      size: data.byteLength,
      mimeType: item.mime,
      updatedAt: now,
      syncedTo9p: false,
      data,
    };
  });
}

// --- Live v86 VirtIO 9p Bridge Helpers ---

export function ensure9pDirectory(emu: V86Instance, dirPath: string): void {
  const fs9p = emu.fs9p;
  if (!fs9p?.SearchPath || !fs9p.CreateDirectory) return;

  const segments = dirPath.split('/').filter(Boolean);
  let currentPath = '';
  let parentId = 0;

  for (const segment of segments) {
    currentPath += '/' + segment;
    const found = fs9p.SearchPath(currentPath);
    if (found && found.id >= 0) {
      parentId = found.id;
    } else {
      try {
        parentId = fs9p.CreateDirectory(segment, parentId);
      } catch {
        return;
      }
    }
  }
}

export async function writeFileToVm9p(
  emu: V86Instance | null,
  fullPath: string,
  data: Uint8Array
): Promise<boolean> {
  if (!emu?.create_file) return false;
  const normalized = fullPath.startsWith('/') ? fullPath : `/${fullPath}`;
  const parentDir = normalized.slice(0, normalized.lastIndexOf('/'));

  try {
    if (parentDir) {
      ensure9pDirectory(emu, parentDir);
    }
    await emu.create_file(normalized, data);
    return true;
  } catch {
    return false;
  }
}

export async function readFileFromVm9p(
  emu: V86Instance | null,
  fullPath: string
): Promise<Uint8Array | null> {
  if (!emu?.read_file) return null;
  const normalized = fullPath.startsWith('/') ? fullPath : `/${fullPath}`;
  try {
    const result = await emu.read_file(normalized);
    return result instanceof Uint8Array ? result : new Uint8Array(result);
  } catch {
    return null;
  }
}

export function listVm9pDirectory(emu: V86Instance | null, dirPath: string): string[] {
  const fs9p = emu?.fs9p;
  if (!fs9p) return [];
  const normalized = dirPath.startsWith('/') ? dirPath : `/${dirPath}`;

  try {
    if (typeof fs9p.read_dir === 'function') {
      return fs9p.read_dir(normalized).filter((n) => n !== '.' && n !== '..');
    }
    if (typeof fs9p.SearchPath === 'function' && Array.isArray(fs9p.inodes)) {
      const node = fs9p.SearchPath(normalized);
      if (node && node.id >= 0) {
        const inode = fs9p.inodes[node.id];
        if (inode?.direntries instanceof Map) {
          return Array.from(inode.direntries.keys()).filter((n) => n !== '.' && n !== '..');
        }
      }
    }
  } catch {
    // 9p filesystem not initialized yet
  }
  return [];
}

// --- Pure TypeScript FAT16 Virtual Drive Builder (Universal Puppy Linux /dev/sda Compatibility) ---

interface FatInputEntry {
  name: string;
  data: Uint8Array;
}

function makeShortName(longName: string, usedShortNames: Set<string>): Uint8Array {
  const dotIdx = longName.lastIndexOf('.');
  const rawBase = (dotIdx > 0 ? longName.slice(0, dotIdx) : longName)
    .toUpperCase()
    .replace(/[^A-Z0-9_$!#%&'()-]/g, '');
  const rawExt = (dotIdx > 0 ? longName.slice(dotIdx + 1) : '')
    .toUpperCase()
    .replace(/[^A-Z0-9_$!#%&'()-]/g, '')
    .slice(0, 3);

  const ext = rawExt.padEnd(3, ' ');
  let base = (rawBase || 'FILE').slice(0, 8).padEnd(8, ' ');
  let candidate = base + ext;

  if (usedShortNames.has(candidate) || longName.length > 12 || /[^A-Z0-9._-]/.test(longName.toUpperCase())) {
    let n = 1;
    while (n < 9999) {
      const suffix = `~${n}`;
      base = (rawBase || 'FILE').slice(0, 8 - suffix.length) + suffix;
      candidate = base.padEnd(8, ' ') + ext;
      if (!usedShortNames.has(candidate)) break;
      n++;
    }
  }

  usedShortNames.add(candidate);
  const out = new Uint8Array(11);
  for (let i = 0; i < 11; i++) {
    out[i] = candidate.charCodeAt(i) & 0x7f;
  }
  return out;
}

function shortNameChecksum(shortName: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < 11; i++) {
    sum = (((sum & 1) << 7) + (sum >> 1) + shortName[i]) & 0xff;
  }
  return sum;
}

function buildDirectoryEntries(
  longName: string,
  shortName: Uint8Array,
  attr: number,
  firstCluster: number,
  fileSize: number
): Uint8Array[] {
  const entries: Uint8Array[] = [];
  const checksum = shortNameChecksum(shortName);

  // Always emit VFAT LFN entries so Linux preserves exact case & long filenames
  const lfnCount = Math.ceil(longName.length / 13);
  for (let seq = lfnCount; seq >= 1; seq--) {
    const entry = new Uint8Array(32);
    entry[0] = seq === lfnCount ? seq | 0x40 : seq;
    entry[11] = 0x0f; // LFN attribute
    entry[12] = 0x00;
    entry[13] = checksum;
    entry[26] = 0x00;
    entry[27] = 0x00;

    const startChar = (seq - 1) * 13;
    const offsets = [1, 3, 5, 7, 9, 14, 16, 18, 20, 22, 24, 28, 30];
    for (let i = 0; i < 13; i++) {
      const charIdx = startChar + i;
      let codeUnit: number;
      if (charIdx < longName.length) {
        codeUnit = longName.charCodeAt(charIdx);
      } else if (charIdx === longName.length) {
        codeUnit = 0x0000;
      } else {
        codeUnit = 0xffff;
      }
      entry[offsets[i]] = codeUnit & 0xff;
      entry[offsets[i] + 1] = (codeUnit >> 8) & 0xff;
    }
    entries.push(entry);
  }

  // Standard 8.3 directory entry
  const sfn = new Uint8Array(32);
  sfn.set(shortName, 0);
  sfn[11] = attr;
  const view = new DataView(sfn.buffer);
  // Fixed valid DOS timestamp (2026-01-01 12:00:00)
  const dosTime = (12 << 11) | (0 << 5);
  const dosDate = ((2026 - 1980) << 9) | (1 << 5) | 1;
  view.setUint16(14, dosTime, true);
  view.setUint16(16, dosDate, true);
  view.setUint16(18, dosDate, true);
  view.setUint16(22, dosTime, true);
  view.setUint16(24, dosDate, true);
  view.setUint16(26, firstCluster & 0xffff, true);
  view.setUint32(28, fileSize >>> 0, true);
  entries.push(sfn);

  return entries;
}

export function buildFat16DiskImage(
  rootFiles: FatInputEntry[],
  wwwFiles: FatInputEntry[],
  volumeLabel = 'IPAD_FILES'
): ArrayBuffer {
  const bytesPerSector = 512;
  const partStartLba = 63; // Standard MBR partition 1 offset (/dev/sda1)
  const reservedSectors = 1;
  const numFats = 2;
  const rootEntryCount = 512;
  const rootDirSectors = (rootEntryCount * 32) / bytesPerSector; // 32

  const payloadBytes =
    rootFiles.reduce((acc, f) => acc + f.data.byteLength + 2048, 0) +
    wwwFiles.reduce((acc, f) => acc + f.data.byteLength + 2048, 0) +
    2 * 1024 * 1024;

  // Compact 4 MB minimum (8192 sectors, 1 sector/cluster -> ~8000 clusters = valid FAT16, low iPadOS RAM footprint)
  const targetMb = Math.max(4, Math.ceil(payloadBytes / (4 * 1024 * 1024)) * 4);
  const cappedMb = Math.min(128, targetMb);
  const totalDiskSectors = (cappedMb * 1024 * 1024) / bytesPerSector;
  const partSectors = totalDiskSectors - partStartLba;
  const sectorsPerCluster =
    cappedMb <= 16 ? 1 : cappedMb <= 32 ? 2 : cappedMb <= 64 ? 4 : 8;
  const bytesPerCluster = sectorsPerCluster * bytesPerSector;

  const maxClusters = Math.floor((partSectors - reservedSectors - rootDirSectors) / sectorsPerCluster);
  const fatSizeSectors = Math.ceil(((maxClusters + 2) * 2) / bytesPerSector);
  const dataStartSector = partStartLba + reservedSectors + numFats * fatSizeSectors + rootDirSectors;
  const totalClusters = Math.floor((totalDiskSectors - dataStartSector) / sectorsPerCluster);

  const image = new Uint8Array(totalDiskSectors * bytesPerSector);
  const view = new DataView(image.buffer);

  // LBA 0: Non-bootable MBR with 1 primary FAT16 partition (/dev/sda1)
  image[446] = 0x00; // non-bootable so BIOS never boots off data drive
  image[447] = 0x01;
  image[448] = 0x01;
  image[449] = 0x00;
  image[450] = 0x06; // FAT16 > 32M / standard FAT16
  image[451] = 0xfe;
  image[452] = 0xff;
  image[453] = 0xff;
  view.setUint32(454, partStartLba, true);
  view.setUint32(458, partSectors, true);
  image[510] = 0x55;
  image[511] = 0xaa;

  // LBA 63: FAT16 Volume Boot Record (BPB)
  const vbrOffset = partStartLba * bytesPerSector;
  image[vbrOffset + 0] = 0xeb;
  image[vbrOffset + 1] = 0x3c;
  image[vbrOffset + 2] = 0x90;
  image.set(encodeUtf8('MSDOS5.0'), vbrOffset + 3);
  view.setUint16(vbrOffset + 11, bytesPerSector, true);
  image[vbrOffset + 13] = sectorsPerCluster;
  view.setUint16(vbrOffset + 14, reservedSectors, true);
  image[vbrOffset + 16] = numFats;
  view.setUint16(vbrOffset + 17, rootEntryCount, true);
  view.setUint16(vbrOffset + 19, partSectors < 65536 ? partSectors : 0, true);
  image[vbrOffset + 21] = 0xf8;
  view.setUint16(vbrOffset + 22, fatSizeSectors, true);
  view.setUint16(vbrOffset + 24, 63, true);
  view.setUint16(vbrOffset + 26, 255, true);
  view.setUint32(vbrOffset + 28, partStartLba, true);
  view.setUint32(vbrOffset + 32, partSectors >= 65536 ? partSectors : 0, true);
  image[vbrOffset + 36] = 0x80;
  image[vbrOffset + 38] = 0x29;
  view.setUint32(vbrOffset + 39, 0x20261125, true);
  const paddedLabel = volumeLabel.toUpperCase().replace(/[^A-Z0-9_ ]/g, '').slice(0, 11).padEnd(11, ' ');
  image.set(encodeUtf8(paddedLabel), vbrOffset + 43);
  image.set(encodeUtf8('FAT16   '), vbrOffset + 54);
  image[vbrOffset + 510] = 0x55;
  image[vbrOffset + 511] = 0xaa;

  // FAT table helper (in-memory Uint16Array then mirrored to both FAT copies)
  const fat = new Uint16Array(totalClusters + 2);
  fat[0] = 0xfff8;
  fat[1] = 0xffff;
  let nextFreeCluster = 2;

  const writeClusterData = (data: Uint8Array): number => {
    if (data.byteLength === 0) return 0;
    const needed = Math.ceil(data.byteLength / bytesPerCluster);
    if (nextFreeCluster + needed > totalClusters + 2) return 0;
    const first = nextFreeCluster;
    for (let i = 0; i < needed; i++) {
      const c = nextFreeCluster++;
      fat[c] = i === needed - 1 ? 0xffff : c + 1;
      const sectorOffset = (dataStartSector + (c - 2) * sectorsPerCluster) * bytesPerSector;
      const slice = data.subarray(i * bytesPerCluster, (i + 1) * bytesPerCluster);
      image.set(slice, sectorOffset);
    }
    return first;
  };

  const rootEntries: Uint8Array[] = [];
  const usedRootShort = new Set<string>();

  // Volume Label directory entry
  const volEntry = new Uint8Array(32);
  volEntry.set(encodeUtf8(paddedLabel), 0);
  volEntry[11] = 0x08;
  rootEntries.push(volEntry);

  // Write root files (auto scripts + imported iPad files)
  for (const file of rootFiles) {
    const safeName = sanitizeGuestFilename(file.name);
    const firstCluster = writeClusterData(file.data);
    const shortName = makeShortName(safeName, usedRootShort);
    const entries = buildDirectoryEntries(safeName, shortName, 0x20, firstCluster, file.data.byteLength);
    if (rootEntries.length + entries.length <= rootEntryCount) {
      rootEntries.push(...entries);
    }
  }

  // Create `www` subdirectory inside FAT16 disk
  const wwwDirEntries: Uint8Array[] = [];
  const usedWwwShort = new Set<string>();
  for (const file of wwwFiles) {
    const safeName = sanitizeGuestFilename(file.name);
    const firstCluster = writeClusterData(file.data);
    const shortName = makeShortName(safeName, usedWwwShort);
    wwwDirEntries.push(...buildDirectoryEntries(safeName, shortName, 0x20, firstCluster, file.data.byteLength));
  }

  // Allocate cluster(s) for `www` directory (with `.` and `..`)
  const dotEntry = new Uint8Array(32);
  dotEntry.set(encodeUtf8('.          '), 0);
  dotEntry[11] = 0x10;
  const dotDotEntry = new Uint8Array(32);
  dotDotEntry.set(encodeUtf8('..         '), 0);
  dotDotEntry[11] = 0x10;

  const allWwwDirBytes = new Uint8Array((2 + wwwDirEntries.length) * 32);
  const wwwDirCluster = nextFreeCluster;
  new DataView(dotEntry.buffer).setUint16(26, wwwDirCluster & 0xffff, true);
  new DataView(dotDotEntry.buffer).setUint16(26, 0, true);
  allWwwDirBytes.set(dotEntry, 0);
  allWwwDirBytes.set(dotDotEntry, 32);
  wwwDirEntries.forEach((e, idx) => allWwwDirBytes.set(e, (idx + 2) * 32));
  const allocatedWwwCluster = writeClusterData(allWwwDirBytes);

  if (allocatedWwwCluster > 0) {
    const wwwShort = makeShortName('www', usedRootShort);
    const wwwEntry = buildDirectoryEntries('www', wwwShort, 0x10, allocatedWwwCluster, 0);
    if (rootEntries.length + wwwEntry.length <= rootEntryCount) {
      rootEntries.push(...wwwEntry);
    }
  }

  // Write root directory table
  const rootDirByteOffset = (partStartLba + reservedSectors + numFats * fatSizeSectors) * bytesPerSector;
  rootEntries.forEach((entry, idx) => {
    image.set(entry, rootDirByteOffset + idx * 32);
  });

  // Write FAT #1 and FAT #2
  const fat1ByteOffset = (partStartLba + reservedSectors) * bytesPerSector;
  const fat2ByteOffset = (partStartLba + reservedSectors + fatSizeSectors) * bytesPerSector;
  for (let c = 0; c < fat.length; c++) {
    view.setUint16(fat1ByteOffset + c * 2, fat[c], true);
    view.setUint16(fat2ByteOffset + c * 2, fat[c], true);
  }

  return image.buffer;
}

// --- Live Host Preview Compiler for /www files ---

export function compileLiveWebPreview(
  files: Map<string, Uint8Array>,
  entryName: string
): { html: string; blobUrls: string[] } {
  const blobUrls: string[] = [];
  const assetUrlMap = new Map<string, string>();

  for (const [name, data] of files.entries()) {
    if (name === entryName) continue;
    const copy = new Uint8Array(data.byteLength);
    copy.set(data);
    const url = URL.createObjectURL(new Blob([copy], { type: guessMimeType(name) }));
    blobUrls.push(url);
    assetUrlMap.set(name, url);
    assetUrlMap.set(`./${name}`, url);
    assetUrlMap.set(`/${name}`, url);
  }

  const rawEntry = files.get(entryName);
  if (!rawEntry) {
    return {
      html: `<!doctype html><html><body style="font-family:system-ui;background:#0f172a;color:#94a3b8;padding:24px">No <code>${entryName}</code> found in <code>/mnt/ipad/www</code>.</body></html>`,
      blobUrls,
    };
  }

  let html = decodeUtf8(rawEntry);
  // Rewrite local href/src references to in-memory Blob URLs for instant offline iPadOS preview
  html = html.replace(/(href|src)=["']([^"']+)["']/gi, (full, attr: string, target: string) => {
    const resolved = assetUrlMap.get(target.trim());
    return resolved ? `${attr}="${resolved}"` : full;
  });

  return { html, blobUrls };
}
