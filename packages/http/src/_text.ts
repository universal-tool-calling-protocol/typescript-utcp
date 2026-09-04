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

/**
 * Collapse control characters (newlines, carriage returns, ANSI escape
 * introducers, NUL) into single spaces so server-controlled text folded into
 * an error message or a log line cannot forge extra log records or terminal
 * escape sequences.
 */
export function collapseControlChars(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
}

/**
 * How much of an error response body is read at all. Error responses can come
 * from an attacker-controlled endpoint, so the read is bounded up front rather
 * than buffered in full and truncated afterwards.
 */
export const MAX_ERROR_BODY_READ_BYTES = 64 * 1024;

/**
 * Read the start of an error response body (at most MAX_ERROR_BODY_READ_BYTES),
 * release the connection, and return it cleaned and truncated to `maxChars`
 * code points. Returns '' when the body is empty or cannot be read.
 */
export async function readErrorDetail(response: Response, maxChars: number): Promise<string> {
  const body = response.body;
  if (!body) {
    return '';
  }
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let text = '';
  let bytes = 0;
  try {
    while (bytes < MAX_ERROR_BODY_READ_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } catch {
    // Whatever was read so far is still the best detail available.
  } finally {
    try {
      await reader.cancel();
    } catch {
      // ignore
    }
  }
  return truncateByCodePoint(collapseControlChars(text), maxChars);
}
