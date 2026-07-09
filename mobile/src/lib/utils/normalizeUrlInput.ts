export function normalizeUrlInput(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  const match = trimmed.match(/https?:\/\//i);
  if (!match || match.index === undefined) return null;

  const sliced = trimmed.slice(match.index);
  const proto = sliced.slice(0, match[0].length).toLowerCase();
  const rest = sliced.slice(match[0].length);
  const candidate = proto + rest;

  try {
    new URL(candidate);
    return candidate;
  } catch {
    return null;
  }
}
