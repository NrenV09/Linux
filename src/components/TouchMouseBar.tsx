import React from 'react';
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
  onClose: () => void;
}

export const TouchMouseBar: React.FC<TouchMouseBarProps> = ({
  visible,
  dragMode,
  leftButtonHeld,
  onToggleDragMode,
  onLeftButtonDown,
  onLeftButtonUp,
  onRightClick,
  onScroll,
  onClose,
}) => {
  if (!visible) return null;

  return (
    <div
      data-touch-mouse-bar="true"
      className="absolute bottom-3 left-1/2 -translate-x-1/2 z-30 flex items-center gap-1.5 px-2.5 py-2 rounded-lg bg-slate-900/95 border border-slate-700/90 shadow-xl select-none touch-none"
      role="toolbar"
      aria-label="Touch mouse and drag controls"
      onPointerDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      onTouchMove={(e) => e.stopPropagation()}
      onTouchEnd={(e) => e.stopPropagation()}
    >
      {/* Holdable Left Click button: hold with thumb while dragging on screen with other hand */}
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
        className={`h-11 px-3.5 rounded-md text-xs font-medium border flex items-center gap-1.5 whitespace-nowrap transition-colors ${
          leftButtonHeld
            ? 'bg-sky-600 text-white border-sky-400'
            : 'bg-slate-800 hover:bg-slate-700 text-slate-100 border-slate-700'
        }`}
      >
        <MousePointerClick className="w-4 h-4 shrink-0" />
        <span>Hold L-Click</span>
      </button>

      {/* One-finger Drag + Left-Click Mode Toggle */}
      <button
        type="button"
        aria-pressed={dragMode}
        onClick={onToggleDragMode}
        className={`h-11 px-3.5 rounded-md text-xs font-medium border flex items-center gap-1.5 whitespace-nowrap transition-colors ${
          dragMode
            ? 'bg-amber-600 text-white border-amber-400'
            : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
        }`}
      >
        <Move className="w-4 h-4 shrink-0" />
        <span>{dragMode ? 'Drag + L-Click: ON' : 'Drag + L-Click'}</span>
      </button>

      {/* Right Click */}
      <button
        type="button"
        onClick={onRightClick}
        className="h-11 px-3.5 rounded-md bg-slate-800 hover:bg-slate-700 active:bg-sky-600 text-slate-200 text-xs font-medium border border-slate-700 whitespace-nowrap transition-colors"
      >
        R-Click
      </button>

      <div className="w-px h-6 bg-slate-700/80 mx-0.5" />

      {/* Scroll Wheel Up / Down */}
      <button
        type="button"
        onClick={() => onScroll(1)}
        aria-label="Scroll wheel up"
        className="h-11 w-10 rounded-md bg-slate-800 hover:bg-slate-700 active:bg-sky-600 text-slate-200 border border-slate-700 flex items-center justify-center transition-colors"
      >
        <ChevronUp className="w-4 h-4" />
      </button>
      <button
        type="button"
        onClick={() => onScroll(-1)}
        aria-label="Scroll wheel down"
        className="h-11 w-10 rounded-md bg-slate-800 hover:bg-slate-700 active:bg-sky-600 text-slate-200 border border-slate-700 flex items-center justify-center transition-colors"
      >
        <ChevronDown className="w-4 h-4" />
      </button>

      <button
        type="button"
        onClick={onClose}
        aria-label="Hide touch mouse bar"
        className="h-11 w-9 rounded-md bg-transparent hover:bg-slate-800 text-slate-400 hover:text-slate-200 flex items-center justify-center transition-colors"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};
