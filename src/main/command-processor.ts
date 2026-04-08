// Transforms raw transcript text: punctuation keywords → symbols, caps modes.

const PUNCT_MAP: Record<string, string> = {
  'period':             '.',
  'full stop':          '.',
  'comma':              ',',
  'exclamation mark':   '!',
  'exclamation point':  '!',
  'question mark':      '?',
  'open paren':         '(',
  'open parenthesis':   '(',
  'close paren':        ')',
  'closed paren':       ')',
  'close parenthesis':  ')',
  'open bracket':       '[',
  'close bracket':      ']',
  'colon':              ':',
  'semicolon':          ';',
  'hyphen':             '-',
  'dash':               '-',
  'ellipsis':           '...',
  'new line':           '\n',
  'new paragraph':      '\n\n',
};

// Build regex once — longest phrases first to avoid partial matches
const PUNCT_PATTERN = new RegExp(
  `\\b(${Object.keys(PUNCT_MAP)
    .sort((a, b) => b.length - a.length)
    .join('|')})\\b`,
  'gi',
);

export function applyPunctuation(text: string): string {
  return text.replace(PUNCT_PATTERN, (m) => PUNCT_MAP[m.toLowerCase()] ?? m);
}

/**
 * Final text transform applied just before injection.
 * @param text      Raw transcript (wake word + stop command already removed)
 * @param allCaps   Whether ALL CAPS mode is active
 * @param capsThat  Whether "all caps that" was detected (uppercase this segment only)
 */
export function buildInsertionText(text: string, allCaps: boolean, capsThat: boolean): string {
  let out = text.trim();
  if (!out) return '';

  out = applyPunctuation(out);

  if (capsThat || allCaps) {
    out = out.toUpperCase();
  }

  return out;
}
