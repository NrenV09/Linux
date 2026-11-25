import React, { useRef, useState } from 'react';
import { X, Delete, CornerDownLeft, Keyboard } from 'lucide-react';

interface VirtualKeyboardProps {
  visible: boolean;
  onClose: () => void;
  onSendScancodes: (codes: number[]) => void;
  onSendText: (text: string) => void;
  onInputFocusChange: (focused: boolean) => void;
}

interface KeyDef {
  label: string;
  shiftLabel?: string;
  code: number;
  extended?: boolean;
  width?: string;
}

const MOD_CODES = {
  ctrl: 0x1d,
  alt: 0x38,
  shift: 0x2a,
} as const;

const FUNCTION_ROW: KeyDef[] = [
  { label: 'Esc', code: 0x01 },
  { label: 'F1', code: 0x3b },
  { label: 'F2', code: 0x3c },
  { label: 'F3', code: 0x3d },
  { label: 'F4', code: 0x3e },
  { label: 'F5', code: 0x3f },
  { label: 'F6', code: 0x40 },
  { label: 'F7', code: 0x41 },
  { label: 'F8', code: 0x42 },
  { label: 'F9', code: 0x43 },
  { label: 'F10', code: 0x44 },
  { label: 'F11', code: 0x57 },
  { label: 'F12', code: 0x58 },
  { label: 'Del', code: 0x53, extended: true },
];

const NUMBER_ROW: KeyDef[] = [
  { label: '`', shiftLabel: '~', code: 0x29 },
  { label: '1', shiftLabel: '!', code: 0x02 },
  { label: '2', shiftLabel: '@', code: 0x03 },
  { label: '3', shiftLabel: '#', code: 0x04 },
  { label: '4', shiftLabel: '$', code: 0x05 },
  { label: '5', shiftLabel: '%', code: 0x06 },
  { label: '6', shiftLabel: '^', code: 0x07 },
  { label: '7', shiftLabel: '&', code: 0x08 },
  { label: '8', shiftLabel: '*', code: 0x09 },
  { label: '9', shiftLabel: '(', code: 0x0a },
  { label: '0', shiftLabel: ')', code: 0x0b },
  { label: '-', shiftLabel: '_', code: 0x0c },
  { label: '=', shiftLabel: '+', code: 0x0d },
];

const TOP_ROW: KeyDef[] = [
  { label: 'Tab', code: 0x0f, width: 'w-14' },
  { label: 'q', shiftLabel: 'Q', code: 0x10 },
  { label: 'w', shiftLabel: 'W', code: 0x11 },
  { label: 'e', shiftLabel: 'E', code: 0x12 },
  { label: 'r', shiftLabel: 'R', code: 0x13 },
  { label: 't', shiftLabel: 'T', code: 0x14 },
  { label: 'y', shiftLabel: 'Y', code: 0x15 },
  { label: 'u', shiftLabel: 'U', code: 0x16 },
  { label: 'i', shiftLabel: 'I', code: 0x17 },
  { label: 'o', shiftLabel: 'O', code: 0x18 },
  { label: 'p', shiftLabel: 'P', code: 0x19 },
  { label: '[', shiftLabel: '{', code: 0x1a },
  { label: ']', shiftLabel: '}', code: 0x1b },
  { label: '\\', shiftLabel: '|', code: 0x2b },
];

const HOME_ROW: KeyDef[] = [
  { label: 'a', shiftLabel: 'A', code: 0x1e },
  { label: 's', shiftLabel: 'S', code: 0x1f },
  { label: 'd', shiftLabel: 'D', code: 0x20 },
  { label: 'f', shiftLabel: 'F', code: 0x21 },
  { label: 'g', shiftLabel: 'G', code: 0x22 },
  { label: 'h', shiftLabel: 'H', code: 0x23 },
  { label: 'j', shiftLabel: 'J', code: 0x24 },
  { label: 'k', shiftLabel: 'K', code: 0x25 },
  { label: 'l', shiftLabel: 'L', code: 0x26 },
  { label: ';', shiftLabel: ':', code: 0x27 },
  { label: "'", shiftLabel: '"', code: 0x28 },
];

const BOTTOM_ROW: KeyDef[] = [
  { label: 'z', shiftLabel: 'Z', code: 0x2c },
  { label: 'x', shiftLabel: 'X', code: 0x2d },
  { label: 'c', shiftLabel: 'C', code: 0x2e },
  { label: 'v', shiftLabel: 'V', code: 0x2f },
  { label: 'b', shiftLabel: 'B', code: 0x30 },
  { label: 'n', shiftLabel: 'N', code: 0x31 },
  { label: 'm', shiftLabel: 'M', code: 0x32 },
  { label: ',', shiftLabel: '<', code: 0x33 },
  { label: '.', shiftLabel: '>', code: 0x34 },
  { label: '/', shiftLabel: '?', code: 0x35 },
];

