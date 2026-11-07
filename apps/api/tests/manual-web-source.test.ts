import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractManualWebPage } from '../src/manual-web-source.js';

test('web manual extraction preserves table text, isolates executable content, and finds relevant public evidence', () => {
  const html = `<!doctype html><html><head><title>合成车系通用保养说明</title><script>leakSecret()</script></head><body><nav>无关导航</nav><article><h1>保养周期</h1><p>每12个月或20000公里，更换空调滤芯。</p><table><tr><th>项目</th><th>周期/km</th></tr><tr><td>更换空调滤芯</td><td>20000</td></tr></table><p>保养表图片<img alt="完整保养表" src="/images/table.png"><img alt="品牌logo" src="/logo.png"><img alt="保养表" src="http://127.0.0.1/private.png"></p><a href="/manual.pdf">下载手册</a></article><footer>无关版权导航</footer></body></html>`;
  const result = extractManualWebPage(Buffer.from(html), 'https://example.com/service/model');
  assert.equal(result.title, '合成车系通用保养说明');
  assert.match(result.text, /项目 \| 周期\/km \|/);
  assert.match(result.text, /更换空调滤芯 \| 20000 \|/);
  assert(!result.text.includes('leakSecret'));
  assert(!result.text.includes('无关导航'));
  assert.deepEqual(result.images, ['https://example.com/images/table.png']);
  assert.deepEqual(result.pdfs, ['https://example.com/manual.pdf']);
});

test('web manual extraction rejects excessive source text instead of silently dropping evidence', () => {
  assert.throws(() => extractManualWebPage(Buffer.from(`<html><body><main>保养${'资料'.repeat(51000)}</main></body></html>`), 'https://example.com/manual'), /正文过长/);
});

test('maintenance matrices retain blank columns and expanded merged headers', () => {
  const html = `<html><body><main><table><tr><th rowspan="2">项目</th><th colspan="3">里程/km</th></tr><tr><th>20000</th><th>40000</th><th>60000</th></tr><tr><td>变速器油更换</td><td></td><td>•</td><td></td></tr></table></main></body></html>`;
  const page = extractManualWebPage(Buffer.from(html), 'https://example.com/manual');
  assert.match(page.text, /\| 项目 \| 里程\/km \| 里程\/km \| 里程\/km \|/);
  assert.match(page.text, /\| 项目 \| 20000 \| 40000 \| 60000 \|/);
  assert.match(page.text, /\| 变速器油更换 \| \| • \| \|/);
});

test('HTTP charset takes precedence over conflicting HTML metadata and malformed text is not guessed', () => {
  const bytes = Buffer.concat([Buffer.from('<html><head><meta charset="utf-8"><title>'), Buffer.from([0xb1, 0xa3, 0xd1, 0xf8]), Buffer.from('</title></head><body>'), Buffer.from([0xb1, 0xa3, 0xd1, 0xf8]), Buffer.from(' 5000km</body></html>')]);
  assert.equal(extractManualWebPage(bytes, 'https://example.com/manual', 'gbk').title, '保养');
  assert.throws(() => extractManualWebPage(bytes, 'https://example.com/manual'), /字符编码无法读取/);
});
