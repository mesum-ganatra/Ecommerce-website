'use client';

import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, ImagePlus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { mediaUrl } from '@/lib/api';
import { Badge, Spinner } from './ui';

export interface ImageItem {
  url: string; // server url, or a blob: preview for a queued file
  alt: string;
  file?: File; // set while the product is not saved yet
}

function Tile({ img, index, onAlt, onRemove }: { img: ImageItem; index: number; onAlt: (v: string) => void; onRemove: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: img.url });
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={`relative rounded-xl border border-slate-200 bg-surface p-2 ${isDragging ? 'z-10 shadow-xl' : ''}`}>
      <div className="relative">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={img.file ? img.url : mediaUrl(img.url)} alt={img.alt || `Photo ${index + 1}`} className="aspect-square w-full rounded-lg object-cover" draggable={false} />
        <button type="button" {...listeners} {...attributes} aria-label={`Drag to reorder photo ${index + 1}`} className="absolute left-1.5 top-1.5 cursor-grab touch-none rounded-md bg-black/55 p-1 text-white backdrop-blur active:cursor-grabbing"><GripVertical size={14} /></button>
        <button type="button" onClick={onRemove} aria-label={`Remove photo ${index + 1}`} className="absolute right-1.5 top-1.5 rounded-md bg-black/55 p-1 text-white backdrop-blur hover:bg-red-600"><Trash2 size={14} /></button>
        {index === 0 && <span className="absolute bottom-1.5 left-1.5"><Badge tone="info">Main photo</Badge></span>}
      </div>
      <input aria-label={`Description of photo ${index + 1}`} className="mt-2 w-full rounded-md border border-slate-200 bg-surface px-2 py-1 text-xs outline-none focus:border-brand-500" placeholder="Describe the photo" value={img.alt} onChange={(e) => onAlt(e.target.value)} />
    </li>
  );
}

/** Photos: drop files anywhere on the box, drag the grips to reorder, the first photo is the main one. */
export function ImageManager({ images, setImages, onFiles, uploading, max = 10 }: { images: ImageItem[]; setImages: (fn: (prev: ImageItem[]) => ImageItem[]) => void; onFiles: (files: FileList | File[]) => void; uploading: boolean; max?: number }) {
  const [over, setOver] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  function onDragEnd(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return;
    setImages((prev) => arrayMove(prev, prev.findIndex((i) => i.url === e.active.id), prev.findIndex((i) => i.url === e.over!.id)));
  }

  return (
    <div
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { if (e.dataTransfer.files.length) { e.preventDefault(); setOver(false); onFiles(e.dataTransfer.files); } }}
      className={`rounded-xl border-2 border-dashed p-4 transition-colors ${over ? 'border-brand-500 bg-brand-50' : 'border-slate-200'}`}
    >
      {images.length > 0 && (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={images.map((i) => i.url)} strategy={rectSortingStrategy}>
            <ul className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {images.map((img, i) => (
                <Tile key={img.url} img={img} index={i} onAlt={(v) => setImages((p) => p.map((x, k) => (k === i ? { ...x, alt: v } : x)))} onRemove={() => setImages((p) => p.filter((_, k) => k !== i))} />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}
      <div className="flex flex-col items-center gap-2 py-2 text-center text-sm text-slate-500">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-500">{uploading ? <Spinner /> : <ImagePlus size={18} />}</span>
        <span>{uploading ? 'Uploading…' : 'Drop photos here, or'}</span>
        <input id="photo-input" type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" onChange={(e) => { if (e.target.files) onFiles(e.target.files); e.target.value = ''; }} />
        <label htmlFor="photo-input" className={`inline-flex cursor-pointer items-center rounded-lg border border-slate-300 bg-surface px-3.5 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 ${uploading || images.length >= max ? 'pointer-events-none opacity-50' : ''}`}>Choose photos</label>
        <span className="text-xs">JPEG, PNG or WebP, up to 4 MB each ({images.length}/{max})</span>
      </div>
    </div>
  );
}
