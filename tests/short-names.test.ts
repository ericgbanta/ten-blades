import { describe, expect, it } from 'vitest';
import { shortNames } from '../src/ui/camp/shortNames';

describe('shortNames', () => {
  it('uses one letter when it is enough, and more letters for names that share a start', () => {
    expect(shortNames(['Ysolde', 'Hask', 'Lise', 'Tobin', 'Marra'])).toEqual(['Y', 'H', 'L', 'T', 'M']);
    expect(shortNames(['Marra', 'Mara', 'Garrow', 'Gideon'])).toEqual(['Mar', 'Mar', 'Ga', 'Gi']);
    expect(shortNames(['Hask', 'Hal', 'pell'])).toEqual(['Has', 'Hal', 'P']);
    expect(shortNames([''])).toEqual(['?']);
  });
});
