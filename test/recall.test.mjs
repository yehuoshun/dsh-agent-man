import test from 'node:test';
import assert from 'node:assert/strict';
import { apply } from '../index.mjs';
import {
  MAX_CANDIDATES,
  MAX_ITEM_BYTES,
  MAX_ITEMS,
  MAX_NEEDLES,
  MAX_TOTAL_BYTES,
  buildRecallText,
  extractNeedles,
  truncateUtf8,
} from '../src/recall.mjs';

const CWD = 'E:\\DevSoftWare\\DeepSeekWorkSpace';

function header(id, overrides = {}) {
  return {
    id,
    createdAt: 1,
    cwd: CWD,
    parentSession: null,
    isSeeded: false,
    origin: 'root',
    delegationDepth: 0,
    ...overrides,
  };
}

function user(text) {
  return {
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  };
}

function hit(sessionId, seq, text, type = 'assistant/message') {
  return { sessionId, seq, type, time: seq, surface: 'model', text };
}

function makeAgent({ id = 's-current', events = [], overrides = {} } = {}) {
  const handlers = new Map();
  const agent = {
    id,
    session: {
      header: header(id, overrides),
      snapshotEvents: () => events,
    },
    ctx: {
      on(name, fn) {
        handlers.set(name, fn);
        return () => {};
      },
      effect(fn) {
        return fn();
      },
    },
  };
  return { agent, handlers };
}

function makeCtx(sessions) {
  const handlers = new Map();
  const calls = { sessions: [], events: [] };
  const sessionQuery = {
    async filterSessions(filters) {
      calls.sessions.push(filters);
      return sessions;
    },
    async filterEvents(sessionId, filters) {
      calls.events.push({ sessionId, filters });
      const session = sessions.find((candidate) => candidate.header.id === sessionId);
      if (session?.fail) throw new Error(`read failed: ${sessionId}`);
      return session?.events ?? [];
    },
  };
  const ctx = {
    __handlers: handlers,
    on(name, fn) {
      handlers.set(name, fn);
      return () => {};
    },
    get(name) {
      return name === 'sessionQuery' ? sessionQuery : undefined;
    },
  };
  return { ctx, handlers, calls };
}

function session(id, events = [], overrides = {}, extra = {}) {
  return { header: header(id, overrides), live: true, persisted: true, events, ...extra };
}

function start(ctx, agent, handlers) {
  apply(ctx);
  const onCreated = ctx.__handlers.get('agent/created');
  assert.equal(typeof onCreated, 'function', 'apply 应注册 agent/created');
  onCreated({ agent });
  const preStep = handlers.get('agent/pre-step');
  assert.equal(typeof preStep, 'function', 'agent/created 应注册 agent/pre-step');
  return preStep;
}

function run(preStep, agent, text, { step = 1, signal = new AbortController().signal } = {}) {
  const decision = { kind: 'enter', messages: [user(text), { role: 'system', content: [] }] };
  return preStep(
    { agent, messages: [user(text)], step, signal, turn: 1 },
    async () => decision,
  ).then((result) => ({ result, decision }));
}

async function inject(ctx, sessions, text, options = {}) {
  const { agent, handlers } = makeAgent(options.agent);
  const preStep = start(ctx, agent, handlers);
  return run(preStep, agent, text, options);
}

test('没有 sessionQuery 时 apply 不抛', () => {
  assert.doesNotThrow(() => apply({}, {}));
});

test('特征词去重、丢掉过短词，最多取 MAX_NEEDLES 个', () => {
  const repeated = extractNeedles('dsh-agent-man dsh-agent-man AGENT-MAN');
  assert.equal(repeated[0].toLowerCase(), 'dsh-agent-man');
  assert.equal(new Set(repeated.map((needle) => needle.toLowerCase())).size, repeated.length);
  assert.deepEqual(extractNeedles('好'), []);
  assert.equal(extractNeedles('a ab abc def ghi', 2).length, 2);
  assert.ok(extractNeedles('看看 dsh-agent-man 的 recall 实现').includes('dsh-agent-man'));
  assert.ok(extractNeedles('看看 dsh-agent-man 的 recall 实现').includes('recall'));
  assert.ok(extractNeedles('继续做跨会话回忆').some((needle) => needle.includes('跨会话回忆')));
  assert.ok(extractNeedles('a b c d e f g h i j', MAX_NEEDLES).length <= MAX_NEEDLES);

  const tech = extractNeedles('看 https://example.com/a?b=1 和 src/recall.mjs，dsh-agent-man');
  assert.ok(tech.includes('https://example.com/a?b=1'));
  assert.ok(tech.includes('src/recall.mjs'));
  assert.ok(tech.includes('dsh-agent-man'));
});

