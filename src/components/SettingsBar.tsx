import { Settings, Search, Rewind, FastForward } from 'lucide-react';

interface SettingsBarProps {
  offsetMs: number;
  isManuallySet: boolean;
  onOpenSettings: () => void;
  onOpenPicker: () => void;
  onAdjustOffset: (delta: number) => void;
  onResetOffset: () => void;
  flipped: boolean;
}

function IconBtn({
  onClick,
  label,
  children,
}: {
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className="w-10 h-10 sm:w-12 sm:h-12 flex items-center justify-center rounded-xl bg-black/30 backdrop-blur-md border border-white/10 hover:bg-white/20 active:scale-95 transition-all text-white/80 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
    >
      {children}
    </button>
  );
}

export function SettingsBar({ offsetMs, isManuallySet, onOpenSettings, onOpenPicker, onAdjustOffset, onResetOffset, flipped }: SettingsBarProps) {
  // Show the label whenever offset is non-zero (regardless of source)
  const showLabel = offsetMs !== 0 || isManuallySet;
  const offsetLabel = `${offsetMs > 0 ? '+' : ''}${(offsetMs / 1000).toFixed(1)}s`;

  const settingsIcon = (
    <IconBtn onClick={onOpenSettings} label="Settings">
      <Settings size={20} />
    </IconBtn>
  );

  const offsetControl = (
    <div className="relative">
      <div className="flex items-center rounded-xl overflow-hidden border border-white/10">
        <button
          onClick={() => onAdjustOffset(-500)}
          aria-label="Delay lyrics by 0.5s"
          className="w-10 h-10 sm:w-12 sm:h-12 relative flex items-center justify-center bg-black/30 backdrop-blur-md hover:bg-white/20 active:scale-95 transition-all text-white/80 hover:text-white border-r border-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
        >
          <Rewind size={14} />
        </button>
        <button
          onClick={() => onAdjustOffset(500)}
          aria-label="Advance lyrics by 0.5s"
          className="w-10 h-10 sm:w-12 sm:h-12 relative flex items-center justify-center bg-black/30 backdrop-blur-md hover:bg-white/20 active:scale-95 transition-all text-white/80 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
        >
          <FastForward size={14} />
        </button>
      </div>
      {showLabel && (
        <button
          onClick={isManuallySet ? onResetOffset : onOpenSettings}
          aria-label={isManuallySet ? 'Reset lyrics sync offset to default' : 'Open settings (offset is the global default)'}
          className="absolute top-full left-1/2 -translate-x-1/2 mt-1 text-[0.6em] tabular-nums whitespace-nowrap focus-visible:outline-none"
          style={{ color: 'rgba(255,255,255,0.55)', cursor: 'pointer' }}
        >
          {offsetLabel}{isManuallySet && ' ✕'}
        </button>
      )}
    </div>
  );

  const searchIcon = (
    <IconBtn onClick={onOpenPicker} label="Search lyrics">
      <Search size={20} />
    </IconBtn>
  );

  return (
    <div className={['fixed top-4 z-30 flex items-center gap-1.5 sm:gap-2', flipped ? 'left-4' : 'right-4'].join(' ')}>
      {flipped ? (
        <>
          {searchIcon}
          {offsetControl}
          {settingsIcon}
        </>
      ) : (
        <>
          {settingsIcon}
          {offsetControl}
          {searchIcon}
        </>
      )}
    </div>
  );
}
