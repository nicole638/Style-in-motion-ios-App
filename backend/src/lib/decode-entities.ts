// Decode `&amp;` last so chained entities like `&amp;#39;` decode correctly.
// We achieve that by running a single-pass decoder until the output is
// stable — each iteration strictly shrinks the string when it fires, so the
// loop always terminates.

const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
};

function decodeOnce(input: string): string {
  return input.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (full, ent) => {
    if (ent[0] === '#') {
      const codeStr = ent[1] === 'x' ? ent.slice(2) : ent.slice(1);
      const code = parseInt(codeStr, ent[1] === 'x' ? 16 : 10);
      if (Number.isFinite(code)) return String.fromCodePoint(code);
      return full;
    }
    return NAMED[ent.toLowerCase()] ?? full;
  });
}

export function decodeHtmlEntities(input: string | null | undefined): string {
  if (!input) return '';
  let prev = input;
  let curr = decodeOnce(prev);
  while (curr !== prev) {
    prev = curr;
    curr = decodeOnce(prev);
  }
  return curr;
}
