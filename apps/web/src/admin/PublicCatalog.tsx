import { useEffect, useRef, useState, type FormEvent } from 'react';
import { AlertCircle, ArrowLeft, ArrowRight, BookOpen, CarFront, Check, CheckCircle2, ExternalLink, LibraryBig, Search, Wrench, X } from 'lucide-react';
import type { CarModel, CatalogModel, CatalogModelImportResult, CatalogModelsResponse, CatalogProject, CatalogProjectImportResult, CatalogProjectsResponse, CatalogSource, Project } from '@autovoyage/shared';
import { api, post } from '../lib/api';
import { manualActionNames } from './ManualWorkbench';
import './public-catalog.css';

type Provenance = { catalogId: string; version: string; sources: CatalogSource[]; importedAt: string };
interface Props { kind: 'models' | 'projects'; models: CarModel[]; projects: Project[]; onRefresh: () => Promise<void>; onClose: () => void }
const normalize = (value: string) => value.normalize('NFKC').trim().toLocaleLowerCase().replace(/\s+/g, '');
const errorText = (error: unknown) => error instanceof Error ? error.message : '暂时无法完成操作，请重试。';

function SourceLinks({ sources }: { sources: CatalogSource[] }) {
  return <ul className="pc-source-list">{sources.map(source => <li key={source.id}>
    <a href={source.url} target="_blank" rel="noreferrer">{source.title}<ExternalLink size={13} aria-hidden="true" /></a>
    <small>{source.license} · 查阅日期 {source.retrievedAt.slice(0, 10)}</small>
    <p>{source.description}</p>
  </li>)}</ul>;
}

export function CatalogProvenance({ value }: { value?: Provenance }) {
  if (!value) return null;
  return <details className="pc-provenance"><summary><LibraryBig size={14} aria-hidden="true" />公开资源来源</summary><div><SourceLinks sources={value.sources} /><small>导入版本 {value.version} · {value.importedAt.slice(0, 10)}</small></div></details>;
}

