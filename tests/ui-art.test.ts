import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { STAT_KEYS, type School, type Unit } from '../src/core';
import { WEAPON_ICON, portraitId, schoolIcon, weaponIcon } from '../src/ui/artMap';
import classes from '../src/data/classes.json';
import weapons from '../src/data/weapons.json';
import prologue from '../src/data/maps/prologue.json';

const images = JSON.parse(readFileSync(join(__dirname, '..', 'src', 'art', 'assets.json'), 'utf8')).images as Record<
  string,
  { width: number; height: number; slice?: number[]; hole?: number[] }
>;

const MC_STYLES = ['vanguard', 'duelist', 'spiritblade'];

describe('UI art', () => {
  it('has an icon for every stat and every school', () => {
    for (const k of STAT_KEYS) expect(images[`icon.${k}`], k).toBeDefined();
    for (const s of ['heavy', 'swift', 'arcane'] as School[]) expect(images[`icon.${schoolIcon(s)}`], s).toBeDefined();
    expect(schoolIcon('none')).toBeNull();
  });

  it('gives every weapon in the data an icon that exists', () => {
    for (const [id, w] of Object.entries(weapons)) {
      const icon = weaponIcon(w as { kind: string; school: School });
      expect(images[`icon.${icon}`], `${id} -> ${icon}`).toBeDefined();
    }
    for (const icon of Object.values(WEAPON_ICON)) expect(images[`icon.${icon}`]).toBeDefined();
  });

  it('maps weapon kinds as chosen, legendary blades to the ten-blade star', () => {
    expect(weaponIcon({ kind: 'katana', school: 'swift' })).toBe('sabre');
    expect(weaponIcon({ kind: 'legendary', school: 'heavy' })).toBe('tenblade');
    expect(weaponIcon({ kind: 'warhammer', school: 'heavy' })).toBe('greatsword');
  });

  it('gives every class a portrait, except the main character styles (composed at runtime)', () => {
    for (const classId of Object.keys(classes)) {
      const pid = portraitId({ id: 'someone', classId } as Unit);
      if (MC_STYLES.includes(classId)) expect(pid, classId).toBeNull();
      else expect(pid && images[pid], classId).toBeTruthy();
    }
  });

  it('finds the portraits of the units on the prologue map', () => {
    for (const p of prologue.placements) {
      if (p.kind !== 'unit') continue;
      const u = p as { id: string; classId: string };
      expect(portraitId(u as Unit), u.id).toMatch(/^portrait\.[a-z]+\.neutral$/);
    }
    expect(portraitId({ id: 'stranger', classId: 'wanderer' } as Unit)).toBe('portrait.stranger.neutral');
  });

  it('carries 9-slice data that fits each kit image', () => {
    for (const id of ['ui.frame', 'ui.button', 'ui.button_primary', 'ui.ribbon']) {
      const e = images[id]!;
      expect(e.slice, id).toHaveLength(4);
      const [t, r, b, l] = e.slice!;
      expect(t! + b!).toBeLessThan(e.height);
      expect(l! + r!).toBeLessThan(e.width);
    }
    const m = images['ui.medallion']!;
    expect(m.hole![2]).toBeGreaterThan(m.width / 4);
    expect(m.hole![2]).toBeLessThan(m.width / 2);
  });
});
