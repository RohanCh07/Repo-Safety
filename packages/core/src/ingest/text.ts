/** Heuristic binary detection: NUL bytes or many control characters. */
export function looksBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 8000);
  if (n === 0) return false;
  let control = 0;
  for (let i = 0; i < n; i++) {
    const b = buf[i]!;
    if (b === 0) return true;
    if (b < 7 || (b > 13 && b < 32)) control++;
  }
  return control / n > 0.1;
}

export function decodeText(buf: Buffer): string {
  let s = buf.toString("utf8");
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1); // strip BOM
  return s;
}
