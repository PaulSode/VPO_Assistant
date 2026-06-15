/**
 * Parse a pasted/exported ticket conversation into discrete messages.
 *
 * Targets the common export shape, e.g.:
 *
 *   AB                       ← avatar initials (ignored)
 *   Abdennour BELHADDAD      ← author
 *   03/04/2026 14:19:41      ← timestamp
 *   Bonjour, ...             ← body (until the next author/timestamp block)
 *
 * The parser is forgiving: it keys off timestamp lines, takes the preceding
 * non-empty line as the author, and everything up to the next block as the body.
 *
 * It also supports exports where the message body appears before the author
 * and timestamp block:
 *
 *   Bonjour, ...
 *   Paul SODE
 *   11/06/2026 14:42:22
 */

export interface ParsedMessage {
  authorName: string;
  /** ISO string, or null if the date couldn't be parsed. */
  at: string | null;
  body: string;
}

// DD/MM/YYYY HH:MM(:SS)?  — the seconds are optional.
const TIMESTAMP = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/;
// Standalone avatar initials (uppercase, 1-3 letters), e.g. "AB", "HB".
const INITIALS = /^[A-ZÀ-Ý]{1,3}$/;

interface Header {
  authorIdx: number;
  tsIdx: number;
  at: string | null;
}

export function parseConversation(raw: string): ParsedMessage[] {
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  // Drop standalone avatar-initials lines; keep everything else (incl. blanks).
  const cleaned = lines.filter((l) => !INITIALS.test(l.trim()));

  // Locate headers: a timestamp line with a non-empty author line above it.
  const headers: Header[] = [];
  for (let i = 1; i < cleaned.length; i++) {
    const m = cleaned[i]!.trim().match(TIMESTAMP);
    if (!m) continue;

    let a = i - 1;
    while (a >= 0 && cleaned[a]!.trim() === '') a--;
    if (a < 0) continue;

    const [, dd, mm, yyyy, hh, min, ss] = m;
    const d = new Date(
      Number(yyyy),
      Number(mm) - 1,
      Number(dd),
      Number(hh),
      Number(min),
      Number(ss ?? '0'),
    );

    headers.push({
      authorIdx: a,
      tsIdx: i,
      at: isNaN(d.getTime()) ? null : d.toISOString(),
    });
  }

  if (headers.length === 0) return [];

  // Raw lines sitting after a header's timestamp, up to the next header's author.
  const gapLines = (i: number): string[] => {
    const start = headers[i]!.tsIdx + 1;
    const end = i + 1 < headers.length ? headers[i + 1]!.authorIdx : cleaned.length;
    return cleaned.slice(start, end);
  };
  const hasText = (ls: string[]): boolean => ls.some((l) => l.trim() !== '');

  // A header is "body-before" (the current-user export format) when there is no
  // text after its own timestamp — its body sits BEFORE its name instead:
  //
  //   BODY            ← belongs to the header below
  //   AUTHOR
  //   TIMESTAMP
  //
  // Other authors are "body-after" (text follows the timestamp).
  const bodyBefore = headers.map((_, i) => !hasText(gapLines(i)));

  // Resolve each message's body. A single gap can hold BOTH the previous
  // (body-after) message's tail AND the next (body-before) message's lead, so we
  // split it at the largest blank-line run to avoid assigning the same text to
  // two messages (the merged-duplicate bug).
  const bodies: string[] = headers.map(() => '');
  for (let i = 0; i < headers.length; i++) {
    const gap = gapLines(i);
    if (i + 1 < headers.length && bodyBefore[i + 1]) {
      const [head, tail] = splitAtLargestBlankRun(gap);
      if (!bodyBefore[i]) bodies[i] = head.join('\n').trim();
      bodies[i + 1] = tail.join('\n').trim();
    } else if (!bodyBefore[i]) {
      bodies[i] = gap.join('\n').trim();
    }
  }

  // The very first header may itself be body-before (text precedes its name).
  if (bodyBefore[0]) {
    const pre = cleaned.slice(0, headers[0]!.authorIdx);
    if (hasText(pre)) bodies[0] = pre.join('\n').trim();
  }

  const messages: ParsedMessage[] = [];
  for (let i = 0; i < headers.length; i++) {
    const authorName = cleaned[headers[i]!.authorIdx]!.trim();
    if (!authorName) continue;
    messages.push({ authorName, at: headers[i]!.at, body: bodies[i]! });
  }
  return messages;
}

/**
 * Split lines into [before, after] at the largest run of blank lines (≥ 2),
 * used as the boundary between two messages glued together in one gap. A single
 * blank line is treated as an in-message paragraph break, not a boundary.
 * Returns [allLines, []] when there is no clear separator.
 */
function splitAtLargestBlankRun(lines: string[]): [string[], string[]] {
  let best = { start: -1, len: 0 };
  let j = 0;
  while (j < lines.length) {
    if (lines[j]!.trim() === '') {
      let k = j;
      while (k < lines.length && lines[k]!.trim() === '') k++;
      if (k - j > best.len) best = { start: j, len: k - j };
      j = k;
    } else {
      j++;
    }
  }
  if (best.len >= 2 && best.start > 0) {
    return [lines.slice(0, best.start), lines.slice(best.start + best.len)];
  }
  return [lines, []];
}

/** Distinct author names, in first-seen order. */
export function distinctAuthors(messages: ParsedMessage[]): string[] {
  const seen: string[] = [];
  for (const m of messages) {
    if (!seen.includes(m.authorName)) seen.push(m.authorName);
  }
  return seen;
}