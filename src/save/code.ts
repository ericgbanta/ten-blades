// Save codes for moving a campaign between devices: the save's JSON as UTF-8,
// gzipped when the browser has CompressionStream, then base64.
//
//   TB1.z.<base64 of gzip(json)>   compressed
//   TB1.j.<base64 of json>         plain (no CompressionStream)
//
// Decoding also accepts bare base64 of the JSON. Uses only TextEncoder, atob,
// btoa and (Dec|C)ompressionStream, all present in browsers and Node 18+.

import { fail, ok, type CampaignSave, type Result, type SaveContext } from './format';
import { readCampaign } from './load';

const PREFIX = 'TB1.';

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(bin);
}

function fromBase64(text: string): Uint8Array | null {
  try {
    const bin = atob(text);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

export interface EncodeOptions {
  /** Default true. Ignored when the browser has no CompressionStream. */
  compress?: boolean;
}

export async function encodeSaveCode(save: CampaignSave, options: EncodeOptions = {}): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(save));
  if ((options.compress ?? true) && typeof CompressionStream === 'function') {
    try {
      return `${PREFIX}z.${toBase64(await pipe(bytes, new CompressionStream('gzip')))}`;
    } catch {
      // Fall through to the plain form.
    }
  }
  return `${PREFIX}j.${toBase64(bytes)}`;
}

/** Turn a pasted code back into JSON text, or say in plain words why not. */
export async function decodeSaveCodeText(code: string): Promise<Result<string>> {
  const clean = code.replace(/\s+/g, '');
  if (clean === '') return fail('The code is empty. Paste a save code first.');
  let body = clean;
  let compressed = false;
  if (clean.startsWith(PREFIX)) {
    const mode = clean.slice(PREFIX.length, PREFIX.length + 2);
    if (mode !== 'z.' && mode !== 'j.') return fail('This save code is from a different version of the game.');
    compressed = mode === 'z.';
    body = clean.slice(PREFIX.length + 2);
  } else if (/^TB\d+\./.test(clean)) {
    return fail('This save code is from a newer version of the game.');
  }
  let bytes = fromBase64(body);
  if (!bytes || bytes.length === 0) return fail('This is not a save code. Some characters are missing or do not belong.');
  if (compressed) {
    if (typeof DecompressionStream !== 'function') return fail('This browser cannot unpack compressed save codes.');
    try {
      bytes = await pipe(bytes, new DecompressionStream('gzip'));
    } catch {
      return fail('This save code is damaged. Copy the whole code and try again.');
    }
  }
  try {
    return ok(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return fail('This save code is damaged. Copy the whole code and try again.');
  }
}

/** Decode, migrate and validate a pasted code. */
export async function decodeSaveCode(code: string, ctx: SaveContext): Promise<Result<CampaignSave>> {
  const text = await decodeSaveCodeText(code);
  if (!text.ok) return text;
  let raw: unknown;
  try {
    raw = JSON.parse(text.value);
  } catch {
    return fail('This save code is damaged. Copy the whole code and try again.');
  }
  if (typeof raw === 'object' && raw !== null && (raw as { kind?: unknown }).kind === 'suspend') {
    return fail('This code holds a suspended battle, not a campaign save.');
  }
  return readCampaign(raw, ctx);
}
