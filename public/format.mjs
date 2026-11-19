// Unit averages can contain fractional copper; round before splitting to carry correctly.
export function splitCopper(value) {
  if (!Number.isFinite(value)) return null;
  const hundredths = Math.round(Math.abs(value) * 100);
  return [Math.floor(hundredths / 1_000_000), Math.floor(hundredths / 10_000) % 100, (hundredths % 10_000) / 100];
}

// Three significant figures, with explicit powers of 1,000. Sort using the original value.
export function compactNumber(value) {
  if (!Number.isFinite(value) || value < 0) return '—';
  if (value === 0) return '0';
  const suffixes = ['', 'k', 'M', 'B', 'T', 'P', 'E'];
  let group = Math.min(Math.max(0, Math.floor(Math.log10(value) / 3)), suffixes.length - 1);
  let scaled = Number((value / 1000 ** group).toPrecision(3));
  if (scaled >= 1000 && group < suffixes.length - 1) { group++; scaled = Number((scaled / 1000).toPrecision(3)); }
  if (scaled >= 1000) return value.toExponential(2);
  return `${scaled}${suffixes[group]}`;
}
