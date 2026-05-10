export function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}

export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
}

export function unique<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}
