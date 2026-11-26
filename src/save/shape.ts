// Small runtime shape checks for loaded JSON. Each helper takes the value and a
// readable path ("party[0].stats.hp") and throws ShapeError with a plain message.

export class ShapeError extends Error {
  constructor(path: string, problem: string) {
    super(path ? `${path}: ${problem}` : problem);
    this.name = 'ShapeError';
  }
}

export type Obj = Record<string, unknown>;

export function describe(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'a list';
  if (typeof v === 'string') return `"${v.length > 24 ? `${v.slice(0, 24)}...` : v}"`;
  if (typeof v === 'object') return 'an object';
  return String(v);
}

export function obj(v: unknown, path: string): Obj {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new ShapeError(path, `expected an object, found ${describe(v)}`);
  return v as Obj;
}

/** An object with exactly these keys (optional ones may be absent). */
export function exactObj(v: unknown, path: string, keys: readonly string[], optional: readonly string[] = []): Obj {
  const o = obj(v, path);
  for (const k of keys) if (!(k in o)) throw new ShapeError(join(path, k), 'missing');
  for (const k of Object.keys(o)) {
    if (!keys.includes(k) && !optional.includes(k)) throw new ShapeError(join(path, k), 'not a known field');
  }
  return o;
}

export function arr(v: unknown, path: string): unknown[] {
  if (!Array.isArray(v)) throw new ShapeError(path, `expected a list, found ${describe(v)}`);
  return v;
}

export function str(v: unknown, path: string): string {
  if (typeof v !== 'string') throw new ShapeError(path, `expected text, found ${describe(v)}`);
  return v;
}

export function bool(v: unknown, path: string): boolean {
  if (typeof v !== 'boolean') throw new ShapeError(path, `expected true or false, found ${describe(v)}`);
  return v;
}

export function int(v: unknown, path: string, min = -Infinity, max = Infinity): number {
  if (typeof v !== 'number' || !Number.isInteger(v)) throw new ShapeError(path, `expected a whole number, found ${describe(v)}`);
  if (v < min || v > max) throw new ShapeError(path, `${v} is out of range (${min} to ${max})`);
  return v;
}

export function oneOf<T extends string | number>(v: unknown, path: string, allowed: readonly T[]): T {
  const found = allowed.find((a) => a === v);
  if (found === undefined) throw new ShapeError(path, `expected one of ${allowed.join(', ')}, found ${describe(v)}`);
  return found;
}

export function join(path: string, key: string | number): string {
  if (typeof key === 'number') return `${path}[${key}]`;
  return path ? `${path}.${key}` : key;
}
