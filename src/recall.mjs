import { randomUUID } from 'node:crypto';

export const MAX_NEEDLES = 4;
export const MAX_ITEMS = 3;
export const MAX_ITEM_BYTES = 512;
export const MAX_TOTAL_BYTES = 1536;
export const MAX_CANDIDATES = 12;
export const RECALL_HEADER = '来自旧会话的字面命中，不是当前会话内容。';

const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/gu;
const WINDOWS_PATH_PATTERN = /[A-Za-z]:\\[^\s<>"'`|]+/gu;
const RELATIVE_PATH_PATTERN = /(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9._~/-]{2,}/gu;
const CODE_PATTERN = /[A-Za-z_][A-Za-z0-9_.-]{2,}/g;
const CJK_PATTERN = /[\u3400-\u9fff]{3,}/gu;

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'this', 'that', 'from', 'are', 'was', 'were',
  'you', 'have', 'not', 'but', 'can', 'all', 'any', 'our', 'out', 'get',
  'use', 'new', 'now', 'see', 'how', 'why', 'what', 'when', 'where', 'which',
  'who', 'will', 'would', 'should', 'could', 'does', 'doing', 'into', 'over',
  'under', 'again', 'then', 'than', 'them', 'they', 'their', 'there', 'here',
  'about', 'after', 'before', 'because', 'while', 'also', 'just', 'only',
  'very', 'more', 'most', 'some', 'such', 'each', 'other',
]);

function maskSpans(text, spans) {
  if (spans.length === 0) return text;
  const ordered = [...spans].sort((left, right) => left.index - right.index);
  let result = '';
  let cursor = 0;
  for (const span of ordered) {
    if (span.index < cursor) continue;
    result += text.slice(cursor, span.index);
    result += ' '.repeat(span.length);
    cursor = span.index + span.length;
  }
  return result + text.slice(cursor);
}

function collectSpans(text, pattern, priority) {
  const spans = [];
  for (const match of text.matchAll(pattern)) {
    const raw = match[0];
    const value = raw.replace(/[.,;:!?)\]}]+$/u, '');
    if (value.length < 3) continue;
    spans.push({ value, index: match.index, length: raw.length, priority });
  }
  return spans;
}

export function extractNeedles(text, max = MAX_NEEDLES) {
  if (typeof text !== 'string' || text.trim() === '' || max <= 0) return [];

  let working = text;
  const found = [];

  for (const [pattern, priority] of [
    [URL_PATTERN, 0],
    [WINDOWS_PATH_PATTERN, 1],
    [RELATIVE_PATH_PATTERN, 1],
  ]) {
    const spans = collectSpans(working, pattern, priority);
    found.push(...spans);
    working = maskSpans(working, spans);
  }

  for (const [pattern, priority] of [
    [CODE_PATTERN, 2],
    [CJK_PATTERN, 3],
  ]) {
    const spans = collectSpans(working, pattern, priority);
    found.push(...spans);
    working = maskSpans(working, spans);
  }

  found.sort((left, right) => left.priority - right.priority || left.index - right.index);

  const needles = [];
  const seen = new Set();
  for (const span of found) {
    const value = span.value.trim();
    if (!value || (span.priority >= 2 && STOPWORDS.has(value.toLowerCase()))) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    needles.push(value);
    if (needles.length >= max) break;
  }
  return needles;
}

export function truncateUtf8(text, maxBytes = MAX_ITEM_BYTES) {
  if (typeof text !== 'string' || !Number.isFinite(maxBytes) || maxBytes <= 0) return '';
  if (Buffer.byteLength(text) <= maxBytes) return text;

  let result = '';
  let bytes = 0;
  for (const character of text) {
    const size = Buffer.byteLength(character);
    if (bytes + size > maxBytes) break;
    result += character;
    bytes += size;
  }
  return result;
}

