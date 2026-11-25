import React, { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

interface ErrorBoundaryState {
  error: Error | null;
}

class RootErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-dvh w-screen bg-[#090d16] text-slate-200 flex items-center justify-center p-6">
          <div className="w-full max-w-md p-5 rounded-lg bg-slate-900 border border-red-900/70 space-y-3">
            <h1 className="text-sm font-semibold text-red-300">Emulator UI Error</h1>
            <p className="text-xs font-mono text-slate-300 break-words">
              {this.state.error.message}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="h-9 px-4 rounded-md bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium"
            >
              Reload Emulator
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>
  </StrictMode>
);
