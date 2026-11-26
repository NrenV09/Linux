/**
 * Production v86 (32-bit i686 Puppy Linux) & Optional QEMU-Wasm (64-bit VoidPup64)
 * Configuration tuned for iPadOS Safari / WebKit (256 MB - 2 GB RAM).
 */

export const IPADOS_RAM_MIN_MB = 256;
export const IPADOS_RAM_MAX_MB = 2048;

// Primary Configuration: v86 Single-Threaded Wasm (NO COOP/COEP / SharedArrayBuffer required)
// Target: BookwormPup32 or NoblePup32 (32-bit i686 Xorg/JWM)
export function createPuppyV86Config({
  screenContainer,
  memoryMb = 512,
  vgaMemoryMb = 8,
  basePath = './puppy',
  isoName = 'BookwormPup32.iso',
  isoSizeBytes = undefined,
  localFiles = null,
  networkRelayUrl = 'fetch', // 'fetch' or 'wss://relay.widgetry.org/'
  netDeviceType = 'ne2k', // 'ne2k' (built-in Puppy 32-bit) or 'virtio'
}) {
  // Enforce strict iPadOS WebKit memory ceiling to avoid Jetsam tab kills
  const safeRamMb = Math.min(IPADOS_RAM_MAX_MB, Math.max(IPADOS_RAM_MIN_MB, memoryMb));

  const bzimage = localFiles?.vmlinuz
    ? { buffer: localFiles.vmlinuz }
    : { url: `${basePath}/vmlinuz` };

  const initrd = localFiles?.initrd
    ? { buffer: localFiles.initrd }
    : { url: `${basePath}/initrd.gz` };

  // Async range-chunked CD-ROM prevents double-buffering the full ~380MB ISO in WebKit RAM
  const cdrom = localFiles?.iso
    ? { buffer: localFiles.iso, async: true }
    : {
        url: `${basePath}/${isoName}`,
        async: true,
        fixed_chunk_size: 256 * 1024,
        ...(isoSizeBytes ? { size: isoSizeBytes } : {}),
      };

  return {
    wasm_path: 'https://cdn.jsdelivr.net/npm/v86@latest/build/v86.wasm',
    memory_size: safeRamMb * 1024 * 1024,
    vga_memory_size: vgaMemoryMb * 1024 * 1024, // Bochs VBE VGA for Xorg/JWM (no Wayland)
    screen_container: screenContainer,
    bios: { url: 'https://cdn.jsdelivr.net/gh/copy/v86@master/bios/seabios.bin' },
    vga_bios: { url: 'https://cdn.jsdelivr.net/gh/copy/v86@master/bios/vgabios.bin' },

    // Direct kernel + initrd boot with on-demand SFS loading from virtual CD-ROM
    bzimage,
    initrd,
    cdrom,

    // Critical low-RAM Wasm Puppy boot flags:
    // pfix=ram,nocopy -> never copy puppy_*.sfs / zdrv_*.sfs / fdrv_*.sfs into guest tmpfs RAM
    // pmedia=cd       -> mount SFS directly from virtual ATAPI CD-ROM without slow device probing
    // acpi=off        -> avoids SeaBIOS ACPI stalls
    cmdline: [
      'pfix=ram,nocopy',
      'pmedia=cd',
      'acpi=off',
      'noapic',
      'nolapic',
      'tsc=reliable',
      'mitigations=off',
    ].join(' '),

    net_device: {
      type: netDeviceType,
      relay_url: networkRelayUrl,
    },

    // Enable live VirtIO 9p share (mount -t 9p -o trans=virtio,version=9p2000.L host9p /mnt/ipad)
    filesystem: {},

    autostart: true,
    acpi: false,
    disable_jit: false,
    disable_mouse: true, // Managed by unified iPadOS touch + drag driver below
  };
}

// Secondary Configuration: QEMU-Wasm 64-bit x86_64 (e.g., VoidPup64)
// Requires COOP/COEP HTTP headers (SharedArrayBuffer + Emscripten pthreads)
export const QEMU_WASM_VOIDPUP64_CONFIG = {
  requiresCrossOriginIsolation: true,
  canRunInCurrentBrowser: () =>
    typeof window !== 'undefined' &&
    window.crossOriginIsolated === true &&
    typeof SharedArrayBuffer !== 'undefined',
  memoryCapMb: 512,
  assets: {
    kernel: './puppy64/vmlinuz',
    initrd: './puppy64/initrd.gz',
    iso: './puppy64/VoidPup64.iso',
  },
  qemuArgs: [
    '-machine', 'pc,acpi=off',
    '-cpu', 'max,-svm,-vmx',
    '-smp', '2',
    '-m', '512M',
    '-vga', 'std',
    '-display', 'sdl',
    '-kernel', '/pack/vmlinuz',
    '-initrd', '/pack/initrd.gz',
    '-cdrom', '/pack/VoidPup64.iso',
    '-append', 'pfix=ram,nocopy pmedia=cd acpi=off mitigations=off vga=791',
    '-netdev', 'user,id=net0',
    '-device', 'virtio-net-pci,netdev=net0',
    '-device', 'usb-ehci',
    '-device', 'usb-tablet',
  ],
};

