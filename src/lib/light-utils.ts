/**
 * Light conversion helpers
 * Default PAR conversion factor (lux -> μmol/m²/s) is approximate and depends on spectrum.
 * Typical white LEDs: ~0.013 - 0.020 μmol/s per lux. We use 0.0185 as a reasonable default.
 */
const DEFAULT_PAR_FACTOR = Number(process.env.LIGHT_PAR_FACTOR ?? 0.0185);

export function luxToPar(lux: number | null | undefined, factor = DEFAULT_PAR_FACTOR): number | null {
  if (lux == null) return null;
  return Number((lux * factor).toFixed(2));
}

export function parToLux(par: number | null | undefined, factor = DEFAULT_PAR_FACTOR): number | null {
  if (par == null) return null;
  return Number((par / factor).toFixed(0));
}

export { DEFAULT_PAR_FACTOR };