export const VirtualKeyboard: React.FC<VirtualKeyboardProps> = ({
  visible,
  onClose,
  onSendScancodes,
  onSendText,
  onInputFocusChange,
}) => {
  const [modifiers, setModifiers] = useState({ ctrl: false, alt: false, shift: false });
  const [nativeDraft, setNativeDraft] = useState('');
  const nativeInputRef = useRef<HTMLInputElement>(null);

  if (!visible) return null;

  const toggleModifier = (mod: keyof typeof modifiers) => {
    setModifiers((prev) => ({ ...prev, [mod]: !prev[mod] }));
  };

  const pressKey = (code: number, extended = false) => {
    const sequence: number[] = [];
    if (modifiers.ctrl) sequence.push(MOD_CODES.ctrl);
    if (modifiers.alt) sequence.push(MOD_CODES.alt);
    if (modifiers.shift) sequence.push(MOD_CODES.shift);

    if (extended) {
      sequence.push(0xe0, code, 0xe0, code | 0x80);
    } else {
      sequence.push(code, code | 0x80);
    }

    if (modifiers.shift) sequence.push(MOD_CODES.shift | 0x80);
    if (modifiers.alt) sequence.push(MOD_CODES.alt | 0x80);
    if (modifiers.ctrl) sequence.push(MOD_CODES.ctrl | 0x80);

    onSendScancodes(sequence);

    if (modifiers.ctrl || modifiers.alt || modifiers.shift) {
      setModifiers({ ctrl: false, alt: false, shift: false });
    }
  };

  const sendCombo = (makeCodes: number[]) => {
    const breakCodes = [...makeCodes].reverse().map((c) => c | 0x80);
    onSendScancodes([...makeCodes, ...breakCodes]);
  };

  const sendCtrlAltDel = () => {
    onSendScancodes([
      MOD_CODES.ctrl,
      MOD_CODES.alt,
      0xe0,
      0x53,
      0xe0,
      0x53 | 0x80,
      MOD_CODES.alt | 0x80,
      MOD_CODES.ctrl | 0x80,
    ]);
  };

  const handleNativeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (val.length > 0) {
      onSendText(val);
      setNativeDraft('');
    }
  };

  const handleNativeKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      e.preventDefault();
      onSendScancodes([0x0e, 0x0e | 0x80]);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      onSendScancodes([0x1c, 0x1c | 0x80]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onSendScancodes([0x01, 0x01 | 0x80]);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      onSendScancodes([0x0f, 0x0f | 0x80]);
    }
  };

  const keyBtnClass =
    'h-9 min-w-[2rem] flex-1 rounded bg-slate-800 hover:bg-slate-700 active:bg-sky-600 text-slate-100 text-xs font-mono border border-slate-700/80 transition-colors flex items-center justify-center select-none touch-manipulation';

  return (
    <div
      className="bg-slate-950/95 border-t border-slate-800 px-3 py-2.5 select-none shrink-0"
      role="region"
      aria-label="Virtual keyboard"
    >
      {/* Top utility strip: native iPad/mobile keyboard bridge + quick combos */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2 pb-2 border-b border-slate-800/80">
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            type="button"
            onClick={() => nativeInputRef.current?.focus()}
            className="h-8 px-2.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 flex items-center gap-1.5 whitespace-nowrap shrink-0"
          >
            <Keyboard className="w-3.5 h-3.5 text-sky-400" />
            <span>System Keyboard</span>
          </button>
          <input
            ref={nativeInputRef}
            type="text"
            value={nativeDraft}
            onChange={handleNativeChange}
            onKeyDown={handleNativeKeyDown}
            onFocus={() => onInputFocusChange(true)}
            onBlur={() => onInputFocusChange(false)}
            placeholder="Type here for iPad/mobile input..."
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            className="h-8 w-48 sm:w-56 px-2.5 rounded bg-slate-900 border border-slate-700 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-sky-500"
          />
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            type="button"
            onClick={sendCtrlAltDel}
            className="h-8 px-2.5 rounded bg-slate-800 hover:bg-red-900/60 hover:border-red-700/80 text-slate-200 text-xs font-mono border border-slate-700 whitespace-nowrap shrink-0 transition-colors"
          >
            Ctrl+Alt+Del
          </button>
          <button
            type="button"
            onClick={() => sendCombo([MOD_CODES.ctrl, 0x2e])}
            className="h-8 px-2.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-mono border border-slate-700 whitespace-nowrap shrink-0 transition-colors"
          >
            Ctrl+C
          </button>
          <button
            type="button"
            onClick={() => sendCombo([MOD_CODES.alt, 0x0f])}
            className="h-8 px-2.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-mono border border-slate-700 whitespace-nowrap shrink-0 transition-colors"
          >
            Alt+Tab
          </button>
          <button
            type="button"
            onClick={() => sendCombo([MOD_CODES.alt, 0x3e])}
            className="h-8 px-2.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-mono border border-slate-700 whitespace-nowrap shrink-0 transition-colors"
          >
            Alt+F4
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Hide virtual keyboard"
            className="h-8 w-8 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 flex items-center justify-center shrink-0 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* On-screen scancode keyboard */}
      <div className="max-w-4xl mx-auto flex flex-col gap-1.5">
        {/* Function row */}
        <div className="flex gap-1 overflow-x-auto">
          {FUNCTION_ROW.map((k) => (
            <button
              key={k.label}
              type="button"
              onClick={() => pressKey(k.code, k.extended)}
              className="h-8 min-w-[2.1rem] flex-1 rounded bg-slate-900 hover:bg-slate-800 active:bg-sky-600 text-slate-300 text-[11px] font-mono border border-slate-800 transition-colors flex items-center justify-center shrink-0"
            >
              {k.label}
            </button>
          ))}
        </div>

        {/* Number row */}
        <div className="flex gap-1">
          {NUMBER_ROW.map((k) => (
            <button
              key={k.code}
              type="button"
              onClick={() => pressKey(k.code)}
              className={keyBtnClass}
            >
              {modifiers.shift && k.shiftLabel ? k.shiftLabel : k.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => pressKey(0x0e)}
            aria-label="Backspace"
            className="h-9 px-3 rounded bg-slate-800 hover:bg-slate-700 active:bg-sky-600 text-slate-100 border border-slate-700/80 flex items-center justify-center shrink-0"
          >
            <Delete className="w-4 h-4" />
          </button>
        </div>

        {/* QWERTY top row */}
        <div className="flex gap-1">
          {TOP_ROW.map((k) => (
            <button
              key={k.code}
              type="button"
              onClick={() => pressKey(k.code)}
              className={`${keyBtnClass} ${k.width ?? ''}`}
            >
              {modifiers.shift && k.shiftLabel ? k.shiftLabel : k.label}
            </button>
          ))}
        </div>

        {/* Home row */}
        <div className="flex gap-1">
          {HOME_ROW.map((k) => (
            <button
              key={k.code}
              type="button"
              onClick={() => pressKey(k.code)}
              className={keyBtnClass}
            >
              {modifiers.shift && k.shiftLabel ? k.shiftLabel : k.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => pressKey(0x1c)}
            aria-label="Enter"
            className="h-9 px-3.5 rounded bg-sky-700/80 hover:bg-sky-600 text-white text-xs font-medium border border-sky-500/60 flex items-center gap-1 shrink-0"
          >
            <CornerDownLeft className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Enter</span>
          </button>
        </div>

        {/* Bottom row + Shift */}
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => toggleModifier('shift')}
            className={`h-9 px-3 rounded text-xs font-medium border transition-colors shrink-0 ${
              modifiers.shift
                ? 'bg-sky-600 text-white border-sky-400'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700/80'
            }`}
          >
            Shift
          </button>
          {BOTTOM_ROW.map((k) => (
            <button
              key={k.code}
              type="button"
              onClick={() => pressKey(k.code)}
              className={keyBtnClass}
            >
              {modifiers.shift && k.shiftLabel ? k.shiftLabel : k.label}
            </button>
          ))}
        </div>

        {/* Modifiers, Space, Arrows */}
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => toggleModifier('ctrl')}
            className={`h-9 px-3 rounded text-xs font-medium border transition-colors shrink-0 ${
              modifiers.ctrl
                ? 'bg-sky-600 text-white border-sky-400'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700/80'
            }`}
          >
            Ctrl
          </button>
          <button
            type="button"
            onClick={() => toggleModifier('alt')}
            className={`h-9 px-3 rounded text-xs font-medium border transition-colors shrink-0 ${
              modifiers.alt
                ? 'bg-sky-600 text-white border-sky-400'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700/80'
            }`}
          >
            Alt
          </button>
          <button
            type="button"
            onClick={() => pressKey(0x39)}
            className="h-9 flex-1 rounded bg-slate-800 hover:bg-slate-700 active:bg-sky-600 text-slate-300 text-xs font-mono border border-slate-700/80"
          >
            Space
          </button>
          <button
            type="button"
            onClick={() => pressKey(0x4b, true)}
            aria-label="Left arrow"
            className="h-9 w-9 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-mono border border-slate-700/80 shrink-0"
          >
            ←
          </button>
          <button
            type="button"
            onClick={() => pressKey(0x48, true)}
            aria-label="Up arrow"
            className="h-9 w-9 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-mono border border-slate-700/80 shrink-0"
          >
            ↑
          </button>
          <button
            type="button"
            onClick={() => pressKey(0x50, true)}
            aria-label="Down arrow"
            className="h-9 w-9 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-mono border border-slate-700/80 shrink-0"
          >
            ↓
          </button>
          <button
            type="button"
            onClick={() => pressKey(0x4d, true)}
            aria-label="Right arrow"
            className="h-9 w-9 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-mono border border-slate-700/80 shrink-0"
          >
            →
          </button>
        </div>
      </div>
    </div>
  );
};
