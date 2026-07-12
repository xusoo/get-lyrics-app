import { useEffect, useRef, useState } from 'react';
import { Clock, Loader2, Music2, Search, X } from 'lucide-react';
import type { LrclibCandidate } from '../lib/lrclib';

interface LyricsPickerProps {
  candidates: LrclibCandidate[];
  query: string;
  isSearching: boolean;
  selectedId: number | null;
  recommendedId: number | null;
  onSelect: (c: LrclibCandidate) => void;
  onSearch: (query: string) => void;
  onClose: () => void;
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function LyricsPicker({ candidates, query, isSearching, selectedId, recommendedId, onSelect, onSearch, onClose }: LyricsPickerProps) {
  const [inputValue, setInputValue] = useState(query);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Sync input when query prop changes (e.g. new track loaded while picker open)
  useEffect(() => { setInputValue(query); }, [query]);

  // Focus trap: keep Tab focus inside the dialog
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    function handleFocusTrap(e: KeyboardEvent) {
      if (e.key !== 'Tab') return;
      const focusable = Array.from(
        container!.querySelectorAll<HTMLElement>('button, input, [tabindex]:not([tabindex="-1"])'),
      ).filter((el) => !el.hasAttribute('disabled'));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }
    container.addEventListener('keydown', handleFocusTrap);
    return () => container.removeEventListener('keydown', handleFocusTrap);
  }, []);

  function handleSearch() {
    const q = inputValue.trim();
    if (q) onSearch(q);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') handleSearch();
    if (e.key === 'Escape') onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop — visible only on larger screens; click outside to close */}
      <div className="absolute inset-0 bg-black/60 hidden md:block" onClick={onClose} />

      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-label="Lyrics search"
        className="relative w-full h-full md:w-[860px] md:max-w-[92vw] md:max-h-[75vh] md:h-auto md:rounded-3xl bg-white/5 backdrop-blur-2xl border border-white/10 shadow-2xl flex flex-col overflow-hidden"
        style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.03) 100%)' }}
      >
      {/* Header bar */}
      <div className="flex items-center gap-3 px-6 pt-6 pb-4 shrink-0">
        <div className="flex-1 flex items-center gap-3 bg-white/10 border border-white/20 rounded-2xl px-4 h-14">
          <Search size={18} className="text-white/50 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Artist + song name…"
            className="flex-1 bg-transparent text-white placeholder-white/30 outline-none focus-visible:outline-none text-base"
          />
          {inputValue && (
            <button
              onClick={() => setInputValue('')}
              className="text-white/40 hover:text-white/70 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 rounded"
            >
              <X size={16} />
            </button>
          )}
        </div>

        <button
          onClick={handleSearch}
          aria-label="Search"
          className="w-14 h-14 flex items-center justify-center bg-white/10 border border-white/20 rounded-2xl text-white hover:bg-white/20 active:scale-95 transition-all shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
        >
          <Search size={18} />
        </button>

        <button
          onClick={onClose}
          aria-label="Close"
          className="w-14 h-14 flex items-center justify-center bg-white/10 border border-white/20 rounded-2xl text-white/70 hover:bg-white/20 active:scale-95 transition-all shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
        >
          <X size={20} />
        </button>
      </div>

      {/* Results list */}
      <div className="flex-1 overflow-y-auto px-6 pb-6" style={{ scrollbarWidth: 'none' }}>
        {isSearching && candidates.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-white/40">
            <Loader2 size={36} className="animate-spin" />
            <p className="text-base">Searching...</p>
          </div>
        ) : candidates.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-white/40">
            <Music2 size={48} />
            <p className="text-base">No results — try a different search</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {candidates.map((c) => {
              const isSelected = c.id === selectedId;
              const isRecommended = c.id === recommendedId;
              return (
                <button
                  key={c.id}
                  onClick={() => onSelect(c)}
                  className={[
                    'w-full text-left flex items-center gap-4 border rounded-2xl px-5 py-4 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60',
                    isSelected
                      ? 'bg-white/20 border-white/40'
                      : 'bg-white/5 hover:bg-white/15 active:bg-white/20 border-white/10',
                  ].join(' ')}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-semibold truncate">{c.trackName}</p>
                    <p className="text-white/55 text-sm truncate">{c.artistName} · {c.albumName}</p>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2 shrink-0 max-w-[40%] sm:max-w-none">
                    <span className="flex items-center gap-1 text-white/40 text-xs tabular-nums">
                      <Clock size={11} />
                      {formatDuration(c.durationSec)}
                    </span>
                    {isRecommended && (
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full border bg-blue-500/20 text-blue-300 border-blue-500/30">
                        Best match
                      </span>
                    )}
                    <span className={[
                      'text-xs font-medium px-2 py-0.5 rounded-full border',
                      c.isSynced
                        ? 'bg-green-500/20 text-green-400 border-green-500/30'
                        : 'bg-white/10 text-white/40 border-white/20',
                    ].join(' ')}>
                      {c.isSynced ? 'Synced' : 'Plain'}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
      </div>
    </div>
  );
}