export default function PublicCatalog({ kind, models, projects, onRefresh, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const previewRef = useRef<HTMLElement>(null);
  const yearRef = useRef<HTMLInputElement>(null);
  const [searchInput, setSearchInput] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('');
  const [offset, setOffset] = useState(0);
  const [retry, setRetry] = useState(0);
  const [modelList, setModelList] = useState<CatalogModelsResponse | null>(null);
  const [projectList, setProjectList] = useState<CatalogProjectsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ text: string; error: boolean } | null>(null);
  const [selectedModel, setSelectedModel] = useState<CatalogModel | null>(null);
  const [selectedProjects, setSelectedProjects] = useState<CatalogProject[]>([]);
  const [year, setYear] = useState('');
  const [power, setPower] = useState('');
  const [localProjectIds, setLocalProjectIds] = useState<string[]>([]);
  const isModels = kind === 'models';
  const list = isModels ? modelList : projectList;
  const sources = list?.sources || [];
  const projectExists = (entry: CatalogProject) => localProjectIds.includes(entry.id) || projects.some(project => project.catalogSource?.catalogId === entry.id || normalize(project.name) === normalize(entry.name));
  const close = () => { if (!busy) onClose(); };

  useEffect(() => {
    const node = ref.current;
    node?.showModal();
    return () => { node?.close(); };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setLoadError('');
    const params = new URLSearchParams({ q: query });
    if (filter) params.set(isModels ? 'brand' : 'category', filter);
    if (isModels) { params.set('offset', String(offset)); params.set('limit', '20'); }
    const request = isModels
      ? api<CatalogModelsResponse>(`/admin/catalog/models?${params}`, { signal: controller.signal }).then(setModelList)
      : api<CatalogProjectsResponse>(`/admin/catalog/projects?${params}`, { signal: controller.signal }).then(setProjectList);
    void request.catch(error => { if (!controller.signal.aborted) setLoadError(errorText(error)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [isModels, query, filter, offset, retry]);

  useEffect(() => {
    if (!selectedModel) return;
    yearRef.current?.focus({ preventScroll: true });
    if (window.matchMedia('(max-width: 767px)').matches) {
      previewRef.current?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    }
  }, [selectedModel]);

  function search(event: FormEvent) {
    event.preventDefault(); setQuery(searchInput.trim()); setOffset(0);
  }

  async function importModel(event: FormEvent) {
    event.preventDefault();
    if (!selectedModel || busy) return;
    const parsedYear = Number(year);
    if (!year || !Number.isInteger(parsedYear) || parsedYear < 1950 || parsedYear > 2100 || !power.trim()) {
      setResult({ text: '请填写实际车型年款和动力配置。', error: true }); return;
    }
    setBusy(true); setResult(null);
    let saved = false;
    try {
      const response = await post<CatalogModelImportResult>('/admin/catalog/models/import', { catalogId: selectedModel.id, year: parsedYear, power: power.trim() });
      saved = true;
      await onRefresh();
      setResult({ text: response.created ? `已导入 ${response.model.brand} ${response.model.name} ${response.model.year} 款。可继续选择车型，或关闭目录查看档案。` : '相同品牌、车型、年款和动力配置的档案已存在，已保留原档案。', error: false });
    } catch (error) { setResult({ text: saved ? '车型已保存，页面数据暂未刷新。请关闭目录后刷新业务数据查看。' : errorText(error), error: true }); }
    finally { setBusy(false); }
  }

  async function importProjects() {
    if (!selectedProjects.length || busy) return;
    setBusy(true); setResult(null);
    let saved = false;
    try {
      const response = await post<CatalogProjectImportResult>('/admin/catalog/projects/import', { catalogIds: selectedProjects.map(project => project.id) });
      saved = true;
      setLocalProjectIds(previous => [...new Set([...previous, ...selectedProjects.map(project => project.id)])]);
      setSelectedProjects([]);
      await onRefresh();
      setResult({ text: `已导入 ${response.created} 个服务项目${response.existing ? `，${response.existing} 个已有项目已保留` : ''}。可在标准服务项目中维护服务说明。`, error: false });
    } catch (error) { setResult({ text: saved ? '所选项目已保存，页面数据暂未刷新。请关闭目录后刷新业务数据查看。' : errorText(error), error: true }); }
    finally { setBusy(false); }
  }

  return <dialog ref={ref} className="ad-dialog pc-dialog" aria-labelledby="pc-title" onCancel={event => { event.preventDefault(); close(); }}>
    <header className="ad-dialog-head"><div><span className="pc-eyebrow">PUBLIC RESOURCE LIBRARY</span><h2 id="pc-title">{isModels ? '公开车型库' : '参考服务项目库'}</h2><p>{isModels ? '从品牌与车系开始，补充实际配置后创建车型档案。' : '选择常见保养项目，建立统一的服务目录。'}</p></div><button className="ad-icon-button" type="button" onClick={close} disabled={busy} aria-label="关闭公开资源目录"><X size={20} /></button></header>
    <div className="ad-dialog-body pc-body">
      <div className="pc-intro"><span>{isModels ? <CarFront size={23} /> : <Wrench size={23} />}</span><p>{isModels ? '目录包含历史车系与官网补充条目，资料时期见来源说明。年款、动力及具体配置请依据车辆资料填写，保养范围后续按对应手册核对。' : '项目名称与操作参考公开保养资料整理。每个项目的适用车型、周期与报价，请在手册和门店服务中分别配置。'}</p></div>
      {result && <div role={result.error ? 'alert' : 'status'} className={`pc-result ${result.error ? 'pc-result-error' : ''}`}>{result.error ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}<p>{result.text}</p></div>}
      <form className="pc-filters" onSubmit={search}>
        <label className="pc-search"><span className="pc-label">{isModels ? '品牌或车系' : '名称或项目编码'}</span><span><Search size={17} /><input value={searchInput} onChange={event => setSearchInput(event.target.value)} maxLength={100} placeholder={isModels ? '如：比亚迪、海鸥' : '如：制动液、空气滤清器'} disabled={busy} /></span></label>
        <label className="pc-filter"><span className="pc-label">{isModels ? '汽车品牌' : '项目分类'}</span><select value={filter} onChange={event => { setFilter(event.target.value); setOffset(0); }} disabled={busy}><option value="">{isModels ? '全部品牌' : '全部分类'}</option>{(isModels ? modelList?.brands : projectList?.categories)?.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
        <button className="ad-button ad-button-primary" type="submit" disabled={busy || loading}>搜索</button>
      </form>
      {loadError ? <div className="pc-empty" role="alert"><BookOpen size={27} /><h3>目录暂时无法加载</h3><p>{loadError}</p><button className="ad-button" type="button" onClick={() => setRetry(value => value + 1)}>重新加载</button></div> : <>
        <div className="pc-count" role="status">{loading ? '正在查询公开资源…' : `找到 ${list?.total || 0} ${isModels ? '个车系' : '个参考项目'}`}<span>{list?.version ? `目录版本 ${list.version}` : ''}</span></div>
        {isModels ? <div className="pc-model-layout">
          <section className="pc-results" aria-label="公开车系列表" aria-busy={loading}>
            {modelList?.items.length ? <div className="pc-model-list">{modelList.items.map(entry => <button key={entry.id} type="button" className={`pc-model-option ${selectedModel?.id === entry.id ? 'pc-model-selected' : ''}`} aria-pressed={selectedModel?.id === entry.id} onClick={() => { setSelectedModel(entry); setYear(''); setPower(''); setResult(null); }} disabled={busy || loading}><span className="pc-option-icon"><CarFront size={24} strokeWidth={1.4} /></span><span><small>{entry.brand}</small><strong>{entry.name}</strong></span>{selectedModel?.id === entry.id ? <Check size={19} /> : <ArrowRight size={17} />}</button>)}</div> : !loading && <div className="pc-empty"><Search size={25} /><h3>没有匹配的车系</h3><p>换个品牌或关键词，也可以关闭目录手动新增车型。</p></div>}
            {modelList && modelList.total > modelList.limit && <nav className="pc-pagination" aria-label="公开车型分页"><button type="button" className="ad-button" disabled={loading || busy || offset === 0} onClick={() => setOffset(value => Math.max(0, value - 20))}><ArrowLeft size={15} />上一页</button><span>第 {Math.floor(offset / 20) + 1} / {Math.ceil(modelList.total / 20)} 页</span><button type="button" className="ad-button" disabled={loading || busy || offset + modelList.limit >= modelList.total} onClick={() => setOffset(value => value + 20)}>下一页<ArrowRight size={15} /></button></nav>}
          </section>
          <aside ref={previewRef} className="pc-model-preview" aria-label="车型导入预览">{selectedModel ? <form onSubmit={event => void importModel(event)}><span className="pc-eyebrow">CREATE A MODEL PROFILE</span><h3>{selectedModel.brand} · {selectedModel.name}</h3><p>补齐该车系的实际年款和配置。</p><label className="ad-field"><span>实际车型年款 <i aria-hidden="true">*</i></span><input ref={yearRef} type="number" min={1950} max={2100} step={1} value={year} onChange={event => setYear(event.target.value)} required disabled={busy} placeholder="请核对车辆年款" /></label><label className="ad-field"><span>动力及具体配置 <i aria-hidden="true">*</i></span><input value={power} onChange={event => setPower(event.target.value)} maxLength={200} required disabled={busy} placeholder="如：纯电 405km 自由版" /><small>同一车系的不同配置可能使用不同的保养手册。</small></label><div className="pc-pending"><BookOpen size={17} /><span>保养项目范围：待手册核对</span></div><SourceLinks sources={sources.filter(source => source.id === selectedModel.sourceId)} /><button type="submit" className="ad-button ad-button-primary pc-import-model" disabled={busy || !year || !power.trim()}>{busy ? '正在导入…' : '导入车型档案'}<ArrowRight size={16} /></button>{models.some(model => normalize(model.brand) === normalize(selectedModel.brand) && normalize(model.name) === normalize(selectedModel.name) && model.year === Number(year) && normalize(model.power) === normalize(power)) && <p className="pc-existing">相同配置已在系统中，再次导入会保留现有档案。</p>}</form> : <div className="pc-preview-empty"><CarFront size={40} strokeWidth={1.2} /><h3>选择一个车系</h3><p>在左侧列表中选择，再补充年款与配置。</p></div>}</aside>
        </div> : <>
          <div className="pc-project-list" aria-label="参考项目列表" aria-busy={loading}>{projectList?.items.map(entry => {
            const selected = selectedProjects.some(project => project.id === entry.id);
            const existing = projectExists(entry);
            return <article key={entry.id} className={`pc-project-card ${selected ? 'pc-project-selected' : ''}`}><label className="pc-project-choice"><input type="checkbox" checked={selected} disabled={busy || loading || existing} onChange={event => setSelectedProjects(previous => event.target.checked ? [...previous, entry] : previous.filter(project => project.id !== entry.id))} /><span><strong>{entry.name}</strong><small>{entry.category} · {manualActionNames[entry.action]} · {entry.unit}</small></span>{existing && <span className="pc-imported"><Check size={13} />已导入</span>}</label><p>{entry.description}</p><div className="pc-project-meta"><code>{entry.code}</code><details><summary>查看参考来源</summary><SourceLinks sources={sources.filter(source => entry.sourceIds.includes(source.id))} /></details></div></article>;
          })}{!loading && !projectList?.items.length && <div className="pc-empty"><Search size={25} /><h3>没有匹配的项目</h3><p>换个关键词，或通过手动新增补充项目。</p></div>}</div>
          <section className="pc-selection" aria-label="已选服务项目"><div><strong>已选 {selectedProjects.length} 项</strong><button className="ad-link-button" type="button" onClick={() => setSelectedProjects([])} disabled={busy || !selectedProjects.length}>清空选择</button></div>{selectedProjects.length > 0 && <ul>{selectedProjects.map(project => <li key={project.id}>{project.name}<button type="button" onClick={() => setSelectedProjects(previous => previous.filter(entry => entry.id !== project.id))} aria-label={`移除${project.name}`} disabled={busy}><X size={14} /></button></li>)}</ul>}<button type="button" className="ad-button ad-button-primary" onClick={() => void importProjects()} disabled={busy || !selectedProjects.length}>{busy ? '正在导入…' : `导入所选 ${selectedProjects.length} 个项目`}<ArrowRight size={16} /></button></section>
        </>}
      </>}
      <footer className="pc-footer"><span><LibraryBig size={15} />公开目录随系统预置，导入后可维护本平台档案。</span><button type="button" className="ad-button ad-button-ghost" disabled={busy} onClick={close}>完成并关闭</button></footer>
    </div>
  </dialog>;
}
