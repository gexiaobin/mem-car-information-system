import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CarModel } from '@autovoyage/shared';
import { acquireOfficialManualContext, discoverDongfengHondaManuals, hondaMaintenanceRoutes, hondaModelManualDirectory, parseHondaManualCards, parseHondaManualContext, type OfficialManualDownload } from '../src/manual-official-sources.js';
import { discoverManualSources, type publicDownload } from '../src/manual-sources.js';

const model: CarModel = { id: 'test-civic', brand: '东风本田', name: '思域 · 240TURBO', year: 2025, power: '汽油 1.5T CVT', isDemo: true };
const origin = 'https://www.dongfeng-honda.com';
const indexUrl = `${origin}/service_handbook_crv.shtml`;
const directoryUrl = `${origin}/service_handbook_civic.shtml`;
const landingUrl = `${origin}/html/userguide/4d/`;
const scheduleUrl = `${landingUrl}by_page30.html`;
const card = (title: string, href: string, mobile?: string) => `<li><dl class="hanbook_text"><dd><h5><strong>${title}</strong></h5><p><a class="download" href="${href}"${mobile ? ` data-mobileurl="${mobile}"` : ''}><img src="icon.png"></a></p></dd></dl></li>`;
const directory = '<a href="service_handbook_crv.shtml">CR-V</a><a href="service_handbook_civic.shtml">思域</a>' +
  card('25款思域三厢汽油版电子手册', landingUrl) +
  card('思域四门三厢汽油版三包手册', 'download/petrol.zip', 'download/petrol.pdf') +
  card('思域四门三厢混动版三包手册', 'download/hybrid.zip', 'download/hybrid.pdf') +
  card('思域五门两厢汽油版用户手册', 'download/hatch.zip', 'download/hatch.pdf') +
  card('思域应急救援手册', 'download/rescue.zip', 'download/rescue.pdf');
const landing = '<main><p>本手册主要介绍 2025 年上市的 思域 车型。</p></main><script src="/html/userguide/4d/assets/js/app.c5c45035.js"></script>';
const bundle = '{title:"保养时间表",frontmatter:{},regularPath:"/by_page30.html",relativePath:"by_page30.md"}';
const schedule = '<main class="theme-default-content"><h1>保养时间表</h1><table><tr><td>更换制动液</td><td>每 3 年</td></tr></table></main>';
const page = (url: string, html: string) => ({ bytes: Buffer.from(html), url, type: 'text/html' });

test('official resolver follows current model navigation and exposes real PDF attributes without ZIP guessing', () => {
  assert.equal(hondaModelManualDirectory(directory, indexUrl, model), directoryUrl);
  assert.equal(hondaModelManualDirectory(directory, indexUrl, { ...model, name: '雅阁' }), undefined);
  const sources = parseHondaManualCards(directory, directoryUrl, { ...model, name: '思域 三厢' });
  assert.equal(sources[0].url, landingUrl);
  assert.equal(sources[1].url, `${origin}/download/petrol.pdf`);
  assert(sources.every(source => !source.isDirectory && source.kind === 'official'));
  assert(sources.every(source => !/zip|hybrid|hatch|rescue/.test(source.url)));
  assert.match(sources[0].description, /2025/);
  assert.match(sources[1].description, /未标明具体年款/);
  const hybrids = parseHondaManualCards(directory, directoryUrl, { ...model, power: '油电混动 e:HEV' });
  assert.equal(hybrids.length, 1);
  assert.match(hybrids[0].url, /hybrid\.pdf$/);
  for (const power of ['1.5T CVT', '240TURBO', '2.0L CVT']) {
    const fuel = parseHondaManualCards(directory, directoryUrl, { ...model, power });
    assert(fuel.length > 0);
    assert(fuel.every(source => !/混动|hybrid/.test(`${source.title} ${source.url}`)));
  }
  const unknown = parseHondaManualCards(directory, directoryUrl, { ...model, name: '思域', power: '未填写' });
  assert(unknown.some(source => /hybrid/.test(source.url)));
  assert(unknown.every(source => source.description.includes('不能确认该版本适用')));
});

