import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {CarModel} from '@autovoyage/shared';
import {discoverManualSources, discoverManualSourcesDetailed, manualDownloadLimit, modelManualQueries, parseManualSearchResults, validateSourceUrl, type publicDownload} from '../src/manual-sources.js';

const model:CarModel={id:'synthetic-open-search',brand:'丰田',name:'凯美瑞 · 测试档案',year:2025,power:'汽油 2.0L CVT',isDemo:true};
const result=(title:string,url:string,snippet='凯美瑞保养手册，含保养项目和周期表。')=>`<li class="b_algo"><h2><a href="${url.replace(/&/g,'&amp;')}">${title}</a></h2><div class="b_caption"><p>${snippet}</p></div></li>`;
const page=(html:string,url:string)=>({bytes:Buffer.from(html),type:'text/html',url});
const toyotaDirectory='https://www.gac-toyota.com.cn/enjoy-service/usermanual';
const toyotaData='https://www.gac-toyota.com.cn/2022/src/assets/json/usermanual.js';
function emptyToyotaCatalogue(url:string){
 if(url===toyotaDirectory)return page('<title>用户手册</title><script src="/2022/src/assets/json/usermanual.js"></script>',url);
 if(url===toyotaData)return page('_baseData.usermanualModle = [];',url);
 return undefined;
}
const searchDiagnostics=(report:Awaited<ReturnType<typeof discoverManualSourcesDetailed>>)=>report.diagnostics.filter(item=>item.provider==='bing'||item.provider==='duckduckgo');

test('larger download limits apply only to the exact verified official Toyota PDF path',()=>{
 const normal=32*1024*1024, official=96*1024*1024;
 assert.equal(manualDownloadLimit('https://www.gac-toyota.com.cn/pdf/web/usermanual/2024_380T.pdf'),official);
 assert.equal(manualDownloadLimit('https://www.gac-toyota.com.cn:443/pdf/web/usermanual/2024_380T.pdf?download=1'),official);
 for(const url of [
  'https://gac-toyota.com.cn/pdf/web/usermanual/manual.pdf',
  'https://www.gac-toyota.com.cn.evil.example/pdf/web/usermanual/manual.pdf',
  'https://www.gac-toyota.com.cn@evil.example/pdf/web/usermanual/manual.pdf',
  'https://user:secret@www.gac-toyota.com.cn/pdf/web/usermanual/manual.pdf',
  'http://www.gac-toyota.com.cn/pdf/web/usermanual/manual.pdf',
  'https://www.gac-toyota.com.cn:444/pdf/web/usermanual/manual.pdf',
  'https://www.gac-toyota.com.cn/pdf/other/manual.pdf',
  'https://www.gac-toyota.com.cn/PDF/web/usermanual/manual.pdf',
  'https://www.gac-toyota.com.cn/pdf/web/usermanual/manual.html',
  'https://www.gac-toyota.com.cn/pdf/web/usermanual/subdir/manual.pdf',
  'https://another-official.example/manual.pdf',
  'invalid-url',
 ])assert.equal(manualDownloadLimit(url),normal,url);
});

test('open manual search reads concrete evidence across arbitrary public source sites and keeps portals distinct',()=>{
 const wrapped='https://www.bing.com/ck/a?u=a1'+Buffer.from('https://independent-manual.example/camry.pdf?utm_source=search').toString('base64url');
 const html=result('丰田凯美瑞保养手册',wrapped)+result('丰田凯美瑞保养手册重复','https://independent-manual.example/camry.pdf')+
  result('三包政策及维修保养手册信息查询','https://www.ftms.com.cn/manual/','丰田官方资料入口，选择车型查看保养手册。')+
  result('凯美瑞车系报价和图片','https://cars.example/camry','凯美瑞频道，报价、图片、保养周期和论坛入口。')+
  result('凯美瑞用车感受','https://forum.example/driving','凯美瑞很好开，省油，外观不错。')+
  result('雅阁保养手册','https://other-brand.example/accord','雅阁保养周期表')+
  result('凯美瑞保养手册','https://127.0.0.1/private')+result('凯美瑞保养手册','http://insecure.example/manual.pdf')+
  '<aside><a href="https://advert.example/manual">凯美瑞保养手册广告</a></aside>';
 const found=parseManualSearchResults(html,'https://www.bing.com/search?q=test',model);
 assert.deepEqual(found.map(s=>s.url),['https://independent-manual.example/camry.pdf','https://www.ftms.com.cn/manual/','https://cars.example/camry']);
 assert.deepEqual(found.map(s=>s.isDirectory),[false,true,true]);
 assert.equal(found[0].kind,'other');assert.equal(found[1].kind,'official');
 assert.match(found[0].description,/车系通用资料候选/);
 const fuelWithoutLabel=parseManualSearchResults(result('凯美瑞双擎保养手册','https://independent.example/hybrid','凯美瑞双擎混动保养手册'),'https://www.bing.com/search?q=test',{...model,power:'2.0L CVT'});
 assert.match(fuelWithoutLabel[0].description,/动力与当前车型可能冲突/);
 const timetable=parseManualSearchResults(result('凯美瑞保养时间表','https://independent.example/timetable','厂家规定的定期维护计划。'),'https://www.bing.com/search?q=test',model);
 assert.equal(timetable[0].url,'https://independent.example/timetable');
});

