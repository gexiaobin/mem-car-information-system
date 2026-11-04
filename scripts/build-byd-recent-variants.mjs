/**
 * Build the BYD 2024–2026 supplement from reviewed public-page facts.
 * Run after the deliberate research fetch; deployment never scrapes providers.
 * Cache: .local/variant-research/{byd-current,autohome-byd}.
 */
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const readJson = async path => JSON.parse(await readFile(path, 'utf8'));
const cached = '.local/variant-research';
const models = [...await readJson('apps/api/src/data/catalog-models.json'), ...await readJson('apps/api/src/data/catalog-models-recent.json')];
const modelId = name => {
  const row = models.find(x => x.brand === '比亚迪' && x.name === name);
  if (!row) throw new Error(`Unmapped model ${name}`);
  return row.id;
};
const mapping = new Map([
  [6762, '海鸥'], [6139, '海豚'], [5964, '秦PLUS'], [7588, '海豹06'],
  [7822, '海豹07'], [8462, '海豹07'], [7578, '秦L'], [8463, '秦MAX'],
  [8485, '海豹08'], [5499, '汉'], [7859, '汉L'], [7538, '元UP'],
  [7807, '海狮05'], [7982, '海狮05'], [5279, '宋Pro'], [6298, '元PLUS'],
  [8087, '海狮06'], [7815, '宋L'], [7220, '宋L'], [8511, '宋Ultra'],
  [3430, '唐'], [8484, '海狮08'], [8005, '唐L'], [7851, '夏'], [6394, '海豹'],
  [5761, '宋PLUS'], [5760, '宋PLUS'], [7977, '海狮07'], [6851, '海狮07'],
]);
const prefixes = new Map([[7822, 'DM-i'], [8462, 'EV'], [7807, 'DM-i'], [7982, 'EV'], [7815, 'DM-i'], [7220, 'EV'], [7977, 'DM-i'], [6851, 'EV']]);
// Exact portal IDs reviewed against the same official configuration columns.
// The first twelve belong to the pre-existing master and must retain its IDs.
const preExistingIds = new Set([75413, 75141, 76108, 76176, 77748, 77717, 77718, 77749, 73552, 74310, 73553, 74335]);
const official = [
  { goodsId: '152', name: '秦PLUS', year: 2026, prefix: 'DM-i', replacements: [76199, 76109, 76177] },
  { goodsId: '150', name: '宋L', year: 2026, prefix: 'DM-i', replacements: [75123, 75404, 75416] },
  { goodsId: '151', name: '夏', year: 2026, prefix: 'DM-i', replacements: [75559, 75560, 75429, 75544] },
  { goodsId: '10051', name: '海狮06', year: 2026, prefix: 'DM-i', replacements: [77933, 77708, 77709, 77710] },
  { goodsId: '10041', name: '海狮06', year: 2026, prefix: 'EV', replacements: [76681, 76682, 76224, 76652] },
  { goodsId: '10011', name: '海豚', year: 2025, prefix: '', replacements: [69004, 69005, 69006, 66316] },
];
const replacementIds = new Set(official.flatMap(x => x.replacements));
const sources = [];
const variants = [];
const seen = new Set();
const counts = {};
const exclusions = { outsideYears: 0, notReleased: 0, officialPreferred: 0, existingOfficial: 0, repeatedId: 0 };
const norm = text => text.normalize('NFKC').replace(/\s+/g, '').toLowerCase();

