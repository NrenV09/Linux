import React, { useState } from 'react';
import { Move, MousePointerClick, ChevronUp, ChevronDown, X } from 'lucide-react';

interface TouchMouseBarProps {
  visible: boolean;
  dragMode: boolean;
  leftButtonHeld: boolean;
  onToggleDragMode: () => void;
  onLeftButtonDown: () => void;
  onLeftButtonUp: () => void;
  onRightClick: () => void;
  onScroll: (delta: number) => void;
  onSendScancodes: (codes: number[]) => void;
  onClose: () => void;
}

const MOD_SCANCODES = {
  ctrl: { make: [0x1d], break: [0x9d] },
  alt: { make: [0x38], break: [0xb8] },
  super: { make: [0xe0, 0x5b], break: [0xe0, 0xdb] },
} as const;

export const TouchMouseBar: React.FC<TouchMouseBarProps> = ({
  visible,
  dragMode,
  leftButtonHeld,
  onToggleDragMode,
  onLeftButtonDown,
  onLeftButtonUp,
  onRightClick,
  onScroll,
  onSendScancodes,
  onClose,
}) => {
  const [mods, setMods] = useState({ ctrl: false, alt: false, super: false });

  if (!visible) return null;

  const toggleMod = (key: keyof typeof MOD_SCANCODES) => {
    setMods((prev) => {
      const next = !prev[key];
      onSendScancodes(next ? [...MOD_SCANCODES[key].make] : [...MOD_SCANCODES[key].break]);
      return { ...prev, [key]: next };
    });
  };

  const tapKey = (makeCode: number) => {
    onSendScancodes([makeCode, makeCode | 0x80]);
  };

  return (
    <div
      data-touch-mouse-bar="true"
      className="absolute bottom-3 left-1/2 -translate-x-1/2 z-30 max-w-[96vw] flex flex-wrap items-center justify-center gap-1.5 px-2.5 py-2 rounded-lg bg-slate-900/95 border border-slate-700/90 shadow-xl select-none touch-none"
      role="toolbar"
      aria-label="iPad touch mouse and modifier key controls"
      onPointerDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      onTouchMove={(e) => e.stopPropagation()}
      onTouchEnd={(e) => e.stopPropagation()}
    >
      {/* Mouse Controls */}
      <button
        type="button"
        onPointerDown={(e) => {
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          onLeftButtonDown();
        }}
        onPointerUp={(e) => {
          e.preventDefault();
          onLeftButtonUp();
        }}
        onPointerCancel={(e) => {
          e.preventDefault();
          onLeftButtonUp();
        }}
        className={`h-10 px-3 rounded-md text-xs font-medium border flex items-center gap-1.5 whitespace-nowrap transition-colors ${
          leftButtonHeld
            ? 'bg-sky-600 text-white border-sky-400'
            : 'bg-slate-800 hover:bg-slate-700 text-slate-100 border-slate-700'
        }`}
      >
        <MousePointerClick className="w-3.5 h-3.5 shrink-0" />
        <span>Hold L-Click</span>
      </button>

      <button
        type="button"
        aria-pressed={dragMode}
        onClick={onToggleDragMode}
        className={`h-10 px-3 rounded-md text-xs font-medium border flex items-center gap-1.5 whitespace-nowrap transition-colors ${
          dragMode
            ? 'bg-amber-600 text-white border-amber-400'
            : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
        }`}
      >
        <Move className="w-3.5 h-3.5 shrink-0" />
        <span>{dragMode ? 'Drag: ON' : 'Drag + Click'}</span>
      </button>

      <button
        type="button"
        onClick={onRightClick}
        className="h-10 px-3 rounded-md bg-slate-800 hover:bg-slate-700 active:bg-sky-600 text-slate-200 text-xs font-medium border border-slate-700 whitespace-nowrap transition-colors"
      >
        R-Click
      </button>

      <div className="w-px h-6 bg-slate-700/80 mx-0.5 hidden sm:block" />

      {/* On-Screen Modifier Key Bar for iPadOS (Ctrl, Alt, Super, Esc, Tab) */}
      <button
        type="button"
        aria-pressed={mods.ctrl}
        onClick={() => toggleMod('ctrl')}
        className={`h-10 px-2.5 rounded-md text-xs font-mono border transition-colors ${
          mods.ctrl
            ? 'bg-sky-600 text-white border-sky-400'
            : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
        }`}
      >
        Ctrl
      </button>
      <button
        type="button"
        aria-pressed={mods.alt}
        onClick={() => toggleMod('alt')}
        className={`h-10 px-2.5 rounded-md text-xs font-mono border transition-colors ${
          mods.alt
            ? 'bg-sky-600 text-white border-sky-400'
            : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
        }`}
      >
        Alt
      </button>
      <button
        type="button"
        aria-pressed={mods.super}
        onClick={() => toggleMod('super')}
        className={`h-10 px-2.5 rounded-md text-xs font-mono border transition-colors ${
          mods.super
            ? 'bg-sky-600 text-white border-sky-400'
            : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
        }`}
      >
        Super
      </button>
      <button
        type="button"
        onClick={() => tapKey(0x01)}
        className="h-10 px-2.5 rounded-md bg-slate-800 hover:bg-slate-700 active:bg-sky-600 text-slate-200 text-xs font-mono border border-slate-700 transition-colors"
      >
        Esc
      </button>
      <button
        type="button"
        onClick={() => tapKey(0x0f)}
        className="h-10 px-2.5 rounded-md bg-slate-800 hover:bg-slate-700 active:bg-sky-600 text-slate-200 text-xs font-mono border border-slate-700 transition-colors"
      >
        Tab
      </button>

      <div className="w-px h-6 bg-slate-700/80 mx-0.5 hidden sm:block" />

      {/* Scroll Wheel Up / Down */}
      <button
        type="button"
        onClick={() => onScroll(1)}
        aria-label="Scroll wheel up"
        className="h-10 w-9 rounded-md bg-slate-800 hover:bg-slate-700 active:bg-sky-600 text-slate-200 border border-slate-700 flex items-center justify-center transition-colors"
      >
        <ChevronUp className="w-4 h-4" />
      </button>
      <button
        type="button"
        onClick={() => onScroll(-1)}
        aria-label="Scroll wheel down"
        className="h-10 w-9 rounded-md bg-slate-800 hover:bg-slate-700 active:bg-sky-600 text-slate-200 border border-slate-700 flex items-center justify-center transition-colors"
      >
        <ChevronDown className="w-4 h-4" />
      </button>

      <button
        type="button"
        onClick={onClose}
        aria-label="Hide touch mouse bar"
        className="h-10 w-8 rounded-md bg-transparent hover:bg-slate-800 text-slate-400 hover:text-slate-200 flex items-center justify-center transition-colors"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};
