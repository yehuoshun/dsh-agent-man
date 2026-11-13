import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (relative) => readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');
const bytes = (relative) => readFileSync(new URL(`../${relative}`, import.meta.url));

test('package.json 是 DSH bundle 清单', () => {
  const pkg = JSON.parse(read('package.json'));

  assert.equal(pkg.name, 'dsh-agent-man');
  assert.equal(pkg.private, true);
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.main, './index.mjs');
  assert.equal(pkg.engines?.node, '>=20');
  assert.equal(pkg.dsh?.bundle?.patch, './cordis.patch.yml');

  assert.equal(pkg.exports?.['.'], './index.mjs');
  assert.equal(pkg.exports?.['./cordis.patch.yml'], './cordis.patch.yml');
  assert.equal(pkg.exports?.['./locale/*.json'], './locale/*.json');
  assert.equal(pkg.exports?.['./icon'], './icon.svg');

  for (const file of ['index.mjs', 'cordis.patch.yml', 'locale/*.json', 'icon.svg']) {
    assert.ok(pkg.files?.includes(file), `files 缺少 ${file}`);
  }
});

test('cordis.patch.yml 只插入 dsh-agent-man 自己', () => {
  const patch = read('cordis.patch.yml');

  assert.match(patch, /^- insert:\s*$/m);
  assert.match(patch, /^\s+- id: dsh-agent-man\s*$/m);
  assert.match(patch, /^\s+name: dsh-agent-man\s*$/m);
  assert.match(patch, /^\s+config: \{\}\s*$/m);
  assert.doesNotMatch(patch, /disabled:\s*true/);
});

test('index.mjs 导出可激活的空 apply', async () => {
  const mod = await import('../index.mjs');

  assert.equal(typeof mod.apply, 'function');
  assert.equal(mod.apply.length, 2);
  assert.doesNotThrow(() => mod.apply({}, {}));
});

test('locale 提供中英文标题和说明', () => {
  for (const language of ['en', 'zh']) {
    const { meta } = JSON.parse(read(`locale/${language}.json`));

    assert.equal(typeof meta.title, 'string');
    assert.ok(meta.title.trim().length > 0, `${language} 缺 title`);
    assert.equal(typeof meta.description, 'string');
    assert.ok(meta.description.trim().length > 0, `${language} 缺 description`);
  }
});

test('icon 是本地 SVG 且不超过 256 KiB', () => {
  const icon = read('icon.svg');

  assert.match(icon, /^<svg[\s>]/);
  assert.match(icon, /xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.doesNotMatch(icon, /(?:href|src)=["']https?:/i);
  assert.ok(Buffer.byteLength(icon) <= 256 * 1024);
});

test('文本文件是 UTF-8 无 BOM、LF', () => {
  const files = [
    'package.json',
    'cordis.patch.yml',
    'index.mjs',
    'locale/en.json',
    'locale/zh.json',
    'icon.svg',
    'README.md',
    'docs/decisions.md',
    'test/plugin.test.mjs',
    '.gitignore',
    '.gitattributes',
  ];

  for (const file of files) {
    const buf = bytes(file);
    const hasBom = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;

    assert.equal(hasBom, false, `${file} 带 BOM`);
    assert.equal(buf.indexOf(13), -1, `${file} 含 CR`);
  }
});
