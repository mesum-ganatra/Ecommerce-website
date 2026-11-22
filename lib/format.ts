/** Prices are stored as integer paisa (Rs 1 = 100 paisa). */
export const rs = (paisa: number) =>
  `Rs ${(paisa / 100).toLocaleString('en-PK', { minimumFractionDigits: paisa % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;

export const toPaisa = (rupees: string): number => Math.round(Number(rupees) * 100);
export const toRupees = (paisa?: number): string => (paisa === undefined || paisa === null ? '' : String(paisa / 100));

export function priceRange(min: number, max: number) {
  return min === max ? rs(min) : `${rs(min)} – ${rs(max)}`;
}

export function fileSize(bytes?: number) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** "Size: L, Color: Red" <-> { Size: 'L', Color: 'Red' } */
export function parseAttributes(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of text.split(',')) {
    const [k, ...rest] = part.split(':');
    const key = k?.trim();
    const value = rest.join(':').trim();
    if (key && value) out[key] = value;
  }
  return out;
}

export const formatAttributes = (a: Record<string, string> = {}) =>
  Object.entries(a)
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ');
