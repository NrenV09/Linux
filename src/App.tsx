import React, { useEffect, useRef, useState } from 'react';
import { Power, Save, Upload, Maximize, MousePointer2, Keyboard, RotateCcw, AlertTriangle } from 'lucide-react';

declare global {
  interface Window {
    V86: any;
  }
}

export default function App() {
  const screenRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const stateInputRef = useRef<HTMLInputElement>(null);
  const emulatorRef = useRef<any>(null);

  const [status, setStatus] = useState<'stopped' | 'running' | 'paused' | 'error'>('stopped');
  const [ips, setIps] = useState(0);
  const [isoUrl, setIsoUrl] = useState('https://distro.ibiblio.org/tinycorelinux/14.x/x86/release/TinyCore-current.iso');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPointerLocked, setIsPointerLocked] = useState(false);
  const [v86Loaded, setV86Loaded] = useState(false);
  
  // Track instructions for IPS calculation
  const lastInstrRef = useRef(0);
  const lastTimeRef = useRef(0);

  useEffect(() => {
    // Dynamically load libv86.js
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/v86@latest/build/libv86.js';
    script.async = true;
    script.onload = () => setV86Loaded(true);
    document.body.appendChild(script);

    return () => {
      document.body.removeChild(script);
      if (emulatorRef.current) {
        emulatorRef.current.destroy();
      }
    };
  }, []);

  useEffect(() => {
    // Status polling loop
    let req: number;
    const updateStats = () => {
      if (emulatorRef.current && status === 'running') {
        const now = Date.now();
        const instr = emulatorRef.current.get_instruction_counter?.() || 0;
        const delta = now - lastTimeRef.current;
        if (delta > 1000) {
          const ipsVal = (instr - lastInstrRef.current) / (delta / 1000);
          setIps(Math.max(0, Math.round(ipsVal)));
          lastTimeRef.current = now;
          lastInstrRef.current = instr;
        }
      }
      req = requestAnimationFrame(updateStats);
    };
    req = requestAnimationFrame(updateStats);
    return () => cancelAnimationFrame(req);
  }, [status]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    const handlePointerLockChange = () => {
      setIsPointerLocked(!!document.pointerLockElement);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('pointerlockchange', handlePointerLockChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('pointerlockchange', handlePointerLockChange);
    };
  }, []);

  const initEmulator = (config: any) => {
    if (!window.V86) return;
    if (emulatorRef.current) {
      emulatorRef.current.destroy();
    }

    setStatus('running');
    lastTimeRef.current = Date.now();
    lastInstrRef.current = 0;
    setIps(0);

    const emulator = new window.V86({
      wasm_path: 'https://cdn.jsdelivr.net/npm/v86@latest/build/v86.wasm',
      memory_size: 256 * 1024 * 1024,
      vga_memory_size: 8 * 1024 * 1024,
      screen_container: screenRef.current,
      bios: { url: 'https://cdn.jsdelivr.net/npm/v86@latest/bios/seabios.bin' },
      vga_bios: { url: 'https://cdn.jsdelivr.net/npm/v86@latest/bios/vgabios.bin' },
      autostart: true,
      ...config
    });

    emulatorRef.current = emulator;

    emulator.add_listener('emulator-stopped', () => setStatus('stopped'));
    emulator.add_listener('emulator-started', () => setStatus('running'));
    emulator.add_listener('download-error', () => {
      setStatus('error');
      alert('Failed to download resources. This may be a CORS issue if using a remote URL. Please use the "Upload ISO" feature instead.');
    });
  };

  const startEmulator = () => {
    initEmulator({ cdrom: { url: isoUrl } });
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      initEmulator({ cdrom: { buffer: file } });
    }
    // reset
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const saveState = async () => {
    if (!emulatorRef.current) return;
    const state = await emulatorRef.current.save_state();
    const blob = new Blob([state], { type: 'application/octet-stream' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'v86-state.bin';
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const restoreState = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const buffer = e.target?.result as ArrayBuffer;
        if (emulatorRef.current) {
          emulatorRef.current.stop();
          await emulatorRef.current.restore_state(buffer);
          emulatorRef.current.run();
          setStatus('running');
        } else {
          initEmulator({ initial_state: { buffer: file } });
        }
      };
      reader.readAsArrayBuffer(file);
    }
    if (stateInputRef.current) stateInputRef.current.value = '';
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(console.error);
    } else {
      document.exitFullscreen();
    }
  };

  const togglePointerLock = () => {
    if (emulatorRef.current) {
      if (!isPointerLocked) {
        emulatorRef.current.lock_mouse();
      }
      // exit is handled by the browser via Esc key
    }
  };
  
  const resetEmulator = () => {
    if (emulatorRef.current) {
      emulatorRef.current.restart();
    }
  };

  return (
    <div className="flex flex-col h-screen bg-zinc-950 text-zinc-300 font-sans overflow-hidden select-none">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between p-3 bg-zinc-900 border-b border-zinc-800 gap-4 relative z-10 shadow-md">
        
        {/* Left Side: Controls */}
        <div className="flex flex-wrap items-center gap-2">
          {status === 'running' ? (
            <button onClick={resetEmulator} className="flex items-center gap-2 px-3 py-1.5 bg-red-900/50 hover:bg-red-800 text-red-100 rounded-md transition-colors text-sm font-medium border border-red-800">
              <RotateCcw size={16} /> Reset
            </button>
          ) : (
            <button onClick={startEmulator} disabled={!v86Loaded} className="flex items-center gap-2 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-md transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed">
              <Power size={16} /> Power On
            </button>
          )}

          <div className="h-6 w-px bg-zinc-700 mx-1"></div>

          <div className="flex items-center border border-zinc-700 rounded-md overflow-hidden focus-within:border-zinc-500 transition-colors">
            <input 
              type="text" 
              value={isoUrl} 
              onChange={(e) => setIsoUrl(e.target.value)} 
              placeholder="ISO URL" 
              className="bg-zinc-800 text-zinc-200 px-3 py-1.5 w-64 text-sm outline-none"
            />
          </div>
          
          <span className="text-zinc-500 text-sm">or</span>

          <input 
            type="file" 
            accept=".iso,.img" 
            ref={fileInputRef} 
            onChange={handleFileUpload} 
            className="hidden" 
          />
          <button onClick={() => fileInputRef.current?.click()} className="flex items-center gap-2 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-md transition-colors text-sm font-medium border border-zinc-700">
            <Upload size={16} /> Upload ISO
          </button>

          <div className="h-6 w-px bg-zinc-700 mx-1"></div>

          <button onClick={saveState} disabled={status !== 'running'} className="flex items-center gap-2 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-md transition-colors text-sm font-medium border border-zinc-700 disabled:opacity-50">
            <Save size={16} /> Save State
          </button>
          
          <input 
            type="file" 
            accept=".bin" 
            ref={stateInputRef} 
            onChange={restoreState} 
            className="hidden" 
          />
          <button onClick={() => stateInputRef.current?.click()} disabled={!v86Loaded} className="flex items-center gap-2 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-md transition-colors text-sm font-medium border border-zinc-700 disabled:opacity-50">
            <Upload size={16} /> Restore
          </button>
        </div>

        {/* Right Side: Tools & Stats */}
        <div className="flex items-center gap-4">
          
          {/* Stats display */}
          <div className="flex items-center gap-3 text-xs bg-zinc-950/50 px-3 py-1.5 rounded-md border border-zinc-800">
            <div className="flex items-center gap-1.5">
              <div className={`w-2 h-2 rounded-full ${status === 'running' ? 'bg-emerald-500 animate-pulse' : status === 'error' ? 'bg-red-500' : 'bg-zinc-500'}`}></div>
              <span className="capitalize w-12">{status}</span>
            </div>
            <div className="w-px h-3 bg-zinc-700"></div>
            <div className="w-20">RAM: 256MB</div>
            <div className="w-px h-3 bg-zinc-700"></div>
            <div className="w-24 text-right font-mono text-zinc-400">
              {(ips / 1000000).toFixed(2)} MIPS
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button onClick={() => alert('Virtual keyboard focus requested')} title="Virtual Keyboard" className="p-1.5 hover:bg-zinc-800 text-zinc-400 rounded-md transition-colors hidden md:block">
              <Keyboard size={18} />
            </button>
            <button onClick={togglePointerLock} title="Lock Pointer" className={`p-1.5 rounded-md transition-colors ${isPointerLocked ? 'bg-blue-600 text-white' : 'hover:bg-zinc-800 text-zinc-400'}`}>
              <MousePointer2 size={18} />
            </button>
            <button onClick={toggleFullscreen} title="Fullscreen" className="p-1.5 hover:bg-zinc-800 text-zinc-400 rounded-md transition-colors">
              <Maximize size={18} />
            </button>
          </div>
        </div>
      </div>

      {/* Emulator Canvas Container */}
      <div className="flex-1 relative bg-black flex flex-col items-center justify-center overflow-hidden">
        
        {status === 'stopped' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center z-10 pointer-events-none text-zinc-500">
            <img src="https://upload.wikimedia.org/wikipedia/commons/3/35/Tux.svg" alt="Linux" className="w-24 h-24 mb-6 opacity-20 grayscale" />
            <h2 className="text-xl font-medium tracking-tight">System Offline</h2>
            <p className="text-sm mt-2 max-w-md text-center opacity-70">
              Power on the machine or upload a bootable disk image to start the emulator. TinyCore Linux will be downloaded if no ISO is provided.
            </p>
          </div>
        )}

        {status === 'error' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center z-10 pointer-events-none text-red-500">
            <AlertTriangle className="w-16 h-16 mb-4 opacity-50" />
            <h2 className="text-xl font-medium tracking-tight">Boot Failed</h2>
            <p className="text-sm mt-2 max-w-md text-center opacity-70">
              A network error occurred while fetching the image. This may be due to cross-origin resource sharing (CORS) policies. Please download the ISO manually and use the Upload ISO button.
            </p>
          </div>
        )}

        {/* v86 Screen target */}
        <div 
          ref={screenRef} 
          id="screen_container" 
          className="relative z-20 shadow-2xl w-full h-full flex items-center justify-center [&>canvas]:max-w-full [&>canvas]:max-h-full [&>canvas]:object-contain"
          style={{ 
            display: status === 'stopped' || status === 'error' ? 'none' : 'flex',
          }}
        >
          <div style={{ whiteSpace: 'pre', font: '14px monospace', lineHeight: '14px', color: '#fff' }}></div>
          <canvas style={{ display: 'none' }} className="rounded-sm"></canvas>
        </div>

      </div>
    </div>
  );
}