export function buildRecallText(items) {
  if (!Array.isArray(items) || items.length === 0 || items.length > MAX_ITEMS) {
    throw new RangeError(`items must contain 1..${MAX_ITEMS} entries`);
  }

  const lines = [RECALL_HEADER];
  for (const item of items) {
    const text = truncateUtf8(String(item.text ?? ''), MAX_ITEM_BYTES)
      .replace(/\s+/gu, ' ')
      .trim();
    if (!text) continue;
    lines.push(`- ${item.sessionId}#${item.seq}：${text}`);
  }
  return lines.join('\n');
}

export function buildRecallSource(items) {
  return {
    kind: 'dsh-agent-man',
    version: 1,
    items: items.map((item) => ({
      sessionId: item.sessionId,
      seq: item.seq,
      bytes: Buffer.byteLength(item.text),
    })),
  };
}

export function createRecallMessage(items) {
  return {
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text: buildRecallText(items) }],
    source: buildRecallSource(items),
  };
}

export function pickRecallEvent(events) {
  if (!Array.isArray(events)) return null;
  const ordered = [...events].sort((left, right) => (left?.seq ?? 0) - (right?.seq ?? 0));
  let assistant = null;
  let user = null;
  for (const event of ordered) {
    if (typeof event?.text !== 'string' || event.text.length === 0) continue;
    if (event.type === 'assistant/message') assistant = event;
    else if (event.type === 'user/message') user = event;
  }
  const picked = assistant ?? user;
  if (!picked) return null;
  return { sessionId: picked.sessionId, seq: picked.seq, text: picked.text };
}

export async function collectRecallItems({
  sessionQuery,
  cwd,
  currentSessionId,
  needles,
  signal,
  maxCandidates = MAX_CANDIDATES,
} = {}) {
  if (
    !sessionQuery ||
    typeof sessionQuery.filterSessions !== 'function' ||
    typeof sessionQuery.filterEvents !== 'function' ||
    typeof cwd !== 'string' ||
    !Array.isArray(needles) ||
    needles.length === 0 ||
    signal?.aborted
  ) {
    return [];
  }

  let candidates;
  try {
    candidates = await sessionQuery.filterSessions([
      { kind: 'cwd', values: [cwd] },
      { kind: 'parent', values: [null] },
      { kind: 'availability', values: ['live', 'persisted'] },
    ]);
  } catch {
    return [];
  }
  if (!Array.isArray(candidates)) return [];

  const seen = new Set();
  const ordered = candidates
    .filter((candidate) => candidate?.header?.id && candidate.header.id !== currentSessionId)
    .sort((left, right) => (right.header.createdAt ?? 0) - (left.header.createdAt ?? 0))
    .filter((candidate) => {
      if (seen.has(candidate.header.id)) return false;
      seen.add(candidate.header.id);
      return true;
    })
    .slice(0, Math.max(0, maxCandidates));

  const items = [];
  let totalBytes = 0;

  for (const candidate of ordered) {
    if (signal?.aborted || items.length >= MAX_ITEMS) break;
    const sessionId = candidate.header.id;
    let events = [];

    for (const needle of needles) {
      if (signal?.aborted) break;
      try {
        const result = await sessionQuery.filterEvents(sessionId, [
          { kind: 'type', values: ['user/message', 'assistant/message'] },
          { kind: 'text', text: needle },
        ]);
        if (Array.isArray(result) && result.length > 0) {
          events = result;
          break;
        }
      } catch {
        events = [];
        break;
      }
    }

    if (events.length === 0) continue;
    const picked = pickRecallEvent(events);
    if (!picked || !picked.text) continue;

    let text = truncateUtf8(String(picked.text), MAX_ITEM_BYTES);
    const remaining = MAX_TOTAL_BYTES - totalBytes;
    if (remaining <= 0) break;
    if (Buffer.byteLength(text) > remaining) text = truncateUtf8(text, remaining);
    if (!text) break;

    items.push({ sessionId, seq: picked.seq, text });
    totalBytes += Buffer.byteLength(text);
  }

  return items;
}
