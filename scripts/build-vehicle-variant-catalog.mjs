// Rebuild only factual vehicle variants from a pinned, licensed source snapshot.
// Treat remote SQL as text. Never connect to MySQL or execute source statements.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const commit = '6ef6168838cf0ec9ebfb9442b4203e7706edbad8';
const cacheDir = resolve(root, '.local/variant-research');
await mkdir(cacheDir, { recursive: true });
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
async function loadSource(remoteName, cacheName, expectedHash) {
  const cachePath = resolve(cacheDir, cacheName);
  let bytes;
  try { bytes = await readFile(cachePath); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const response = await fetch(`https://raw.githubusercontent.com/utf6/Cars_Data/${commit}/sql/${encodeURIComponent(remoteName)}`);
    if (!response.ok) throw new Error(`Source download failed (${response.status}): ${remoteName}`);
    bytes = Buffer.from(await response.arrayBuffer());
    if (sha256(bytes) !== expectedHash) throw new Error(`Source integrity mismatch: ${remoteName}`);
    await writeFile(cachePath, bytes);
  }
  if (sha256(bytes) !== expectedHash) throw new Error(`Source integrity mismatch: ${remoteName}`);
  return bytes.toString('utf8');
}
const [sql, brandSQL, seriesSQL] = await Promise.all([
  loadSource('车型表.sql', 'models.sql', '4207ba72d832f8ce2fe446e0a90f0c91ed6be26b8a55fee173dd927513801ad3'),
  loadSource('品牌表.sql', 'brands.sql', '3e1fd124aca6d9c7f688aed6da9598428ae336e2c4ab66f2476ae05821dbe1ba'),
  loadSource('车系表.sql', 'series.sql', '870a3a4b6d2289b25496176814365c9c833fd7a74f5e151f2e613a9afd7ecb34'),
]);
const columns = [...sql.slice(sql.indexOf('CREATE TABLE'), sql.indexOf('ENGINE=')).matchAll(/^\s+`([^`]+)` text/gm)].map(m => m[1]);
const col = Object.fromEntries(columns.map((c, i) => [c, i]));
function parseTuple(line) {
  const values=[]; let i=line.indexOf('VALUES (')+8;
  for (;;) {
    while (/\s/.test(line[i] || '') && i < line.length) i++;
    if (line[i] === ')') break;
    if (line[i] === "'") {
      i++; let value=''; let closed=false;
      while(i < line.length) {
        const c=line[i++];
        if (c === '\\') {
          const escaped=line[i++];
          value+=({n:'\n',r:'\r',t:'\t','0':'\0',b:'\b',Z:'\x1a'}[escaped] ?? escaped);
        } else if(c === "'") {
          if(line[i] === "'") { value+="'"; i++; }
          else { closed=true; break; }
        } else value+=c;
      }
      if(!closed) throw new Error('unclosed string');
      values.push(value);
    } else {
      const start=i; while(i<line.length && line[i]!==',' && line[i]!==')') i++;
      const literal=line.slice(start,i).trim();
      if(literal.toLowerCase() !== 'null') throw new Error('Unexpected SQL literal');
      values.push(null);
    }
    while(/\s/.test(line[i] || '') && i<line.length) i++;
    if(line[i]===',') i++;
    else if(line[i]===')') break;
    else throw new Error('Unexpected value delimiter');
  }
  if(values.length!==columns.length) throw new Error(`Column mismatch ${values.length}/${columns.length}`);
  return Object.fromEntries(Object.entries(col).map(([c,i])=>[c,values[i]]));
}
const brands=new Map([...brandSQL.matchAll(/INSERT INTO `品牌表` VALUES \('([^']*)', '([^']*)', '([^']*)'/g)].map(m=>[m[2],m[3]]));
const series = new Map([...seriesSQL.matchAll(/INSERT INTO `车系表` VALUES \('([^']*)', '([^']*)', '([^']*)'/g)].map(m=>[m[1],{brand:brands.get(m[2]),name:m[3]}]));
const models=JSON.parse(await readFile(resolve(root, 'apps/api/src/data/catalog-models.json'),'utf8'));
const normalizeName=(brand,name)=>{let v=name.trim();if(v.startsWith(brand)&&v.length>brand.length)v=v.slice(brand.length).trim();return v;};
const key=(brand,name)=>`${brand}\0${name}`.normalize('NFKC').replace(/\s+/g,'').toLowerCase();
const lookup=new Map(models.map(m=>[key(m.brand,m.name),m]));
const usable = v => typeof v==='string' && v.trim() && v.trim()!=='-' && v.trim()!=='--';
const stats={total:0,errors:0,missingSeries:0,missingYear:0,yearConflict:0,missingPower:0,missingTrim:0,nonProduction:0,duplicate:0,overlong:0,accepted:0};
const variants=[]; const fuels={}; const rejected=[]; const seen=new Set();
for(const line of sql.split(/\r?\n/)) {
  if(!line.startsWith('INSERT INTO `车型表` VALUES (')) continue;
  stats.total++;
  let r; try {r=parseTuple(line);} catch(e) {stats.errors++;if(rejected.length<5)rejected.push({error:e.message});continue;}
  const s=series.get(r['车系ID']);
  const model=s?.brand ? lookup.get(key(s.brand,normalizeName(s.brand,s.name))) : undefined;
  if(!model || brands.get(r['品牌ID'])!==s.brand) { stats.missingSeries++;continue; }
  const ym=/^((?:19|20)\d{2})款$/.exec(r['年代款']||'');
  if(!ym) { stats.missingYear++; continue; }
  const year=Number(ym[1]);
  const namedYear=/\b((?:19|20)\d{2})款/.exec(r['车型名称']||'');
  if(!namedYear || Number(namedYear[1])!==year) {stats.yearConflict++;continue;}
  const fuel=r['发动机_燃料形式'];
  if(!usable(fuel)) { stats.missingPower++;continue; }
  let engine;
  if(fuel==='纯电动') {
    const kw=r['电动机_电动机总功率(kW)'];
    if(!usable(kw) || !/^\d+(\.\d+)?$/.test(kw)) {stats.missingPower++;continue;}
    engine=`电机总功率 ${kw} kW`;
  } else {
    if(!usable(r['基本参数_发动机']) || !/(?:\d+(?:\.\d+)?[LT]|[1-9]\d*(?:\.\d+)?马力)/.test(r['基本参数_发动机']) || /未知|暂无|未公布|待定|马坡/.test(r['基本参数_发动机'])) { stats.missingPower++;continue; }
    engine=r['基本参数_发动机'].trim();
  }
  const gearbox=usable(r['基本参数_变速箱'])?r['基本参数_变速箱'].trim():undefined;
  const power=[fuel.trim(),engine,gearbox].filter(Boolean).join(' · ');
  const trim=r['车型名称'].slice(namedYear.index+namedYear[0].length).trim();
  if(!trim) {stats.missingTrim++;continue;}
  if(/概念|原型|(?:^|\s)concept(?:\s|$)|prototype|BETA版|试装/i.test(trim)) {stats.nonProduction++;continue;}
  if(`${power} · ${trim}`.length>200) {stats.overlong++;continue;}
  const manufacturer=usable(r['基本参数_厂商'])?r['基本参数_厂商'].trim():undefined;
  const displayKey=JSON.stringify([model.id,year,power,trim,manufacturer]);
  if(seen.has(displayKey)) {stats.duplicate++;continue;}
  seen.add(displayKey);
  fuels[fuel]=(fuels[fuel]||0)+1;
  variants.push({id:`utf6-model-${r['车型ID']}`,modelCatalogId:model.id,year,power,trim,sourceId:'utf6-trims-201805',sourceEvidence:`年代款=${r['年代款']}；车型名称=${r['车型名称']}；燃料形式=${fuel}；${fuel==='纯电动'?`电动机总功率(kW)=${r['电动机_电动机总功率(kW)']}`:`发动机=${r['基本参数_发动机']}`}；变速箱=${gearbox||'未载明'}`,...(manufacturer?{manufacturer}:{})});
}
// Manually verified short facts from the rendered official comparison tables.
// Each tuple is one configuration column; do not cross-join fields across trims.
// The explicit 2026 model-year comes from the table heading, never its URL/date.
if (variants.length !== 29169) throw new Error(`Unexpected historical variant count (${variants.length}); review the source/catalog before replacing the snapshot`);
const historicalAccepted=variants.length;
const officialTables=[
  {
    modelName:'秦L', slug:'qinl-dmi', sourceId:'official-byd-qinl-2026-variants',
    heading:'2026款秦L DM-i参数配置表',
    columns:[['128KM进取型','1.5L',74,120,15.87],['128KM领先型','1.5L',74,160,15.87],['210KM超越型','1.5L',74,175,25.28],['210KM云辇型','1.5L',74,175,25.28]],
  },
  {
    modelName:'海鸥', slug:'seagull', sourceId:'official-byd-seagull-2026-variants',
    heading:'2026款海鸥参数配置表',
    columns:[['活力版',null,null,55,30.08],['自由版',null,null,55,30.08],['自在版',null,null,55,38.88],['飞翔版',null,null,55,38.88]],
  },
  {
    modelName:'海豹07', slug:'seal07-dmi', sourceId:'official-byd-seal07-2026-variants',
    heading:'2026款海豹07DM-i参数表及配置表',
    columns:[['1.5L 135KM豪华型','1.5L',74,160,17.6],['1.5T 135KM尊贵型','1.5Ti',115,200,17.6],['1.5T 230KM尊荣型','1.5Ti',115,200,29.46],['1.5T 230KM旗舰型','1.5Ti',115,200,29.46]],
  },
];
for(const table of officialTables) {
  const model=lookup.get(key('比亚迪',table.modelName));
  if(!model) throw new Error(`Official series binding missing: ${table.modelName}`);
  for(const [trim,engine,engineKw,motorKw,batteryKwh] of table.columns) {
    const power=engine
      ? `插混 DM-i · ${engine}发动机 ${engineKw} kW · 电机 ${motorKw} kW · EHS电混系统`
      : `纯电动 · 交流永磁同步电机 ${motorKw} kW · 电池 ${batteryKwh} kWh`;
    const sourceEvidence=`表头=${table.heading}；配置列=${trim}；${engine?`插混专用${engine}发动机最大功率(kW)=${engineKw}；`:'驱动电机类型=交流永磁同步电机；'}${table.slug==='seal07-dmi'?'前电机':table.slug==='qinl-dmi'?'电机':'驱动电机'}最大功率(kW)=${motorKw}；${engine?'电池容量':'动力电池容量'}(kWh)=${batteryKwh}${engine?'；变速系统=EHS电混系统':''}`;
    variants.push({id:`official-byd-${table.slug}-2026-${sha256(trim).slice(0,12)}`,modelCatalogId:model.id,year:2026,power,trim,sourceId:table.sourceId,sourceEvidence});
  }
}
stats.accepted=variants.length;
const counts={};for(const v of variants) counts[v.year]=(counts[v.year]||0)+1;
const data=JSON.stringify(variants,null,2)+'\n';
const result={...stats,historicalAccepted,officialAccepted:variants.length-historicalAccepted,bytes:Buffer.byteLength(data),sourceSHA256:sha256(sql),columns:columns.length,historicalFuels:fuels,byYear:counts,models:new Set(variants.map(v=>v.modelCatalogId)).size,brands:new Set(variants.map(v=>models.find(m=>m.id===v.modelCatalogId)?.brand)).size,examples:variants.slice(0,3),rejected};
if (stats.errors || new Set(variants.map(v=>v.id)).size !== variants.length) throw new Error('Invalid source rows or duplicate variant IDs');
if (variants.length !== 29181) throw new Error(`Unexpected variant count (${variants.length}); review the source/catalog before replacing the snapshot`);
await writeFile(resolve(cacheDir, 'stats.json'),JSON.stringify(result,null,2)+'\n');
await writeFile(resolve(root, 'apps/api/src/data/catalog-variants.json'),data);
console.log(JSON.stringify(result,null,2));