test('UTF-8 截断保留完整码点，不越过字节上限', () => {
  assert.equal(truncateUtf8('abc', MAX_ITEM_BYTES), 'abc');

  const chinese = truncateUtf8(`a${'记'.repeat(200)}`, 512);
  assert.ok(Buffer.byteLength(chinese) <= 512);
  assert.equal(chinese.at(-1), '记');
  assert.equal(chinese.length, 171);

  const emoji = truncateUtf8('😀'.repeat(200), 512);
  assert.ok(Buffer.byteLength(emoji) <= 512);
  assert.equal([...emoji].length, 128);
  assert.doesNotMatch(emoji, /\uFFFD/);
});

test('回忆正文带首行说明和每条来源', () => {
  const text = buildRecallText([
    { sessionId: 's1', seq: 3, text: '甲' },
    { sessionId: 's2', seq: 9, text: '乙' },
  ]);

  assert.match(text, /^来自旧会话的字面命中，不是当前会话内容。/);
  assert.match(text, /s1#3/);
  assert.match(text, /s2#9/);
  assert.match(text, /甲/);
  assert.match(text, /乙/);
});

test('无特征词时不动 decision', async () => {
  const { ctx, calls } = makeCtx([session('s1', [hit('s1', 1, 'dsh-agent-man')])]);
  const { result, decision } = await inject(ctx, [], '好的');

  assert.deepEqual(result, decision);
  assert.equal(calls.sessions.length, 0);
});

test('非 root 会话不读取历史', async () => {
  const cases = [
    { overrides: { origin: 'subagent', parentSession: 'p', delegationDepth: 1 } },
    { overrides: { isSeeded: true } },
  ];

  for (const { overrides } of cases) {
    const { ctx, calls } = makeCtx([session('s1', [hit('s1', 1, 'dsh-agent-man')])]);
    const { agent, handlers } = makeAgent({ overrides });
    const preStep = start(ctx, agent, handlers);
    await run(preStep, agent, '继续做 dsh-agent-man');
    assert.equal(calls.sessions.length, 0);
  }
});

test('宿主 header 不带 delegationDepth 时仍按 root 处理', async () => {
  const other = session('s-other', [hit('s-other', 1, '宿主里的旧会话')]);
  const { ctx } = makeCtx([other]);
  const { result } = await inject(ctx, [], '继续做 dsh-agent-man', {
    agent: { overrides: { delegationDepth: undefined } },
  });

  assert.match(result.messages[0].content[0].text, /宿主里的旧会话/);
});

test('非首步、已有 user/message、已中止时都不读取', async () => {
  const { ctx, calls } = makeCtx([session('s1', [hit('s1', 1, 'dsh-agent-man')])]);
  const { agent, handlers } = makeAgent();
  const preStep = start(ctx, agent, handlers);

  await run(preStep, agent, '继续做 dsh-agent-man', { step: 2 });
  await run(preStep, agent, '继续做 dsh-agent-man', {
    signal: (() => {
      const controller = new AbortController();
      controller.abort();
      return controller.signal;
    })(),
  });
  assert.equal(calls.sessions.length, 0);

  const prior = makeAgent({ events: [{ type: 'user/message', seq: 1 }] });
  const priorPreStep = start(ctx, prior.agent, prior.handlers);
  await run(priorPreStep, prior.agent, '继续做 dsh-agent-man');
  assert.equal(calls.sessions.length, 0);
});

test('跳过当前会话，取最后一条 assistant 命中', async () => {
  const current = session('s-current', [hit('s-current', 99, '不该用')]);
  const other = session('s-other', [
    hit('s-other', 1, '旧 assistant'),
    hit('s-other', 2, '中间 assistant'),
    hit('s-other', 3, '最后 assistant'),
    hit('s-other', 4, '最后 user', 'user/message'),
  ]);
  const { ctx, calls } = makeCtx([current, other]);
  const { result } = await inject(ctx, [], '继续做 dsh-agent-man');

  assert.deepEqual(calls.events.map((call) => call.sessionId), ['s-other']);
  const injected = result.messages[0];
  assert.match(injected.content[0].text, /最后 assistant/);
  assert.doesNotMatch(injected.content[0].text, /不该用/);
  assert.doesNotMatch(injected.content[0].text, /最后 user/);
});

test('没有 assistant 命中时回退到最后一条 user 命中', async () => {
  const other = session('s-other', [
    hit('s-other', 1, '旧 user', 'user/message'),
    hit('s-other', 2, '最后 user', 'user/message'),
  ]);
  const { ctx } = makeCtx([other]);
  const { result } = await inject(ctx, [], '继续做 dsh-agent-man');

  assert.match(result.messages[0].content[0].text, /最后 user/);
  assert.doesNotMatch(result.messages[0].content[0].text, /旧 user/);
});

test('只查同 workspace 的 root 候选，事件只收 user/assistant 文本', async () => {
  const other = session('s-other', [hit('s-other', 1, 'dsh-agent-man')]);
  const { ctx, calls } = makeCtx([other]);
  await inject(ctx, [], 'dsh-agent-man');

  assert.deepEqual(calls.sessions[0], [
    { kind: 'cwd', values: [CWD] },
    { kind: 'parent', values: [null] },
    { kind: 'availability', values: ['live', 'persisted'] },
  ]);
  assert.deepEqual(calls.events[0].filters, [
    { kind: 'type', values: ['user/message', 'assistant/message'] },
    { kind: 'text', text: 'dsh-agent-man' },
  ]);
});

test('最多注入 3 条，消息在最前，source 带来源', async () => {
  const sessions = Array.from({ length: 5 }, (_, index) => {
    const id = `s${index + 1}`;
    return session(id, [hit(id, index + 1, `回忆 ${id}`)], { createdAt: 10 - index });
  });
  const { ctx } = makeCtx(sessions);
  const { result, decision } = await inject(ctx, [], '继续做 dsh-agent-man');

  assert.equal(result.messages.length, decision.messages.length + 1);
  assert.equal(result.messages[0].role, 'user');
  const injected = result.messages[0];
  assert.match(injected.content[0].text, /^来自旧会话的字面命中，不是当前会话内容。/);
  assert.equal(injected.source.kind, 'dsh-agent-man');
  assert.equal(injected.source.version, 1);
  assert.equal(injected.source.items.length, MAX_ITEMS);
  for (const item of injected.source.items) {
    assert.equal(typeof item.sessionId, 'string');
    assert.equal(typeof item.seq, 'number');
    assert.ok(item.bytes > 0);
  }
  assert.ok(Buffer.byteLength(injected.content[0].text) > 0);

  const labels = injected.content[0].text.match(/s\d+#\d+/g) ?? [];
  assert.equal(labels.length, MAX_ITEMS);
  assert.equal(new Set(labels).size, MAX_ITEMS);
  assert.equal(decision.messages.length, 2, '不应修改原 decision');
});

test('最多检查 12 个候选；无命中时也不越过上限', async () => {
  const sessions = Array.from({ length: 20 }, (_, index) => {
    const id = `s${index + 1}`;
    return session(id, [], { createdAt: 100 - index });
  });
  const { ctx, calls } = makeCtx(sessions);
  const { result, decision } = await inject(ctx, [], 'dsh-agent-man');

  assert.equal(calls.events.length, MAX_CANDIDATES);
  assert.deepEqual(result, decision);
});

test('单个候选读取失败只跳过，不拖垮其他候选', async () => {
  const bad = session('s-bad', [], {}, { fail: true });
  const good = session('s-good', [hit('s-good', 1, '可用回忆')]);
  const { ctx } = makeCtx([bad, good]);
  const { result } = await inject(ctx, [], '继续做 dsh-agent-man');

  assert.match(result.messages[0].content[0].text, /可用回忆/);
  assert.equal(result.messages[0].source.items.length, 1);
});

test('同一个 root 会话只尝试一次，无命中也不重复读', async () => {
  const { ctx, calls } = makeCtx([session('s1', [])]);
  const { agent, handlers } = makeAgent();
  const preStep = start(ctx, agent, handlers);

  await run(preStep, agent, '继续做 dsh-agent-man');
  await run(preStep, agent, '继续做 dsh-agent-man');

  assert.equal(calls.sessions.length, 1);
});

test('重复的候选会话只取一次，正文总字节不超过 1536', async () => {
  const repeated = session('s1', [hit('s1', 1, '很长的回忆'.repeat(200))]);
  const { ctx } = makeCtx([repeated, repeated]);
  const { result } = await inject(ctx, [], '继续做 dsh-agent-man');

  const injected = result.messages[0];
  assert.equal(injected.source.items.length, 1);
  assert.ok(Buffer.byteLength(injected.content[0].text) <= MAX_TOTAL_BYTES);
  assert.ok(injected.content[0].text.includes('很长的回忆'));
});
