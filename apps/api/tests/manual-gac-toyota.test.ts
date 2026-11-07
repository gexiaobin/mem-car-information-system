import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CarModel } from '@autovoyage/shared';
import { acquireGacToyotaManualContext, discoverGacToyotaManuals, isGacToyotaManualModel, parseGacToyotaManualEntries } from '../src/manual-gac-toyota.js';
import type { OfficialManualDownload } from '../src/manual-official-sources.js';

const model: CarModel = { id: 'highlander', brand: '广汽丰田', name: '汉兰达 · 380T四驱豪华版7座', year: 2024, power: '汽油 2.0T 8AT', isDemo: false };
const origin = 'https://www.gac-toyota.com.cn';
const directoryUrl = `${origin}/enjoy-service/usermanual`;
const dataUrl = `${origin}/2022/src/assets/json/usermanual.js`;
const title = '2024款汉兰达汽油版用户手册-2405版（01999-0E202）';
const downloadUrl = (name: string) => new URL(`/pdf/web/usermanual/${name}.pdf`, origin).href;
const manual = (name: string) => `({title:'${name}',downloadUrl:'/pdf/web/usermanual/${name}.pdf'})`.replace(/^\(|\)$/g, '');
const script = `// Official data includes comments, single quotes and trailing commas.
_baseData.usermanualModle = [{
  carName:'汉兰达', adtype:'4highlander', type:[0,3], isNew:true,
  manualData:[${manual('2026款汉兰达汽油版用户手册-2509版')},${manual('2024款汉兰达HEV用户手册-2405版（01999-0E203）')},${manual(title)},${manual('全新第四代汉兰达汽油版用户手册-2303版')},],
},{carName:'凯美瑞',adtype:'camryxle',list:[{manualData:[${manual('2023款凯美瑞汽油版用户手册-2310版')}]}]}];
_baseData.noticeData = [{text:'not manual evidence'}];`;
const directory = '<title>用户手册</title><script src="/2022/src/assets/json/usermanual.js"></script>';
const page = (url: string, text: string) => ({ url, bytes: Buffer.from(text), type: 'text/html' });
function downloadFixture(calls: string[] = [], data = script): OfficialManualDownload {
  return async url => {
    calls.push(url);
    if (url === directoryUrl) return page(url, directory);
    if (url === dataUrl) return page(url, data);
    throw new Error(`Unexpected download: ${url}`);
  };
}

test('official structured catalogue resolves actual 2024 gasoline PDF without a search engine', async () => {
  const calls: string[] = [];
  const sources = await discoverGacToyotaManuals(model, downloadFixture(calls));
  assert.deepEqual(calls, [directoryUrl, dataUrl]);
  assert.equal(sources[0].url, downloadUrl(title));
  assert.equal(sources[0].isDirectory, false);
  assert.match(sources[0].title, /01999-0E202/);
  assert.match(sources[0].description, /已实际读取.*用户手册.*目录车系“汉兰达”/);
  assert.match(sources[0].description, /目录明确标注 2024 款/);
  assert.match(sources[0].description, /不能推断该配置已获认证/);
  assert(sources.filter(source => !source.isDirectory).every(source => !/HEV|2026|2303/.test(decodeURIComponent(source.url))));
});

test('gasoline, hybrid and plug-in variants do not cross-match; catalogue supports nested model lists', async () => {
  const hybrid = await discoverGacToyotaManuals({ ...model, power: '油电混合 2.5L 双擎' }, downloadFixture());
  assert.match(decodeURIComponent(hybrid[0].url), /HEV.*0E203/);
  assert.equal(hybrid.filter(source => !source.isDirectory).length, 1);
  const plugIn = await discoverGacToyotaManuals({ ...model, power: '插电混动 PHEV' }, downloadFixture());
  assert.deepEqual(plugIn, []);
  const camry = await discoverGacToyotaManuals({ ...model, name: 'Camry · 2.0豪华版', year: 2023 }, downloadFixture());
  assert.match(decodeURIComponent(camry[0].url), /2023款凯美瑞/);
});

test('unmarked edition date never becomes model-year evidence and wrong-year files are omitted', async () => {
  const sources = await discoverGacToyotaManuals({ ...model, year: 2025 }, downloadFixture());
  assert.equal(sources.filter(source => !source.isDirectory).length, 1);
  assert.match(sources[0].description, /目录没有标注适用年款，版本日期不代表车型年款/);
  assert.match(sources.find(source => source.isDirectory)!.description, /没有明确匹配 2025 款/);
  const onlyOtherYear = script.replace(`,${manual('全新第四代汉兰达汽油版用户手册-2303版')}`, '');
  const absent = await discoverGacToyotaManuals({ ...model, year: 2025 }, downloadFixture([], onlyOtherYear));
  assert.equal(absent.length, 1);
  assert.equal(absent[0].isDirectory, true);
  const unknown = await discoverGacToyotaManuals({ ...model, power: '未填写', name: '汉兰达' }, downloadFixture());
  assert(unknown.filter(source => !source.isDirectory).every(source => /车型动力未明确/.test(source.description)));
});

