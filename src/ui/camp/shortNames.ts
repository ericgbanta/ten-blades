// Short labels for party members in tight spots (the merchant's who-can-use pips): the first letter, or as many
// letters as it takes to tell two names apart (up to three). Pure.

export function shortNames(names: readonly string[]): string[] {
  const clean = names.map((n) => n.trim());
  return clean.map((name, i) => {
    for (let len = 1; len < 3; len++) {
      const mine = name.slice(0, len).toLowerCase();
      if (!clean.some((other, j) => j !== i && other.slice(0, len).toLowerCase() === mine)) return cap(name.slice(0, len));
    }
    return cap(name.slice(0, 3));
  });
}

const cap = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : '?');
