import {
  collectRecallItems,
  createRecallMessage,
  extractNeedles,
} from './src/recall.mjs';

const attemptedSessions = new WeakSet();

function userText(messages) {
  if (!Array.isArray(messages)) return '';
  for (const message of messages) {
    if (message?.role !== 'user' || !Array.isArray(message.content)) continue;
    const text = message.content
      .filter((part) => part?.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text)
      .join('\n')
      .trim();
    if (text) return text;
  }
  return '';
}

function isRootHeader(header) {
  return Boolean(
    header
    && header.parentSession == null
    && header.origin !== 'subagent'
    && header.delegationDepth === 0
    && header.isSeeded !== true,
  );
}

async function maybeRecall(ctx, agent, payload, decision) {
  if (payload?.step !== 1 || payload?.signal?.aborted) return decision;
  if (!decision || decision.kind !== 'enter' || !Array.isArray(decision.messages)) return decision;

  const session = agent?.session;
  const header = session?.header;
  if (!session || !isRootHeader(header)) return decision;

  const text = userText(payload.messages);
  if (!text) return decision;

  if (attemptedSessions.has(session)) return decision;

  let priorEvents;
  try {
    priorEvents = session.snapshotEvents();
  } catch {
    return decision;
  }
  if (!Array.isArray(priorEvents)) return decision;
  if (priorEvents.some((event) => event?.type === 'user/message')) {
    attemptedSessions.add(session);
    return decision;
  }

  const needles = extractNeedles(text);
  if (needles.length === 0) {
    attemptedSessions.add(session);
    return decision;
  }

  let sessionQuery;
  try {
    sessionQuery = ctx.sessionQuery;
  } catch {
    return decision;
  }
  if (!sessionQuery) return decision;

  attemptedSessions.add(session);

  const items = await collectRecallItems({
    sessionQuery,
    cwd: header.cwd,
    currentSessionId: header.id,
    needles,
    signal: payload.signal,
  });

  if (items.length === 0 || payload.signal?.aborted) return decision;
  return {
    ...decision,
    messages: [createRecallMessage(items), ...decision.messages],
  };
}

/**
 * DSH Host plugin entry.
 *
 * The first capability reads literal hits from earlier root sessions in the
 * same workspace and injects one user-role message at the start of a new
 * session's first step.
 */
export function apply(ctx, _config) {
  if (!ctx || typeof ctx.on !== 'function') return;

  ctx.on('agent/created', ({ agent } = {}) => {
    if (!agent?.ctx || typeof agent.ctx.on !== 'function') return;

    const register = () => agent.ctx.on(
      'agent/pre-step',
      async (payload, next) => {
        const decision = await next();
        return maybeRecall(ctx, agent, payload, decision);
      },
      { prepend: true },
    );

    if (typeof agent.ctx.effect === 'function') agent.ctx.effect(register);
    else register();
  });
}
