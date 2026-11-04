/** Deliberately reviewed public facts; no network requests at build/deploy time. */
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const cache = '.local/variant-research/latest';
const readJson = async path => JSON.parse(await readFile(path, 'utf8'));
const models = await readJson('apps/api/src/data/catalog-models.json');
const selected = await readJson(`${cache}/selected-series.json`);
const mapping = [
  { seriesId: 8183, brand: '理想', name: 'i6', years: [2025, 2026] },
  { seriesId: 7727, brand: '理想', name: 'i8', years: [2025, 2026] },
  { seriesId: 8014, brand: '小鹏汽车', name: 'G7', years: [2025, 2026] },
  { seriesId: 8148, brand: '极氪', name: '8X', years: [2026] },
  { seriesId: 7835, brand: '极氪', name: '9X', years: [2026] },
  { seriesId: 8509, brand: '蔚来', name: 'ES9', years: [2026] },
  { seriesId: 6962, brand: '小米汽车', name: 'SU7', years: [2026] },
  { seriesId: 7793, brand: '小米汽车', name: 'YU7', years: [2026] },
  { seriesId: 5346, brand: '特斯拉', name: 'Model 3', years: [2026] },
  { seriesId: 5769, brand: '特斯拉', name: 'Model Y', years: [2026] },
];
const variants = [], sources = [], ids = new Set(), specIds = [];
const stats = { count: 0, models: {}, excluded: { year: 0, placeholder: 0, unavailable: 0, repeated: 0 } };
for (const item of mapping) {
  if (!selected.some(x => x.id === item.seriesId)) throw new Error(`Series not observed in public brand page: ${item.seriesId}`);
  const model = models.find(x => x.brand === item.brand && x.name === item.name);
  if (!model) throw new Error(`Model missing: ${item.brand}/${item.name}`);
  const files = (await readdir(cache)).filter(x => x.startsWith(`${item.seriesId}-`) && x.endsWith('.json')).sort();
  const hashes = [];
  let count = 0;
  for (const file of files) {
    const raw = await readFile(`${cache}/${file}`, 'utf8');
    hashes.push(`${file}:${createHash('sha256').update(raw).digest('hex')}`);
    const data = JSON.parse(raw);
    if (data.returncode !== 0 || !data.result?.specinfo) throw new Error(`Invalid public listing ${file}`);
    for (const section of data.result.specinfo.speclist ?? []) {
      for (const group of section.yearspeclist ?? []) {
        for (const row of group.speclist ?? []) {
          const match = row.name.match(/^(20\d{2})款\s+(.+)$/);
          if (!match || Number(match[1]) !== row.year) throw new Error(`Explicit year conflict ${row.id}`);
          if (!item.years.includes(row.year)) { stats.excluded.year++; continue; }
          if (/基本型|预售|预订|待定|试装|概念|Concept/i.test(match[2])) { stats.excluded.placeholder++; continue; }
          if (![20, 30, 40].includes(row.state)) { stats.excluded.unavailable++; continue; }
          if (ids.has(row.id)) { stats.excluded.repeated++; continue; }
          if (!row.fueltypedetail || !row.transmission || !row.drivemodename || !Number.isFinite(row.mali) || row.mali <= 0) throw new Error(`Power fields missing ${row.id}`);
          const electric = row.fueltypedetailid === 4;
          const engine = /混合动力|增程/.test(row.fueltypedetail);
          const power = `${electric ? '纯电动' : row.fueltypedetail} · ${electric ? '电机' : engine ? '发动机' : ''}${row.mali}马力 · ${row.transmission} · ${row.drivemodename}`;
          const variant = {
            id: `autohome-latest-spec-${row.id}`,
            modelCatalogId: model.id, year: row.year, power, trim: match[2],
            sourceId: `autohome-latest-${item.seriesId}`,
            sourceEvidence: `汽车之家车系ID=${item.seriesId}；具体车型ID=${row.id}；原名=${row.name}；year=${row.year}；燃料=${row.fueltypedetail}；列表马力=${row.mali}；变速箱=${row.transmission}；驱动=${row.drivemodename}。同一具体车型原行；插混/增程马力为发动机参数，不是系统总功率；状态已核对为已上市或停售。`,
            manufacturer: item.brand === '特斯拉' ? '特斯拉中国' : item.brand,
          };
          if (`${power} · ${variant.trim}`.length > 200 || variant.sourceEvidence.length > 1000) throw new Error(`Field too long ${row.id}`);
          variants.push(variant); ids.add(row.id); specIds.push(row.id); count++;
        }
      }
    }
  }
  stats.models[`${item.brand} ${item.name}`] = count;
  sources.push({
    id: `autohome-latest-${item.seriesId}`,
    title: `汽车之家${selected.find(x => x.id === item.seriesId).name}公开具体车型事实`,
    url: `https://www.autohome.com.cn/${item.seriesId}/`,
    license: '公开页面车型短事实摘录（页面版权归原权利人；非开源整表许可）',
    revision: `2026-11-04 公开车型列表快照；输入SHA-256 ${createHash('sha256').update(hashes.join('\n')).digest('hex')}`,
    retrievedAt: '2026-11-04',
    description: `由公开品牌列表/品牌SSR核实车系${item.seriesId}，读取车系页自身公开调用的 /web-main/car/series/getspeclistresponse，tagid=1及页面明确列出的停售年款。只保留原名YYYY款与year一致、已上市或停售的${item.years.join('/')}年款；基本型、预售和未售占位剔除。${count}条，年款/动力/配置不跨记录组合。只存短事实，不分发图片、报价、完整页面和配置表；不代表当前在售或全量覆盖。`,
  });
}
if (variants.length !== 50) throw new Error(`Reviewed snapshot count changed: ${variants.length}, expected 50`);
if (new Set(variants.map(x => x.id)).size !== variants.length) throw new Error('Duplicate IDs');
variants.sort((a, b) => a.modelCatalogId.localeCompare(b.modelCatalogId) || b.year - a.year || a.trim.localeCompare(b.trim, 'zh-CN'));
await writeFile('apps/api/src/data/catalog-variants-latest.json', `${JSON.stringify(variants, null, 2)}\n`);
await writeFile('apps/api/src/data/catalog-sources-latest.json', `${JSON.stringify(sources, null, 2)}\n`);
stats.count = variants.length;
stats.specIds = specIds.sort((a, b) => a - b);
await writeFile(`${cache}/stats.json`, JSON.stringify(stats, null, 2));
console.log(JSON.stringify(stats, null, 2));
