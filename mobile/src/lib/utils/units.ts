// Pure conversion helpers between US (ft/in, lb) and metric (cm, kg).
// Canonical storage in the DB is metric (cm, kg). The UI may render either
// system but always saves the metric value.

export interface FeetInches {
  feet: number;
  inches: number;
}

/**
 * Convert centimeters to feet and inches. Inches are rounded to the nearest
 * integer; if rounding pushes inches to 12 it carries over into feet.
 */
export function cmToFtIn(cm: number): FeetInches {
  if (!Number.isFinite(cm) || cm <= 0) return { feet: 0, inches: 0 };
  const totalInches = cm / 2.54;
  let feet = Math.floor(totalInches / 12);
  let inches = Math.round(totalInches - feet * 12);
  if (inches === 12) {
    feet += 1;
    inches = 0;
  }
  return { feet, inches };
}

/**
 * Convert feet + inches to centimeters (rounded to int).
 */
export function ftInToCm(feet: number, inches: number): number {
  const f = Number.isFinite(feet) ? feet : 0;
  const i = Number.isFinite(inches) ? inches : 0;
  const totalInches = f * 12 + i;
  return Math.round(totalInches * 2.54);
}

/**
 * Convert kilograms to pounds (rounded to int).
 */
export function kgToLb(kg: number): number {
  if (!Number.isFinite(kg) || kg <= 0) return 0;
  return Math.round(kg * 2.2046226218);
}

/**
 * Convert pounds to kilograms (kept to 2 decimal places).
 */
export function lbToKg(lb: number): number {
  if (!Number.isFinite(lb) || lb <= 0) return 0;
  return Math.round((lb / 2.2046226218) * 100) / 100;
}
