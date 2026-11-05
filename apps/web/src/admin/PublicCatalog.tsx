import { useEffect, useRef, useState, type FormEvent } from 'react';
import { AlertCircle, ArrowLeft, ArrowRight, BookOpen, CarFront, Check, CheckCircle2, ExternalLink, LibraryBig, Search, Wrench, X } from 'lucide-react';
import type { CarModel, CatalogModel, CatalogModelImportResult, CatalogModelsResponse, CatalogVariant, CatalogVariantsResponse, CatalogProject, CatalogProjectImportResult, CatalogProjectsResponse, CatalogSource, Project } from '@autovoyage/shared';
import { api, post } from '../lib/api';
import { manualActionNames } from './ManualWorkbench';
import './public-catalog.css';

type Provenance = { catalogId: string; version: string; sources: CatalogSource[]; importedAt: string; variantId?: string; sourceEvidence?: string; manufacturer?: string };
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
  return <details className="pc-provenance"><summary><LibraryBig size={14} aria-hidden="true" />公开资源来源</summary><div><SourceLinks sources={value.sources} />{value.manufacturer && <p>生产厂商：{value.manufacturer}</p>}{value.sourceEvidence && <p className="pc-evidence">配置依据：{value.sourceEvidence}</p>}<small>导入版本 {value.version} · {value.importedAt.slice(0, 10)}</small></div></details>;
}

