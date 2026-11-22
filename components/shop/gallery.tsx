'use client';

import { ImageOff } from 'lucide-react';
import { useState } from 'react';
import { mediaUrl } from '@/lib/api';

/** Product photos: hover to zoom, thumbnails to switch. */
export function Gallery({ images, name }: { images: { url: string; alt: string }[]; name: string }) {
  const [i, setI] = useState(0);
  const [zoom, setZoom] = useState<{ x: number; y: number } | null>(null);
  if (images.length === 0) {
    return <div className="flex aspect-square items-center justify-center rounded-3xl bg-slate-100 text-slate-400"><ImageOff aria-label="No photo" /></div>;
  }
  const current = images[Math.min(i, images.length - 1)];
  return (
    <div>
      <div
        className="relative aspect-square cursor-zoom-in overflow-hidden rounded-3xl bg-slate-100"
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setZoom({ x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 });
        }}
        onMouseLeave={() => setZoom(null)}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={mediaUrl(current.url)} alt={current.alt || name} className="h-full w-full object-cover transition-transform duration-200" style={zoom ? { transform: 'scale(1.8)', transformOrigin: `${zoom.x}% ${zoom.y}%` } : undefined} />
      </div>
      {images.length > 1 && (
        <ul className="mt-3 grid grid-cols-5 gap-2">
          {images.map((img, k) => (
            <li key={img.url}>
              <button type="button" onClick={() => setI(k)} aria-label={`Show photo ${k + 1}`} aria-current={k === i} className={`block aspect-square w-full overflow-hidden rounded-xl border-2 transition-colors ${k === i ? 'border-accent' : 'border-transparent opacity-70 hover:opacity-100'}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={mediaUrl(img.url)} alt="" className="h-full w-full object-cover" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