for (const [seriesId, name] of mapping) {
  const files = (await readdir(`${cached}/autohome-byd`)).filter(x => x.startsWith(`${seriesId}-`) && x.endsWith('.json')).sort();
  const hashes = [];
  let accepted = 0;
  for (const file of files) {
    const raw = await readFile(`${cached}/autohome-byd/${file}`, 'utf8');
    hashes.push(`${file}:${createHash('sha256').update(raw).digest('hex')}`);
    const data = JSON.parse(raw);
    if (data.returncode !== 0 || !data.result?.specinfo) throw new Error(`Invalid listing ${file}`);
    for (const section of data.result.specinfo.speclist ?? []) {
      for (const group of section.yearspeclist ?? []) {
        for (const row of group.speclist ?? []) {
          const year = row.name.match(/^(20\d{2})款\s+(.+)$/);
          if (!year || Number(year[1]) !== row.year) throw new Error(`Conflicting explicit year ${row.id}`);
          if (row.year < 2024 || row.year > 2026) { exclusions.outsideYears++; continue; }
          if (![20, 30, 40].includes(row.state)) { exclusions.notReleased++; continue; }
          if (preExistingIds.has(row.id)) { exclusions.existingOfficial++; continue; }
          if (replacementIds.has(row.id)) { exclusions.officialPreferred++; continue; }
          if (seen.has(row.id)) { exclusions.repeatedId++; continue; }
          if (!row.fueltypedetail || !row.transmission || !row.drivemodename || !Number.isFinite(row.mali) || row.mali <= 0) throw new Error(`Missing power ${row.id}`);
          let trim = year[2];
          const prefix = prefixes.get(seriesId);
          if (prefix && !new RegExp(`^${prefix}\\b`, 'i').test(trim)) trim = `${prefix} ${trim}`;
          const electric = row.fueltypedetailid === 4;
          const hybrid = [5, 8].includes(row.fueltypedetailid);
          const power = `${electric ? '纯电动' : row.fueltypedetail} · ${electric ? '电机' : hybrid ? '发动机' : ''}${row.mali}马力 · ${row.transmission} · ${row.drivemodename}`;
          const evidence = `汽车之家车系ID=${seriesId}；具体车型ID=${row.id}；原名=${row.name}；year=${row.year}；燃料=${row.fueltypedetail}；列表马力=${row.mali}；变速箱=${row.transmission}；驱动=${row.drivemodename}；源分组=${group.name || group.yearname}。同一具体车型记录；插混列表马力为发动机功率，不是油电系统总功率。`;
          variants.push({ id: `autohome-byd-spec-${row.id}`, modelCatalogId: modelId(name), year: row.year, power, trim, sourceId: `autohome-byd-${seriesId}-recent`, sourceEvidence: evidence, manufacturer: '比亚迪' });
          seen.add(row.id); accepted++;
        }
      }
    }
  }
  counts[`${name}（${seriesId}）`] = accepted;
  sources.push({
    id: `autohome-byd-${seriesId}-recent`,
    title: `汽车之家比亚迪${name}公开车型列表（车系${seriesId}）`,
    url: `https://www.autohome.com.cn/${seriesId}/`,
    license: '公开页面车型短事实摘录（页面版权归原权利人；非开源整表许可）',
    revision: `2026-11-04 公开车型列表事实快照；输入SHA-256 ${createHash('sha256').update(hashes.join('\n')).digest('hex')}`,
    retrievedAt: '2026-11-04',
    description: `从该页面自身公开调用的 /web-main/car/series/getspeclistresponse 取得逐车型短事实；seriesid=${seriesId}，tagid=1及页面列示的2024–2026停售年款。只保留明确YYYY款且与year字段一致、已上市或停售的型号，按同一车型ID绑定年款/燃料/马力/变速箱/驱动/配置。剔除未售与待售；${accepted}条。本地构建后静态提供，不在运行时抓取，不导入图片、报价或销售状态，不代表全量或现售。`,
  });
}