test('search engine wrappers cannot smuggle credentials/private URLs and DDG organic links can be used',()=>{
 assert.throws(()=>validateSourceUrl('https://outside.example/'+ 'x'.repeat(2500)),/网址过长/);
 const urls=['https://user:password@outside.example/a.pdf','https://127.0.0.1/private','javascript:alert(1)'];
 const html=urls.map(url=>result('凯美瑞保养手册','https://www.bing.com/ck/a?u=a1'+Buffer.from(url).toString('base64url'))).join('')+
  '<div class="result"><h2><a class="result__a" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fpublished.example%2Fcamry.html">凯美瑞保养周期表</a></h2><div class="result__snippet">凯美瑞通用保养表原文</div></div>';
 const found=parseManualSearchResults(html,'https://html.duckduckgo.com/html/',model);
 assert.equal(found.length,1);assert.equal(found[0].url,'https://published.example/camry.html');assert.equal(found[0].isDirectory,false);
});

test('discovery makes broad open queries, merges sources and lowers explicit power conflicts without inventing links',async()=>{
 const calls:Array<{url:string,timeout:number|undefined}>=[];
 const download=(async(url:string,_redirects?:number,_post?:string,timeout?:number)=>{
  const official=emptyToyotaCatalogue(url);if(official)return official;
  calls.push({url,timeout});
  return page(result('凯美瑞双擎保养手册','https://independent.example/hybrid.pdf','凯美瑞双擎混动保养手册')+
   result('凯美瑞保养周期表','https://published.example/camry.html')+
   result('丰田凯美瑞保养手册','https://www.ftms.com.cn/camry/manual.pdf'),url);
 }) as typeof publicDownload;
 const found=await discoverManualSources(model,{download,cache:false});
 assert.equal(calls.length,3);
 assert.deepEqual(calls.map(c=>new URL(c.url).searchParams.get('q')),modelManualQueries(model));
 assert(calls.every(c=>c.timeout===6500));
 assert(calls.every(c=>!new URL(c.url).searchParams.get('q')?.includes('site:')));
 assert(calls.slice(0,2).every(c=>!new URL(c.url).searchParams.get('q')?.includes('2025')));
 assert(new URL(calls[2].url).searchParams.get('q')?.includes('2025 汽油 2.0L CVT'));
 assert.equal(found[0].url,'https://www.ftms.com.cn/camry/manual.pdf');
 assert.equal(found.filter(s=>s.url==='https://published.example/camry.html').length,1);
 assert.match(found.find(s=>s.url==='https://independent.example/hybrid.pdf')!.description,/动力与当前车型可能冲突/);
 assert(found.findIndex(s=>s.url==='https://independent.example/hybrid.pdf')>found.findIndex(s=>s.url==='https://published.example/camry.html'));
 assert(found.slice(-2).every(s=>s.isDirectory));
});

test('blocked search engines return honest fallback directories and unsupported marketing results are not manuals',async()=>{
 let calls=0;
 const download=(async(url:string)=>{const official=emptyToyotaCatalogue(url);if(official)return official;calls++;if(calls===1)throw new Error('unavailable');return page(result('丰田凯美瑞参数配置','https://cars.example/specs','凯美瑞报价和图片'),url);}) as typeof publicDownload;
 const found=await discoverManualSources(model,{download,cache:false});
 assert.equal(calls,4);assert(found.length>0);assert(found.every(s=>s.isDirectory));
 assert.match(found[0].description,/开放互联网搜索暂未取得/);
 assert.deepEqual(modelManualQueries({...model,name:'Model Y',brand:'特斯拉'}),['特斯拉 Model Y 保养手册','特斯拉 Model Y 保养周期表','特斯拉 Model Y 2025 汽油 2.0L CVT 官方 用户手册 保养时间表']);
});

test('detailed discovery distinguishes irrelevant results, access challenges and connection failures without returning upstream content',async()=>{
 const queries=modelManualQueries(model);
 const download=(async(url:string)=>{
  const official=emptyToyotaCatalogue(url);if(official)return official;
  const query=new URL(url).searchParams.get('q');
  if(url.includes('duckduckgo'))return page('<html><body>No results</body></html>',url);
  if(query===queries[0])return page(result('丰田品牌官方网站','https://www.toyota.com.cn/','丰田品牌新闻与车型报价。'),url);
  if(query===queries[1])return page('<html><body><form id="challenge-form">Verify you are a human</form>'+result('凯美瑞保养手册','https://www.gac-toyota.com.cn/manual.pdf')+'</body></html>',url);
  throw new Error('PRIVATE_UPSTREAM_RESPONSE_AND_HTML');
 }) as typeof publicDownload;
 const found=await discoverManualSourcesDetailed(model,{download,cache:false});
 assert.equal(found.status,'unavailable');
 assert(found.sources.every(source=>source.isDirectory));
 assert.deepEqual(searchDiagnostics(found).map(item=>item.state),['irrelevant','blocked','unavailable','empty']);
 assert(found.diagnostics.every(item=>item.candidateCount===0));
 assert(found.diagnostics.length<=8);
 assert.doesNotMatch(JSON.stringify(found),/PRIVATE_UPSTREAM|<html|challenge-form/);
});

