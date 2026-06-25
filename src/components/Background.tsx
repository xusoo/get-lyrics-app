import { Music2 } from 'lucide-react';
import type { SpotifyImage } from '../types';

interface BackgroundProps {
  images: SpotifyImage[];
}

export function Background({ images }: BackgroundProps) {
  // Prefer the smallest image that is still at least 200px wide to avoid needlessly
  // loading the full-resolution artwork (the blurred background never needs it).
  const sorted = [...images].sort((a, b) => (a.width ?? 0) - (b.width ?? 0));
  const img = sorted.find((i) => (i.width ?? 0) >= 500) ?? sorted[0];

  return (
    <div className="absolute inset-0 -z-10 overflow-hidden">
      <div className="absolute inset-0 bg-neutral-950" />
      {img ? (
        <img
          key={img.url}
          src={img.url}
          alt=""
          aria-hidden
          className="absolute inset-0 w-full h-full object-cover scale-105 brightness-[0.35] transition-opacity duration-700 opacity-100"
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