test('the most specific English series alias wins over a shorter shared prefix', async () => {
  const data = `_baseData.usermanualModle = [{carName:'凌尚',adtype:'levingt',manualData:[${manual('2024款凌尚汽油版用户手册-2405版')}]},{carName:'雷凌',adtype:'levin',manualData:[${manual('2024款雷凌汽油版用户手册-2405版')}]}];`;
  const sources = await discoverGacToyotaManuals({ ...model, name: 'Levin GT 2.0豪华版' }, downloadFixture([], data));
  assert.match(sources[0].title, /凌尚/);
  assert(!sources.some(source => /雷凌/.test(source.title)));
});

test('data reader parses only literals, ignores unrelated notices and refuses code/prototype fields', () => {
  assert.equal(parseGacToyotaManualEntries(script).length, 5);
  const escape = `_baseData.usermanualModle = [{carName:'汉兰达',adtype:'4highlander',manualData:[{title:'2024款汉兰达汽油版用\\u6237手册',downloadUrl:'/pdf/web/usermanual/test.pdf'}]}];`;
  assert.equal(parseGacToyotaManualEntries(escape)[0].title, '2024款汉兰达汽油版用户手册');
  for (const expression of [
    `_baseData.usermanualModle = (() => { throw new Error('executed'); })();`,
    `_baseData.usermanualModle = [{carName:process.env.SECRET}];`,
    `_baseData.usermanualModle = [{__proto__:{polluted:true}}];`,
    `_baseData.usermanualModle = [] + ['extra'];`,
  ]) assert.throws(() => parseGacToyotaManualEntries(expression), /目录格式已改变/);
  const invalidLinks = `_baseData.usermanualModle = [{carName:'汉兰达',adtype:'4highlander',manualData:[
    {title:'2024款汉兰达用户手册',downloadUrl:'https://127.0.0.1/manual.pdf'},
    {title:'2024款汉兰达用户手册',downloadUrl:'https://outside.example/pdf/web/usermanual/x.pdf'},
    {title:'2024款汉兰达用户手册',downloadUrl:'https://user:pass@www.gac-toyota.com.cn/pdf/web/usermanual/x.pdf'}]}];`;
  assert.deepEqual(parseGacToyotaManualEntries(invalidLinks), []);
});

test('unsupported brands/series make no requests; missing real script and network failures remain diagnosable', async () => {
  let calls = 0;
  const download: OfficialManualDownload = async url => { calls++; return page(url, '<title>blocked</title>'); };
  for (const other of [{ ...model, brand: '一汽丰田' }, { ...model, brand: 'FAW Toyota' }, { ...model, brand: '大众' }, { ...model, name: '卡罗拉' }]) {
    assert.equal(isGacToyotaManualModel(other), false);
    assert.deepEqual(await discoverGacToyotaManuals(other, download), []);
  }
  assert.equal(calls, 0);
  await assert.rejects(discoverGacToyotaManuals(model, download), /没有公开手册数据链接/);
  await assert.rejects(discoverGacToyotaManuals(model, async () => { throw new Error('offline'); }), /offline/);
});

test('PDF provenance is reacquired from the actual script record and does not invent trim attributes', async () => {
  const contexts = await acquireGacToyotaManualContext(model, downloadUrl(title), downloadFixture());
  assert.equal(contexts.length, 1);
  assert.equal(contexts[0].url, directoryUrl);
  assert.match(contexts[0].text, /页面标题：用户手册/);
  assert.match(contexts[0].text, /carName: 汉兰达/);
  assert(contexts[0].text.includes(`title: ${title}`));
  assert(contexts[0].text.includes(`downloadUrl: ${downloadUrl(title)}`));
  assert(!/380T|8AT|2\.0T|豪华/.test(contexts[0].text));
  assert.deepEqual(await acquireGacToyotaManualContext(model, `${origin}/pdf/web/usermanual/unlisted.pdf`, downloadFixture()), []);
  assert.deepEqual(await acquireGacToyotaManualContext(model, 'https://outside.example/anything.pdf', async () => { throw new Error('must not fetch'); }), []);
});