for (const item of official) {
  const raw = await readFile(`${cached}/byd-current/${item.goodsId}.json`, 'utf8');
  const table = JSON.parse(raw).response.data;
  if (!table.title.includes(`${item.year}款`)) throw new Error(`Official explicit year missing: ${item.goodsId}`);
  const rows = table.configs.flatMap(x => x.value);
  const names = rows.find(x => x.name === '车型')?.value;
  if (!names?.length) throw new Error(`Configuration columns missing: ${item.goodsId}`);
  const pick = (regex, index) => {
    const row = rows.find(x => regex.test(x.name));
    return row?.value[index]?.trim() ?? '';
  };
  const sourceId = `official-byd-${item.goodsId}-${item.year}-recent-variants`;
  names.forEach((name, index) => {
    if (!name.trim()) return;
    const engine = pick(/^发动机型号$/, index);
    const engineKw = pick(/^发动机最大功率/, index);
    const motor = pick(/^(?:驱动)?电机(?:型式|类型)$|^驱动电机类型$/, index);
    const motorRow = rows.find(x => /^(?:前|后|驱动)?电机最大功率/.test(x.name));
    const motorKw = motorRow?.value[index]?.trim() ?? '';
    const battery = pick(/^(?:动力)?电池容量/, index);
    const system = pick(/^变速系统$/, index);
    const drive = pick(/^驱动形式$/, index);
    if (!motorKw || !battery || (engine && !engineKw)) throw new Error(`Missing same-column power: ${item.goodsId}/${index}`);
    const motorLabel = motorRow.name.startsWith('前') ? '前电机' : motorRow.name.startsWith('后') ? '后电机' : '电机';
    const power = engine
      ? `插电混合动力 · ${engine} ${engineKw} kW · ${motorLabel}${motorKw} kW${system ? ` · ${system}` : ''}`
      : `纯电动 · ${motor || '驱动电机'} ${motorKw} kW${drive ? ` · ${drive}` : ''}`;
    const trim = `${item.prefix ? `${item.prefix} ` : ''}${name.trim()}`;
    variants.push({
      id: `official-byd-recent-${item.goodsId}-${createHash('sha256').update(norm(trim)).digest('hex').slice(0, 12)}`,
      modelCatalogId: modelId(item.name), year: item.year, power, trim, sourceId,
      sourceEvidence: `官方表头=${table.title}；车型列=${index + 1}；配置=${name.trim()}；${engine ? `发动机=${engine}；发动机最大功率=${engineKw} kW；` : `电机类型=${motor}；`}${motorLabel}最大功率=${motorKw} kW；电池容量=${battery} kWh${system ? `；变速系统=${system}` : ''}${drive ? `；驱动形式=${drive}` : ''}。全部参数来自同一配置列；不推断系统总功率或保养适用性。`,
      manufacturer: '比亚迪',
    });
  });
  sources.push({
    id: sourceId, title: `比亚迪官网${table.title}`,
    url: `https://www.byd.com/cn/parameter-comparison?goodsId=${item.goodsId}`,
    license: '官方公开网页（事实摘录，原页面版权归原权利人）',
    revision: `2026-11-04 官网参数事实快照；输入SHA-256 ${createHash('sha256').update(raw).digest('hex')}`,
    retrievedAt: '2026-11-04',
    description: `官网公开参数页自身调用 goodsParams?goodsId=${item.goodsId}；明确${item.year}款表头，配置与发动机/电机/电池按同列绑定。只保存短名称与少量事实；同一配置已从汽车之家补充数据剔除，保留官方数据。不代表全部年款，不导入整表、价格、图片或保养周期。`,
  });
}

variants.sort((a, b) => a.modelCatalogId.localeCompare(b.modelCatalogId) || b.year - a.year || a.trim.localeCompare(b.trim, 'zh-CN'));
const ids = new Set(), keys = new Set();
for (const row of variants) {
  if (ids.has(row.id)) throw new Error(`Duplicate ID ${row.id}`);
  const key = `${row.modelCatalogId}/${row.year}/${norm(row.power)}/${norm(row.trim)}`;
  if (keys.has(key)) throw new Error(`Duplicate facts ${row.id}`);
  if (`${row.power} · ${row.trim}`.length > 200 || row.sourceEvidence.length > 1000) throw new Error(`Oversize ${row.id}`);
  if (!sources.some(s => s.id === row.sourceId) || !models.some(m => m.id === row.modelCatalogId)) throw new Error(`Broken reference ${row.id}`);
  ids.add(row.id); keys.add(key);
}
await writeFile('apps/api/src/data/catalog-variants-byd-recent.json', `${JSON.stringify(variants, null, 2)}\n`);
await writeFile('apps/api/src/data/catalog-sources-byd-recent.json', `${JSON.stringify(sources, null, 2)}\n`);
const stats = { count: variants.length, years: Object.fromEntries([2024, 2025, 2026].map(y => [y, variants.filter(x => x.year === y).length])), models: new Set(variants.map(x => x.modelCatalogId)).size, officialCount: variants.filter(x => x.sourceId.startsWith('official-')).length, sourceCount: sources.length, counts, exclusions };
await writeFile(`${cached}/byd-recent-stats.json`, JSON.stringify(stats, null, 2));
console.log(JSON.stringify(stats, null, 2));
