// packages/http/src/_text.ts

/**
 * Truncate `text` to at most `maxCodePoints` Unicode code points, appending
 * an ellipsis when anything was cut.
 *
 * Works by code point rather than UTF-16 unit so a surrogate pair on the
 * boundary is dropped whole instead of leaving a lone surrogate. Walks the
 * string with an iterator and stops at the cap, so a multi-megabyte error
 * body costs O(cap) work and allocation rather than an array of every
 * character in the body.
 */
export function truncateByCodePoint(text: string, maxCodePoints: number): string {
  // A string of N UTF-16 units has at most N code points, so short strings
  // need no walk at all.
  if (text.length <= maxCodePoints) {
    return text;
  }
  let kept = '';
  let count = 0;
  for (const codePoint of text) {
    if (count === maxCodePoints) {
      return `${kept}…`;
    }
    kept += codePoint;
    count += 1;
  }
  return kept;
}
