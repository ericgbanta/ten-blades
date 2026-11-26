import assets from './assets.json';

export interface Manifest {
  images: Record<string, string>;
}

const manifest: Manifest = assets;

/** Resolve an image id to a URL, or undefined when the art is missing (draw a placeholder). */
export function imageUrl(id: string): string | undefined {
  const path = manifest.images[id];
  if (!path) return undefined;
  return `${import.meta.env.BASE_URL}${path.replace(/^\//, '')}`;
}
