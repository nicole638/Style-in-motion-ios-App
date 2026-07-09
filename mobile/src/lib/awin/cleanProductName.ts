export function cleanProductName(name: string | null | undefined): string {
  if (!name) return "";
  return name
    .replace(/\s+-\s+[A-Z0-9][A-Z0-9 ]{0,11}\s*\/\s*[A-Za-z0-9 ]+\s*$/, "")
    .trim();
}

export function cleanBrandLabel(brand: string | null | undefined, fallback?: string | null): string {
  const raw = (brand ?? fallback ?? "").trim();
  if (!raw) return "";
  // Take the first comma-separated chunk (Awin feeds sometimes ship "Bolsa Nova, Florence Leather 1")
  const firstChunk = raw.split(",")[0].trim();
  return firstChunk;
}