test('a verified concrete candidate wins over a failed engine and Guangqi Toyota is recognized as official',async()=>{
 let reads=0;
 const download=(async(url:string)=>{
  const official=emptyToyotaCatalogue(url);if(official)return official;
  reads++;
  if(reads===1)throw new Error('search temporarily unavailable');
  return page(result('凯美瑞保养手册','https://www.gac-toyota.com.cn/manual/camry.pdf'),url);
 }) as typeof publicDownload;
 const found=await discoverManualSourcesDetailed(model,{download,cache:false});
 assert.equal(found.status,'available');
 assert.equal(found.sources[0].kind,'official');
 assert(found.diagnostics.some(item=>item.state==='unavailable'));
 assert(found.diagnostics.some(item=>item.state==='relevant'));
 const spoof=parseManualSearchResults(result('凯美瑞保养手册','https://www.gac-toyota.com.cn.evil.example/camry.pdf'),'https://www.bing.com/search',model);
 assert.equal(spoof[0].kind,'other');
});

test('completed related directory searches remain distinct from unavailable searches',async()=>{
 const download=(async(url:string)=>emptyToyotaCatalogue(url)||page(result('丰田保养手册信息查询系统','https://www.ftms.com.cn/manual/','丰田官方保养手册资料入口，选择车型查看。'),url)) as typeof publicDownload;
 const found=await discoverManualSourcesDetailed(model,{download,cache:false});
 assert.equal(found.status,'no_results');
 assert(found.sources.every(source=>source.isDirectory));
 assert(searchDiagnostics(found).every(item=>item.state==='relevant'));
 assert(found.diagnostics.some(item=>item.provider==='duckduckgo'));
});

test('detailed diagnostics and sources share the bounded discovery cache with the legacy wrapper',async()=>{
 let reads=0;
 const uniqueModel={...model,year:2031};
 const download=(async(url:string)=>{reads++;return emptyToyotaCatalogue(url)||page(result('凯美瑞保养周期表','https://published.example/cache-camry.html'),url);}) as typeof publicDownload;
 const first=await discoverManualSourcesDetailed(uniqueModel,{download});
 const count=reads;
 const cached=await discoverManualSourcesDetailed(uniqueModel,{download});
 const legacy=await discoverManualSources(uniqueModel,{download});
 assert.equal(reads,count);
 assert.deepEqual(cached,first);
 assert.deepEqual(legacy,first.sources);
 assert.equal(cached.status,'available');
 assert.equal(searchDiagnostics(cached).length,3);
});

test('the independent official Toyota catalogue supplies a real model PDF when every search-engine query fails',async()=>{
 const highlander={...model,name:'汉兰达 · 380T四驱豪华版7座',year:2024,power:'汽油 2.0T 8AT'};
 const calls:string[]=[];
 const manualUrl='https://www.gac-toyota.com.cn/pdf/web/usermanual/highlander-2405.pdf';
 const download=(async(url:string)=>{
  calls.push(url);
  if(url===toyotaDirectory)return page('<title>用户手册</title><script src="/2022/src/assets/json/usermanual.js"></script>',url);
  if(url===toyotaData)return page(`_baseData.usermanualModle = [{carName:'汉兰达',adtype:'4highlander',manualData:[{title:'2024款汉兰达汽油版用户手册-2405版',downloadUrl:'${manualUrl}'}]}];`,url);
  throw new Error('PRIVATE_SEARCH_ENGINE_FAILURE');
 }) as typeof publicDownload;
 const found=await discoverManualSourcesDetailed(highlander,{download,cache:false});
 assert.equal(found.status,'available');
 assert.equal(found.sources[0].url,manualUrl);
 assert.equal(found.sources[0].kind,'official');
 assert.equal(found.sources[0].isDirectory,false);
 assert(found.diagnostics.some(item=>item.provider==='gac_toyota'&&item.state==='relevant'));
 assert(found.diagnostics.filter(item=>item.provider==='bing').every(item=>item.state==='unavailable'));
 assert.equal(calls.filter(url=>url.includes('bing.com')).length,3);
 assert(!calls.some(url=>url.includes('duckduckgo')));
 assert.doesNotMatch(JSON.stringify(found),/PRIVATE_SEARCH_ENGINE_FAILURE/);
});
