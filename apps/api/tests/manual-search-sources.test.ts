import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {CarModel} from '@autovoyage/shared';
import {discoverManualSources, modelManualQueries, parseManualSearchResults, validateSourceUrl, type publicDownload} from '../src/manual-sources.js';

const model:CarModel={id:'synthetic-open-search',brand:'丰田',name:'凯美瑞 · 测试档案',year:2025,power:'汽油 2.0L CVT',isDemo:true};
const result=(title:string,url:string,snippet='凯美瑞保养手册，含保养项目和周期表。')=>`<li class="b_algo"><h2><a href="${url.replace(/&/g,'&amp;')}">${title}</a></h2><div class="b_caption"><p>${snippet}</p></div></li>`;
const page=(html:string,url:string)=>({bytes:Buffer.from(html),type:'text/html',url});

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
 const download=(async(url:string)=>{calls++;if(calls===1)throw new Error('unavailable');return page(result('丰田凯美瑞参数配置','https://cars.example/specs','凯美瑞报价和图片'),url);}) as typeof publicDownload;
 const found=await discoverManualSources(model,{download,cache:false});
 assert.equal(calls,4);assert(found.length>0);assert(found.every(s=>s.isDirectory));
 assert.match(found[0].description,/开放互联网搜索暂未取得/);
 assert.deepEqual(modelManualQueries({...model,name:'Model Y',brand:'特斯拉'}),['特斯拉 Model Y 保养手册','特斯拉 Model Y 保养周期表','特斯拉 Model Y 2025 汽油 2.0L CVT 官方 用户手册 保养时间表']);
});