test('official links and route metadata remain on the same HTTPS origin and remote scripts are only parsed', () => {
  const malicious = card('25款思域电子手册', 'https://127.0.0.1/secret') + card('思域保养手册', 'https://bad.example/guide.pdf');
  assert.equal(parseHondaManualCards(malicious, directoryUrl, model).length, 0);
  assert.deepEqual(hondaMaintenanceRoutes(bundle, landingUrl), [{ title: '保养时间表', url: scheduleUrl }]);
  assert.deepEqual(hondaMaintenanceRoutes('{title:"保养时间表",regularPath:"https://outside.example/private.html"}', landingUrl), []);
});

test('verified official schedule carries homepage applicability and precedes directory/PDF results even if search engines fail', async () => {
  const calls: string[] = [];
  const fixtureDownload = (async (url: string) => {
    calls.push(url);
    if (new URL(url).hostname !== 'www.dongfeng-honda.com') throw new Error('search engine blocked');
    if (url === indexUrl || url === directoryUrl) return page(url, directory);
    if (url === landingUrl) return page(url, landing);
    if (/app\.c5c45035\.js$/.test(url)) return page(url, bundle);
    if (url === scheduleUrl) return page(url, schedule);
    throw new Error('unexpected url');
  }) as typeof publicDownload;
  const sources = await discoverManualSources(model, { download: fixtureDownload, cache: false });
  assert.equal(sources[0].url, scheduleUrl);
  assert.match(sources[0].description, /本手册主要介绍 2025 年上市的 思域 车型/);
  assert.match(sources[0].description, /已实际读取/);
  assert.match(sources[0].description, /无需网盘/);
  assert(calls.includes(directoryUrl));
  assert(calls.some(url => new URL(url).searchParams.get('q')?.includes('2025')));
});

test('unsupported brands and absent actual schedules do not manufacture a maintenance page', async () => {
  let calls = 0;
  const download: OfficialManualDownload = async url => { calls++; return page(url, url === landingUrl ? '<main>旧手册首页，无保养页链接</main>' : directory); };
  assert.deepEqual(await discoverDongfengHondaManuals({ ...model, brand: '广汽本田' }, download), []);
  assert.equal(calls, 0);
  const sources = await discoverDongfengHondaManuals(model, download);
  assert(sources.length > 0);
  assert(sources.every(source => source.url !== scheduleUrl));
  assert.match(sources[0].description, /没有明确标注适用年款/);
});

test('actual foreword year overrides an unversioned directory card and prevents following a wrong-edition schedule', async () => {
  const calls: string[] = [];
  const download: OfficialManualDownload = async url => {
    calls.push(url);
    return page(url, url === landingUrl ? landing.replace('2025 年', '2022 年') : directory.replace('25款思域', '思域'));
  };
  const sources = await discoverDongfengHondaManuals(model, download);
  assert(sources.length > 0);
  assert(!calls.some(url => /\.js$|by_page30/.test(url)));
  assert.match(sources.find(source => source.url === landingUrl)!.description, /2022 年上市，与当前 2025 年款不同/);
});

test('official directory context retains only the exact linked book card as separately acquired source text', async () => {
  const html = `<title>东风本田用车指南</title>${directory}`;
  const contexts = parseHondaManualContext(html, directoryUrl, scheduleUrl);
  assert.equal(contexts.length, 1);
  assert.equal(contexts[0].url, directoryUrl);
  assert.equal(contexts[0].title, '东风本田用车指南');
  assert.match(contexts[0].text, /25款思域三厢汽油版电子手册/);
  assert(contexts[0].text.includes(`href=${JSON.stringify(landingUrl)}`));
  assert(!contexts[0].text.includes('混动版'));
  assert(!contexts[0].text.includes('1.5T'));
  assert(!contexts[0].text.includes('CVT'));
  assert.deepEqual(parseHondaManualContext(html, directoryUrl, `${origin}/html/userguide/other/by_page30.html`), []);
  assert.deepEqual(parseHondaManualContext(html, directoryUrl, 'https://outside.example/html/userguide/4d/by_page30.html'), []);
  const pdf = parseHondaManualContext(html, directoryUrl, `${origin}/download/petrol.pdf`);
  assert.equal(pdf.length, 1);
  assert.match(pdf[0].text, /data-mobileurl="download\/petrol.pdf"/);

  const calls: string[] = [];
  const download: OfficialManualDownload = async url => { calls.push(url); return page(url, html); };
  const actual = await acquireOfficialManualContext(model, scheduleUrl, download);
  assert.deepEqual(calls, [indexUrl, directoryUrl]);
  assert.deepEqual(actual, contexts);
});
