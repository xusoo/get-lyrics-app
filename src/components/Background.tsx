import { Music2 } from 'lucide-react';
import type { SpotifyImage } from '../types';

interface BackgroundProps {
  images: SpotifyImage[];
}

/**
 * Blurred album-art backdrop.
 *
 * The carousel keys each panel by track id (see SongCarousel/MainView), so a
 * track change always mounts a brand-new Background instance rather than
 * changing `images` on an existing one — a fresh `<img>` shows its own image
 * immediately, with no stale image to flash from or fade out of, so no
 * cross-fade-on-src-change logic is needed here.
 */
export function Background({ images }: BackgroundProps) {
  // Prefer the smallest image that is still at least 500px wide to avoid needlessly
  // loading the full-resolution artwork (the blurred background never needs it).
  const sorted = [...images].sort((a, b) => (a.width ?? 0) - (b.width ?? 0));
  const img = sorted.find((i) => (i.width ?? 0) >= 500) ?? sorted[0];

  return (
    <div className="absolute inset-0 -z-10 overflow-hidden">
      <div className="absolute inset-0 bg-neutral-950" />
      {img ? (
        <img
          src={img.url}
          alt=""
          aria-hidden
          className="absolute inset-0 w-full h-full object-cover scale-105 brightness-[0.35]"
          style={{ filter: 'blur(var(--bg-blur, 24px))' }}
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center opacity-5">
          <Music2 size={320} className="text-white" />
        </div>
      )}
      {/* Dim overlay */}
      <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,var(--bg-dim, 0.5))' }} />
    </div>
  );
}