// PS/2 Set 1 Scancodes for iPadOS On-Screen Modifier Bar
const SCANCODES = {
  ctrl: [0x1d],
  alt: [0x38],
  super: [0xe0, 0x5b],
  esc: [0x01],
  tab: [0x0f],
  enter: [0x1c],
};

function makeToBreak(codes) {
  return codes.length === 2 ? [codes[0], codes[1] | 0x80] : [codes[0] | 0x80];
}

// Standalone page bootstrap (runs only when loaded via puppy-standalone/index.html)
if (typeof document !== 'undefined' && document.getElementById('viewport')) {
  const viewport = document.getElementById('viewport');
  const screenContainer = document.getElementById('screen_container');
  const statusLine = document.getElementById('status-line');
  const ramSelect = document.getElementById('ram-select');
  const btnBoot = document.getElementById('btn-boot');
  const btnReset = document.getElementById('btn-reset');
  const btnDrag = document.getElementById('btn-drag');
  const btnKbd = document.getElementById('btn-kbd');
  const btnFull = document.getElementById('btn-full');
  const btnRClick = document.getElementById('btn-rclick');
  const btnSave = document.getElementById('btn-save');
  const localFilesInput = document.getElementById('local-files');
  const restoreFileInput = document.getElementById('restore-file');
  const kbdBridge = document.getElementById('ipad-kbd-bridge');

  let emulator = null;
  let dragMode = false;
  let localBundle = null;
  let lastInstr = 0;
  let lastTick = performance.now();
  const activeMods = { ctrl: false, alt: false, super: false };

  function fitScreen() {
    const canvas = screenContainer.querySelector('canvas');
    if (canvas && canvas.style.display !== 'none' && canvas.width > 0 && canvas.height > 0) {
      const scale = Math.min(viewport.clientWidth / canvas.width, viewport.clientHeight / canvas.height);
      canvas.style.width = `${Math.floor(canvas.width * scale)}px`;
      canvas.style.height = `${Math.floor(canvas.height * scale)}px`;
    }
  }

  function startVm() {
    if (!window.V86) return;
    if (emulator) emulator.destroy();

    screenContainer.innerHTML = '<div></div><canvas style="display:none"></canvas>';
    const ramMb = Number(ramSelect.value) || 512;
    const cfg = createPuppyV86Config({
      screenContainer,
      memoryMb: ramMb,
      localFiles: localBundle,
    });

    statusLine.textContent = `Booting · ${ramMb} MB · 0.00 MIPS`;
    emulator = new window.V86(cfg);
    btnReset.disabled = false;

    emulator.add_listener('emulator-loaded', () => {
      statusLine.textContent = `Running · ${ramMb} MB · 0.00 MIPS`;
      fitScreen();
    });
    emulator.add_listener('screen-set-size', () => requestAnimationFrame(fitScreen));
  }

  // iPadOS Touch Gestures: Tap = L-Click, Two-Finger Tap or 550ms Long-Press = R-Click,
  // Double-Tap+Drag or Drag Mode = L-Click + Drag
  let touchCtx = {
    active: false,
    x: 0,
    y: 0,
    startX: 0,
    startY: 0,
    moved: false,
    startTime: 0,
    maxTouches: 0,
    holdingLeft: false,
    longPressFired: false,
    longPressTimer: null,
    lastTapTime: 0,
  };

  function sendButtons(l, m, r) {
    emulator?.bus?.send('mouse-click', [l, m, r]);
  }

  viewport.addEventListener('touchstart', (e) => {
    if (!emulator || !e.touches.length) return;
    const t = e.touches[0];
    const now = performance.now();
    const isDoubleTapDrag = e.touches.length === 1 && now - touchCtx.lastTapTime < 340;
    const holdLeft = e.touches.length === 1 && (dragMode || isDoubleTapDrag);

    clearTimeout(touchCtx.longPressTimer);
    touchCtx = {
      ...touchCtx,
      active: true,
      x: t.clientX,
      y: t.clientY,
      startX: t.clientX,
      startY: t.clientY,
      moved: false,
      startTime: now,
      maxTouches: e.touches.length,
      holdingLeft: holdLeft,
      longPressFired: false,
      longPressTimer: null,
    };

    if (holdLeft) {
      sendButtons(true, false, false);
    } else if (e.touches.length === 1) {
      touchCtx.longPressTimer = setTimeout(() => {
        if (touchCtx.active && !touchCtx.moved && touchCtx.maxTouches === 1) {
          touchCtx.longPressFired = true;
          sendButtons(false, false, true);
          setTimeout(() => sendButtons(false, false, false), 50);
        }
      }, 550);
    }
  });

  viewport.addEventListener('touchmove', (e) => {
    if (!emulator || !touchCtx.active || !e.touches.length) return;
    e.preventDefault();
    const t = e.touches[0];
    const dx = t.clientX - touchCtx.x;
    const dy = t.clientY - touchCtx.y;
    if (Math.hypot(t.clientX - touchCtx.startX, t.clientY - touchCtx.startY) > 6) {
      touchCtx.moved = true;
      clearTimeout(touchCtx.longPressTimer);
    }
    touchCtx.x = t.clientX;
    touchCtx.y = t.clientY;
    touchCtx.maxTouches = Math.max(touchCtx.maxTouches, e.touches.length);
    emulator.bus?.send('mouse-delta', [dx * 1.35, -dy * 1.35]);
  }, { passive: false });

  viewport.addEventListener('touchend', (e) => {
    if (!touchCtx.active || e.touches.length > 0) return;
    clearTimeout(touchCtx.longPressTimer);
    const elapsed = performance.now() - touchCtx.startTime;

    if (touchCtx.holdingLeft) {
      sendButtons(false, false, false);
    } else if (!touchCtx.longPressFired && !touchCtx.moved && elapsed < 300) {
      if (touchCtx.maxTouches >= 2) {
        sendButtons(false, false, true);
        setTimeout(() => sendButtons(false, false, false), 45);
      } else {
        touchCtx.lastTapTime = performance.now();
        sendButtons(true, false, false);
        setTimeout(() => sendButtons(false, false, false), 45);
      }
    }
    touchCtx.active = false;
  });

  viewport.addEventListener('touchcancel', () => {
    clearTimeout(touchCtx.longPressTimer);
    if (touchCtx.holdingLeft) {
      touchCtx.holdingLeft = false;
      sendButtons(false, false, false);
    }
    touchCtx.active = false;
  });

  // On-screen modifier key bar (Ctrl, Alt, Super, Esc, Tab, Enter)
  document.querySelectorAll('[data-mod]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mod = btn.dataset.mod;
      activeMods[mod] = !activeMods[mod];
      btn.classList.toggle('active', activeMods[mod]);
      if (emulator) {
        const codes = activeMods[mod] ? SCANCODES[mod] : makeToBreak(SCANCODES[mod]);
        emulator.keyboard_send_scancodes(codes);
      }
    });
  });

  document.querySelectorAll('[data-key]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!emulator) return;
      const code = SCANCODES[btn.dataset.key];
      emulator.keyboard_send_scancodes([...code, ...makeToBreak(code)]);
    });
  });

  btnRClick.addEventListener('click', () => {
    sendButtons(false, false, true);
    setTimeout(() => sendButtons(false, false, false), 45);
  });

  btnDrag.addEventListener('click', () => {
    dragMode = !dragMode;
    btnDrag.classList.toggle('active', dragMode);
  });

  btnKbd.addEventListener('click', () => kbdBridge.focus());
  kbdBridge.addEventListener('input', () => {
    if (kbdBridge.value && emulator) {
      emulator.keyboard_send_text(kbdBridge.value);
      kbdBridge.value = '';
    }
  });
  kbdBridge.addEventListener('keydown', (e) => {
    if (!emulator) return;
    if (e.key === 'Backspace') emulator.keyboard_send_scancodes([0x0e, 0x8e]);
    if (e.key === 'Enter') emulator.keyboard_send_scancodes([0x1c, 0x9c]);
  });

  localFilesInput.addEventListener('change', () => {
    const files = Array.from(localFilesInput.files || []);
    const vmlinuz = files.find((f) => /vmlinuz/i.test(f.name));
    const initrd = files.find((f) => /initrd/i.test(f.name));
    const iso = files.find((f) => /\.(iso|img)$/i.test(f.name));
    if (vmlinuz || initrd || iso) {
      localBundle = { vmlinuz, initrd, iso };
      startVm();
    }
  });

  btnSave.addEventListener('click', async () => {
    if (!emulator) return;
    const state = await emulator.save_state();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([state], { type: 'application/octet-stream' }));
    a.download = 'puppy-v86-state.bin';
    a.click();
  });

  restoreFileInput.addEventListener('change', async () => {
    const file = restoreFileInput.files?.[0];
    if (!file || !emulator) return;
    const buf = await file.arrayBuffer();
    await emulator.stop();
    await emulator.restore_state(buf);
    await emulator.run();
  });

  btnBoot.addEventListener('click', startVm);
  btnReset.addEventListener('click', () => emulator?.restart());
  btnFull.addEventListener('click', () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
    else document.exitFullscreen?.();
  });

  window.addEventListener('resize', fitScreen);
  setInterval(() => {
    if (!emulator || !emulator.is_running()) return;
    const now = performance.now();
    const instr = emulator.get_instruction_counter();
    let diff = instr - lastInstr;
    if (diff < 0) diff += 0x100000000;
    const mips = (diff / ((now - lastTick) / 1000) / 1e6).toFixed(2);
    lastInstr = instr;
    lastTick = now;
    statusLine.textContent = `Running · ${ramSelect.value} MB · ${mips} MIPS`;
  }, 1000);
}