function ModelImportPreview({ model, initialYear, sources, models, busy, setBusy, setResult, onRefresh }: {
  model: CatalogModel; sources: CatalogSource[]; models: CarModel[]; busy: boolean;
  initialYear: string;
  setBusy: (value: boolean) => void; setResult: (value: { text: string; error: boolean } | null) => void;
  onRefresh: () => Promise<void>;
}) {
  const yearRef = useRef<HTMLSelectElement>(null);
  const focusOrigin = useRef(document.activeElement);
  const focusedYear = useRef(false);
  const [manual, setManual] = useState(false);
  const [year, setYear] = useState(() => model.years?.includes(Number(initialYear)) ? initialYear : '');
  const [powerFilter, setPowerFilter] = useState('');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [retry, setRetry] = useState(0);
  const [catalog, setCatalog] = useState<CatalogVariantsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<CatalogVariant | null>(null);
  const [manualYear, setManualYear] = useState(initialYear);
  const [manualPower, setManualPower] = useState('');
  const searchPending = search.trim() !== query;
  const selectedPower = selected ? `${selected.power} · ${selected.trim}` : '';
  const activeYear = manual ? Number(manualYear) : selected?.year;
  const activePower = manual ? manualPower.trim() : selectedPower;
  const existing = models.some(entry => normalize(entry.brand) === normalize(model.brand) && normalize(entry.name) === normalize(model.name) && entry.year === activeYear && normalize(entry.power) === normalize(activePower));

  useEffect(() => {
    if (!focusedYear.current && catalog && !manual) {
      focusedYear.current = true;
      if (catalog.years.length && document.activeElement === focusOrigin.current) yearRef.current?.focus({ preventScroll: true });
    }
  }, [catalog, manual]);
  useEffect(() => {
    const timer = window.setTimeout(() => { setQuery(search.trim()); setOffset(0); }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    if (manual) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ q: query, offset: String(offset), limit: '20' });
    if (year) params.set('year', year);
    if (powerFilter) params.set('power', powerFilter);
    setLoading(true); setError('');
    void api<CatalogVariantsResponse>(`/admin/catalog/models/${encodeURIComponent(model.id)}/variants?${params}`, { signal: controller.signal }).then(value => { if (!controller.signal.aborted) setCatalog(value); })
      .catch(cause => { if (!controller.signal.aborted) setError(errorText(cause)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [model.id, manual, year, powerFilter, query, offset, retry]);

  function enterManual() { setManual(true); setManualYear(value => year || value || initialYear); setSelected(null); setResult(null); }
  function changeMode() { if (manual) setManual(false); else enterManual(); setSelected(null); setResult(null); }
  async function importModel(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (manual ? !manualYear || !Number.isInteger(Number(manualYear)) || Number(manualYear) < 1950 || Number(manualYear) > 2100 || !manualPower.trim() : !selected || loading || searchPending) {
      setResult({ text: manual ? '请填写实际车型年款和完整动力配置。' : '请按年款选择一条公开的完整配置。', error: true }); return;
    }
    setBusy(true); setResult(null);
    let saved = false;
    try {
      const response = await post<CatalogModelImportResult>('/admin/catalog/models/import', manual ? { catalogId: model.id, year: Number(manualYear), power: manualPower.trim() } : { catalogId: model.id, variantId: selected!.id });
      saved = true;
      await onRefresh();
      setResult({ text: response.created ? `已导入 ${response.model.brand} ${response.model.name} ${response.model.year} 款 · ${response.model.power}。` : '该完整配置的车型档案已存在，已保留原档案。', error: false });
    } catch (cause) { setResult({ text: saved ? '车型已保存，页面数据暂未刷新。请关闭目录后刷新业务数据查看。' : errorText(cause), error: true }); }
    finally { setBusy(false); }
  }

  return <form onSubmit={event => void importModel(event)}>
    <span className="pc-eyebrow">CREATE A MODEL PROFILE</span><h3>{model.brand} · {model.name}</h3><p>{manual ? '根据车辆资料填写未收录的年款与配置。' : '公开配置保持原始年款、动力与版本的对应关系。'}</p>
    <div className="pc-import-mode"><span>{manual ? '手动补充配置' : '公开配置选择'}</span><button type="button" className="ad-link-button" onClick={changeMode} disabled={busy}>{manual ? '返回公开配置' : '未找到？手动填写'}</button></div>
    {manual ? <>
      <div className="pc-manual-note"><AlertCircle size={17} aria-hidden="true" /><p>手填配置尚未经公开资料核验，请依据车辆铭牌或官方配置表填写。</p></div>
      <label className="ad-field"><span>实际车型年款 <i aria-hidden="true">*</i></span><input type="number" min={1950} max={2100} step={1} value={manualYear} onChange={event => { setManualYear(event.target.value); setResult(null); }} required disabled={busy} placeholder="请核对车辆年款" /></label>
      <label className="ad-field"><span>动力及具体配置 <i aria-hidden="true">*</i></span><input value={manualPower} onChange={event => { setManualPower(event.target.value); setResult(null); }} maxLength={200} required disabled={busy} placeholder="如：纯电 405km 自由版" /><small>完整填写动力与版本，有助于匹配对应的保养手册。</small></label>
      <SourceLinks sources={sources.filter(source => source.id === model.sourceId)} />
    </> : <>
      {catalog?.years.length ? <>
        <label className="ad-field"><span>已收录车型年款 <i aria-hidden="true">*</i></span><select ref={yearRef} value={year} disabled={busy} onChange={event => { setYear(event.target.value); setPowerFilter(''); setSearch(''); setQuery(''); setOffset(0); setSelected(null); setResult(null); }}><option value="">请选择实际年款</option>{catalog.years.map(value => <option key={value} value={value}>{value} 款</option>)}</select><small>仅列出已有公开配置依据的年款，年款以车辆资料为准。</small></label>
        {initialYear && !catalog.years.includes(Number(initialYear)) && <p className="pc-year-gap">该车系尚未收录 {initialYear} 款配置，可查看其他已收录年款，或手动补充。</p>}
        <button type="button" className="ad-link-button pc-year-help" onClick={enterManual} disabled={busy}>未列出实际年款？手动补充该年款</button>
      </> : loading && !error ? <p className="pc-variant-status" role="status">正在查询已收录年款…</p> : null}
      {year && !!catalog?.years.length && <>
        <label className="ad-field"><span>动力筛选</span><select value={powerFilter} disabled={busy || loading} onChange={event => { setPowerFilter(event.target.value); setOffset(0); setSelected(null); setResult(null); }}><option value="">全部动力</option>{catalog?.powers.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
        <label className="ad-field"><span>查找具体配置</span><input value={search} onChange={event => { setSearch(event.target.value); setSelected(null); setResult(null); }} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); setQuery(search.trim()); setOffset(0); } }} maxLength={100} disabled={busy} placeholder="输入版本、排量等关键词" /></label>
      </>}
      {error ? <div className="pc-variant-error" role="alert"><AlertCircle size={18} /><p>配置暂时无法加载：{error}</p><button type="button" className="ad-button" onClick={() => setRetry(value => value + 1)} disabled={busy}>重新加载配置</button></div> : loading || searchPending ? catalog?.years.length ? <p className="pc-variant-status" role="status">正在查询公开年款与配置…</p> : null : !catalog?.years.length ? <div className="pc-variant-empty pc-missing-config"><BookOpen size={25} aria-hidden="true" /><strong>该车系的年款与配置资料待补充</strong><p>目录中已有车系名称，但尚无可直接选择的完整配置。可依据车辆铭牌或官方配置表补充年款和配置。</p><button type="button" className="ad-button ad-button-primary" onClick={enterManual} disabled={busy}>手动补充年款与配置<ArrowRight size={16} aria-hidden="true" /></button></div> : year ? <>
        <fieldset className="pc-variants" disabled={busy || loading || searchPending}><legend>选择完整配置 <span>共 {catalog.total} 条</span></legend>{catalog.items.length ? catalog.items.map(entry => <label key={entry.id} className={`pc-variant ${selected?.id === entry.id ? 'pc-variant-selected' : ''}`}><input type="radio" name={`variant-${model.id}`} value={entry.id} checked={selected?.id === entry.id} onChange={() => { setSelected(entry); setResult(null); }} /><span><strong>{entry.trim}</strong><small>{entry.year} 款 · {entry.power}</small>{entry.manufacturer && <small>{entry.manufacturer}</small>}</span></label>) : <div className="pc-variant-empty"><Search size={22} /><strong>没有匹配的已收录配置</strong><p>可清除动力或关键词筛选，或按车辆资料补充当前年款。</p><button type="button" className="ad-button" onClick={() => { setPowerFilter(''); setSearch(''); setQuery(''); setOffset(0); setSelected(null); setResult(null); }}>清除配置筛选</button><button type="button" className="ad-link-button" onClick={enterManual}>手动补充 {year} 款配置</button></div>}</fieldset>
        {catalog.total > catalog.limit && <nav className="pc-pagination pc-variant-pagination" aria-label="具体配置分页"><button type="button" className="ad-button" disabled={busy || offset === 0} onClick={() => { setOffset(Math.max(0, offset - 20)); setSelected(null); }}><ArrowLeft size={14} />上一页</button><span>{Math.floor(offset / 20) + 1} / {Math.ceil(catalog.total / 20)}</span><button type="button" className="ad-button" disabled={busy || offset + catalog.limit >= catalog.total} onClick={() => { setOffset(offset + 20); setSelected(null); }}>下一页<ArrowRight size={14} /></button></nav>}
      </> : <p className="pc-variant-hint">先选择年款，查看该年款的动力与完整配置。</p>}
      {selected && !loading && !searchPending && <section className="pc-variant-evidence" aria-label="所选配置来源"><span className="pc-eyebrow">SELECTED CONFIGURATION</span><h4>{selected.year} 款 · {selected.trim}</h4><p>{selected.power}</p><details><summary>查看配置依据与来源</summary><p className="pc-evidence">{selected.sourceEvidence}</p><SourceLinks sources={(catalog?.sources || []).filter(source => source.id === selected.sourceId)} /></details></section>}
    </>}
    <div className="pc-pending"><BookOpen size={17} /><span>保养项目范围：待对应手册核对</span></div>
    {(manual || loading || !!catalog?.years.length) && <button type="submit" className="ad-button ad-button-primary pc-import-model" disabled={busy || (manual ? !manualYear || !manualPower.trim() : !selected || loading || searchPending)}>{busy ? '正在导入…' : manual ? '手动创建车型档案' : '导入所选车型配置'}<ArrowRight size={16} /></button>}
    {existing && <p className="pc-existing">相同配置已在系统中，再次导入会保留现有档案。</p>}
  </form>;
}

