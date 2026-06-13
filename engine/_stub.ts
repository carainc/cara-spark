/** Stub marker — every unported engine symbol throws this until T1 (the VA-5 port). */
export function notImplemented(symbol: string): never {
  throw new Error(`NotImplemented: ${symbol} — ported from VA-5 in T1 (engine).`);
}