export default function PublicCatalog({ kind, models, projects, onRefresh, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const previewRef = useRef<HTMLElement>(null);
  const [searchInput, setSearchInput] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('');
  const [yearFilter, setYearFilter] = useState('');
  const [availableOnly, setAvailableOnly] = useState(true);
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
  const [localProjectIds, setLocalProjectIds] = useState<string[]>([]);
  const [skippedProjects, setSkippedProjects] = useState<NonNullable<CatalogProjectImportResult['skipped']>>([]);
  const isModels = kind === 'models';
  const list = isModels ? modelList : projectList;
  const sources = list?.sources || [];
  const projectExists = (entry: CatalogProject) => localProjectIds.includes(entry.id) || projects.some(project => project.catalogSource?.catalogId === entry.id || normalize(project.name) === normalize(entry.name));
  const selectableProjects = (projectList?.items || []).filter(entry => !projectExists(entry));
  const unselectedCount = selectableProjects.filter(entry => !selectedProjects.some(selected => selected.id === entry.id)).length;
  const close = () => { if (!busy) onClose(); };

  useEffect(() => {
    const node = ref.current;
    const previous = document.activeElement as HTMLElement | null;
    node?.showModal();
    return () => { node?.close(); if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setLoadError('');
    const params = new URLSearchParams({ q: query });
    if (filter) params.set(isModels ? 'brand' : 'category', filter);
    if (isModels) { params.set('offset', String(offset)); params.set('limit', '20'); params.set('availableOnly', String(availableOnly)); if (yearFilter) params.set('year', yearFilter); }
    const request = isModels
      ? api<CatalogModelsResponse>(`/admin/catalog/models?${params}`, { signal: controller.signal }).then(value => { if (!controller.signal.aborted) setModelList(value); })
      : api<CatalogProjectsResponse>(`/admin/catalog/projects?${params}`, { signal: controller.signal }).then(value => { if (!controller.signal.aborted) setProjectList(value); });
    void request.catch(error => { if (!controller.signal.aborted) setLoadError(errorText(error)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [isModels, query, filter, yearFilter, availableOnly, offset, retry]);

  useEffect(() => {
    if (!selectedModel) return;
    if (window.matchMedia('(max-width: 767px)').matches) {
      previewRef.current?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    }
  }, [selectedModel]);

  function search(event: FormEvent) {
    event.preventDefault(); setQuery(searchInput.trim()); setOffset(0);
  }

  async function importProjects() {
    if (!selectedProjects.length || busy) return;
    setBusy(true); setResult(null); setSkippedProjects([]);
    let saved = false;
    try {
      const response = await post<CatalogProjectImportResult>('/admin/catalog/projects/import', { catalogIds: selectedProjects.map(project => project.id), skipConflicts: true });
      saved = true;
      const skipped = response.skipped || [];
      setSkippedProjects(skipped);
      setLocalProjectIds(previous => [...new Set([...previous, ...selectedProjects.filter(project => !skipped.some(item => item.catalogId === project.id)).map(project => project.id)])]);
      setSelectedProjects([]);
      await onRefresh();
      setResult({ text: `已新增 ${response.created} 个服务项目，保留 ${response.existing} 个已有项目${skipped.length ? `，${skipped.length} 个项目需核对，已跳过` : ''}。可在标准服务项目中维护服务说明。`, error: false });
    } catch (error) { setResult({ text: saved ? '所选项目已保存，页面数据暂未刷新。请关闭目录后刷新业务数据查看。' : errorText(error), error: true }); }
    finally { setBusy(false); }
  }

  return <dialog ref={ref} className="ad-dialog pc-dialog" aria-labelledby="pc-title" onCancel={event => { event.preventDefault(); close(); }}>
    <header className="ad-dialog-head"><div><span className="pc-eyebrow">PUBLIC RESOURCE LIBRARY</span><h2 id="pc-title">{isModels ? '公开车型库' : '参考服务项目库'}</h2><p>{isModels ? '选择车系、实际年款与完整配置，创建车型档案。' : '选择常见保养项目，建立统一的服务目录。'}</p></div><button className="ad-icon-button" type="button" onClick={close} disabled={busy} aria-label="关闭公开资源目录"><X size={20} /></button></header>
    <div className="ad-dialog-body pc-body">
      <div className="pc-intro"><span>{isModels ? <CarFront size={23} /> : <Wrench size={23} />}</span><p>{isModels ? '可先按实际年款筛选有配置资料的车系。每个车系会标明已收录年份；未列出的年款表示资料尚未收录，可按车辆资料手动补充。保养范围仍需按对应手册核对。' : '项目名称与操作参考公开保养资料整理。每个项目的适用车型、周期与报价，请在手册和门店服务中分别配置。'}</p></div>
      {result && <div role={result.error ? 'alert' : 'status'} className={`pc-result ${result.error ? 'pc-result-error' : ''}`}>{result.error ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}<p>{result.text}</p></div>}
      {skippedProjects.length > 0 && <section className="pc-conflicts" aria-label="待核对的服务项目"><h3>以下项目已跳过，请核对后单独处理</h3><ul>{skippedProjects.map(item => <li key={item.catalogId}><strong>{item.name}</strong><span>{item.reason}</span></li>)}</ul></section>}
      <form className={`pc-filters ${isModels ? 'pc-model-filters' : ''}`} onSubmit={search}>
        <label className="pc-search"><span className="pc-label">{isModels ? '品牌或车系' : '名称或项目编码'}</span><span><Search size={17} /><input value={searchInput} onChange={event => setSearchInput(event.target.value)} maxLength={100} placeholder={isModels ? '如：比亚迪、海鸥' : '如：制动液、空气滤清器'} disabled={busy} /></span></label>
        <label className="pc-filter"><span className="pc-label">{isModels ? '汽车品牌' : '项目分类'}</span><select value={filter} onChange={event => { setFilter(event.target.value); setOffset(0); }} disabled={busy}><option value="">{isModels ? '全部品牌' : '全部分类'}</option>{(isModels ? modelList?.brands : projectList?.categories)?.map(value => <option key={value} value={value}>{value === 'diagnosis' ? '故障诊断' : value}</option>)}</select></label>
        {isModels && <label className="pc-filter pc-year-filter"><span className="pc-label">已收录年款</span><select value={yearFilter} onChange={event => { setYearFilter(event.target.value); setOffset(0); setResult(null); }} disabled={busy}><option value="">全部已收录年款</option>{modelList?.years?.map(year => <option key={year} value={year}>{year} 款</option>)}</select></label>}
        <button className="ad-button ad-button-primary" type="submit" disabled={busy || loading}>搜索</button>
      </form>
      {isModels && <div className="pc-coverage-controls"><label className="pc-available-toggle"><input type="checkbox" checked={availableOnly} disabled={busy} onChange={event => { setAvailableOnly(event.target.checked); setOffset(0); }} /><span>只看有公开配置的车系</span></label><p>{yearFilter ? '未找到实际年款？切换全部年款并关闭此项，可选择车系后手动补充。' : '关闭后可查看资料待补充的车系并手动建档。'}</p></div>}
      {loadError ? <div className="pc-empty" role="alert"><BookOpen size={27} /><h3>目录暂时无法加载</h3><p>{loadError}</p><button className="ad-button" type="button" onClick={() => setRetry(value => value + 1)}>重新加载</button></div> : <>
        <div className="pc-count" role="status">{loading ? '正在查询公开资源…' : `找到 ${list?.total || 0} ${isModels ? '个车系' : '个参考项目'}`}<span>{list?.version ? `目录版本 ${list.version}` : ''}</span></div>
        {isModels ? <div className="pc-model-layout">
          <section className="pc-results" aria-label="公开车系列表" aria-busy={loading}>
            {modelList?.items.length ? <div className="pc-model-list">{modelList.items.map(entry => <button key={entry.id} type="button" className={`pc-model-option ${selectedModel?.id === entry.id ? 'pc-model-selected' : ''}`} aria-pressed={selectedModel?.id === entry.id} onClick={() => { setSelectedModel(entry); setResult(null); }} disabled={busy || loading}><span className="pc-option-icon"><CarFront size={24} strokeWidth={1.4} /></span><span><small>{entry.brand}</small><strong>{entry.name}</strong>{entry.variantCount != null && <small className="pc-variant-count">{entry.variantCount ? `${entry.variantCount} 个公开配置` : '年款与配置待补充'}</small>}{entry.years && entry.years.length > 0 && <small className="pc-model-years" title={`已收录年款：${entry.years.join('、')}款`}>已收录 {entry.years.slice(0, 3).join('、')} 款{entry.years.length > 3 ? `等 ${entry.years.length} 个年款` : ''}</small>}</span>{selectedModel?.id === entry.id ? <Check size={19} /> : <ArrowRight size={17} />}</button>)}</div> : !loading && <div className="pc-empty"><Search size={25} /><h3>当前条件下暂无已收录配置</h3><p>{yearFilter ? `暂未收录符合筛选条件的 ${yearFilter} 款配置，可放宽年款条件再查找车系。` : '可调整品牌或关键词，或查看资料待补充的车系后手动建档。'}</p><button type="button" className="ad-button" onClick={() => { setYearFilter(''); setAvailableOnly(false); setOffset(0); }}>查看全部年款与待补充车系</button></div>}
            {modelList && modelList.total > modelList.limit && <nav className="pc-pagination" aria-label="公开车型分页"><button type="button" className="ad-button" disabled={loading || busy || offset === 0} onClick={() => setOffset(value => Math.max(0, value - 20))}><ArrowLeft size={15} />上一页</button><span>第 {Math.floor(offset / 20) + 1} / {Math.ceil(modelList.total / 20)} 页</span><button type="button" className="ad-button" disabled={loading || busy || offset + modelList.limit >= modelList.total} onClick={() => setOffset(value => value + 20)}>下一页<ArrowRight size={15} /></button></nav>}
          </section>
          <aside ref={previewRef} className="pc-model-preview" aria-label="车型导入预览">{selectedModel ? <ModelImportPreview key={`${selectedModel.id}:${yearFilter}`} model={selectedModel} initialYear={yearFilter} sources={sources} models={models} busy={busy} setBusy={setBusy} setResult={setResult} onRefresh={onRefresh} /> : <div className="pc-preview-empty"><CarFront size={40} strokeWidth={1.2} /><h3>选择一个车系</h3><p>在左侧选择，再按实际年款查找完整配置。</p></div>}</aside>
        </div> : <>
          <div className="pc-bulk-select"><div><strong>按当前筛选批量选择</strong><p>选择只影响待导入清单，点击导入后才会保存；已有项目会保留。</p></div><button type="button" className="ad-button" disabled={busy || loading || unselectedCount === 0} onClick={() => setSelectedProjects(previous => [...previous, ...selectableProjects.filter(entry => !previous.some(selected => selected.id === entry.id))])}><Check size={16} aria-hidden="true" />选择当前未选项目（{unselectedCount} 项）</button></div>
          <section className="pc-selection" aria-label="已选服务项目"><div><strong>已选 {selectedProjects.length} 项</strong><button className="ad-link-button" type="button" onClick={() => setSelectedProjects([])} disabled={busy || !selectedProjects.length}>清空选择</button></div>{selectedProjects.length > 0 && <details className="pc-selection-details"><summary>查看已选清单</summary><ul>{selectedProjects.map(project => <li key={project.id}>{project.name}<button type="button" onClick={() => setSelectedProjects(previous => previous.filter(entry => entry.id !== project.id))} aria-label={`移除${project.name}`} disabled={busy}><X size={14} /></button></li>)}</ul></details>}<button type="button" className="ad-button ad-button-primary" onClick={() => void importProjects()} disabled={busy || !selectedProjects.length}>{busy ? '正在导入…' : `导入所选 ${selectedProjects.length} 个项目`}<ArrowRight size={16} /></button></section>
          <div className="pc-project-list" aria-label="参考项目列表" aria-busy={loading}>{projectList?.items.map(entry => {
            const selected = selectedProjects.some(project => project.id === entry.id);
            const existing = projectExists(entry);
            return <article key={entry.id} className={`pc-project-card ${selected ? 'pc-project-selected' : ''}`}><label className="pc-project-choice"><input type="checkbox" checked={selected} disabled={busy || loading || existing} onChange={event => setSelectedProjects(previous => event.target.checked ? [...previous, entry] : previous.filter(project => project.id !== entry.id))} /><span><strong>{entry.name}</strong><small>{entry.category === 'diagnosis' ? '故障诊断' : entry.category} · {manualActionNames[entry.action]} · {entry.unit}</small></span>{existing && <span className="pc-imported"><Check size={13} />已导入</span>}</label><p>{entry.description}</p><div className="pc-project-meta"><code>{entry.code}</code><details><summary>查看参考来源</summary><SourceLinks sources={sources.filter(source => entry.sourceIds.includes(source.id))} /></details></div></article>;
          })}{!loading && !projectList?.items.length && <div className="pc-empty"><Search size={25} /><h3>没有匹配的项目</h3><p>换个关键词，或通过手动新增补充项目。</p></div>}</div>
        </>}
      </>}
      <footer className="pc-footer"><span><LibraryBig size={15} />公开目录随系统预置，导入后可维护本平台档案。</span><button type="button" className="ad-button ad-button-ghost" disabled={busy} onClick={close}>完成并关闭</button></footer>
    </div>
  </dialog>;
}
