import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { AlertCircle, ArrowRight, BookOpen, CheckCircle2, ChevronDown, ExternalLink, FileText, Image as ImageIcon, LoaderCircle, Plus, RefreshCw, Save, ShieldCheck, UploadCloud } from 'lucide-react';
import type { Bootstrap, ManualImport, ManualRuleDraft, ManualSource, MaintenanceAction, MaintenanceTrigger } from '@autovoyage/shared';
import { api, patch, post } from '../lib/api';
import './manuals.css';

interface Props {
  data: Bootstrap;
  onRefresh: () => Promise<void>;
  children: ReactNode;
  focusRequest?: { id: string; token: number } | null;
}
type Draft = Pick<ManualImport, 'sourceTitle' | 'sourceUrl' | 'edition' | 'applicability' | 'rows'>;
const statusNames: Record<ManualImport['status'], string> = { uploaded: '等待识别', processing: '正在识别', awaiting_confirmation: '待核对', published: '已发布', failed: '识别失败' };
export const manualActionNames: Record<MaintenanceAction, string> = { inspect: '检查', replace: '更换', clean: '清洁', lubricate: '润滑', other: '其他处理' };
const triggerNames: Record<MaintenanceTrigger, string> = { periodic: '固定周期', condition: '达到条件时', as_needed: '按需处理' };
const pending = (job: ManualImport) => ['uploaded', 'processing'].includes(job.status);
const draftOf = (job: ManualImport): Draft => ({ sourceTitle: job.sourceTitle, sourceUrl: job.sourceUrl, edition: job.edition, applicability: job.applicability, rows: structuredClone(job.rows) });
const readableDate = (value: string) => new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
const messageOf = (error: unknown) => error instanceof Error ? error.message : '操作暂未完成，请稍后重试';
const validSourceLink = (value: string) => { if (!value.trim() || /^\/api\/v1\/manual-files\/[\w-]+$/.test(value.trim())) return true; try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; } };

export default function ManualWorkbench({ data, onRefresh, children, focusRequest }: Props) {
  const [tab, setTab] = useState<'imports' | 'rules'>('imports');
  const [jobs, setJobs] = useState<ManualImport[]>([]);
  const [active, setActive] = useState<ManualImport | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [modelId, setModelId] = useState(data.models[0]?.id || '');
  const [sources, setSources] = useState<ManualSource[]>([]);
  const [sourcesError, setSourcesError] = useState('');
  const [sourceLoading, setSourceLoading] = useState(false);
  const [sourceDiscovered, setSourceDiscovered] = useState(false);
  const [method, setMethod] = useState<'upload' | 'url'>('upload');
  const [metadata, setMetadata] = useState({ sourceTitle: '', sourceUrl: '', edition: '', applicability: '', pageRange: '' });
  const [files, setFiles] = useState<File[]>([]);
  const [consent, setConsent] = useState(false);
  const [localPdf, setLocalPdf] = useState('');
  const [pageNumber, setPageNumber] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [verified, setVerified] = useState(false);
  const [applicabilityConfirmed, setApplicabilityConfirmed] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const sourceRequest = useRef(0);
  const formRef = useRef<HTMLFormElement>(null);
  const modelName = (id: string) => { const model = data.models.find(item => item.id === id); return model ? `${model.brand} ${model.name} · ${model.year}款 · ${model.power}` : '车型档案已变更'; };

  function adopt(job: ManualImport) {
    setActive(job); setDraft(draftOf(job)); setDirty(false); setVerified(false); setApplicabilityConfirmed(false);
    setPageNumber(job.files.find(file => file.mimeType.startsWith('image/'))?.pageNumber ?? null);
    setExpanded(job.rows[0] ? [job.rows[0].id] : []);
    setJobs(current => [job, ...current.filter(item => item.id !== job.id)].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  }
  async function loadJobs() {
    const result = await api<ManualImport[]>('/admin/manual-imports');
    setJobs(result); return result;
  }
  useEffect(() => {
    let cancelled = false;
    api<ManualImport[]>('/admin/manual-imports').then(result => { if (!cancelled) setJobs(result); }).catch(reason => { if (!cancelled) setError(messageOf(reason)); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    const token = ++sourceRequest.current;
    if (!modelId) { setSources([]); setSourceLoading(false); return; }
    let cancelled = false; setSourceLoading(true); setSourceDiscovered(false); setSourcesError(''); setSources([]);
    api<ManualSource[]>(`/admin/manual-sources?modelId=${encodeURIComponent(modelId)}`).then(result => { if (!cancelled && sourceRequest.current === token) setSources(result); }).catch(reason => { if (!cancelled && sourceRequest.current === token) setSourcesError(messageOf(reason)); }).finally(() => { if (!cancelled && sourceRequest.current === token) setSourceLoading(false); });
    return () => { cancelled = true; };
  }, [modelId]);
  useEffect(() => {
    const pdf = files.length === 1 && files[0].type === 'application/pdf' ? URL.createObjectURL(files[0]) : '';
    setLocalPdf(pdf); return () => { if (pdf) URL.revokeObjectURL(pdf); };
  }, [files]);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  useEffect(() => {
    if (!active || !pending(active)) return;
    let cancelled = false; let refreshing = false;
    const timer = window.setInterval(() => {
      if (refreshing) return; refreshing = true;
      api<ManualImport>(`/admin/manual-imports/${active.id}`).then(job => { if (!cancelled) { adopt(job); setError(current => current.startsWith('读取识别进度失败：') ? '' : current); } }).catch(reason => { if (!cancelled) setError(`读取识别进度失败：${messageOf(reason)}`); }).finally(() => { refreshing = false; });
    }, 2500);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [active?.id, active?.status]);
  useEffect(() => {
    if (!focusRequest) return;
    let cancelled = false;
    setTab('imports'); setError(''); setBusy(true);
    (async () => {
      if (dirty && active?.status === 'awaiting_confirmation') await persist();
      const job = await api<ManualImport>(`/admin/manual-imports/${focusRequest.id}`);
      if (!cancelled) adopt(job);
    })().catch(reason => { if (!cancelled) setError(messageOf(reason)); }).finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [focusRequest?.token]);

  function editDraft(changes: Partial<Draft>) {
    setDraft(current => current ? { ...current, ...changes } : current); setDirty(true); setVerified(false); setApplicabilityConfirmed(false); setNotice('');
  }
  function editRow(id: string, changes: Partial<ManualRuleDraft>) {
    if (draft) editDraft({ rows: draft.rows.map(row => row.id === id ? { ...row, ...changes } : row) });
  }
  async function persist(): Promise<ManualImport | null> {
    if (!active || !draft) return null;
    if (!draft.sourceTitle.trim()) throw new Error('请填写手册名称后保存。');
    if (!validSourceLink(draft.sourceUrl)) throw new Error('请填写不含登录凭据的 HTTPS 来源链接；手工照片可留空。');
    for (const [index, row] of draft.rows.entries()) {
      if (!row.name.trim()) throw new Error(`第 ${index + 1} 项需要项目名称；误加的空白行可在展开后移除。`);
      for (const key of ['firstMonths', 'firstKm', 'intervalMonths', 'intervalKm'] as const) {
        const value = row[key];
        if (value != null && (!Number.isInteger(value) || value <= 0 || value > (key.endsWith('Months') ? 1200 : 2000000))) throw new Error(`第 ${index + 1} 项的周期必须是有效正整数，未说明的阈值请留空。`);
      }
    }
    const job = await patch<ManualImport>(`/admin/manual-imports/${active.id}/draft`, { expectedRevision: active.revision, ...draft });
    setActive(job); setDraft(draftOf(job)); setDirty(false);
    setJobs(current => current.map(item => item.id === job.id ? job : item));
    return job;
  }
  async function chooseJob(job: ManualImport | null) {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      if (dirty && active?.status === 'awaiting_confirmation') await persist();
      if (job) adopt(await api<ManualImport>(`/admin/manual-imports/${job.id}`));
      else { setActive(null); setDraft(null); setDirty(false); }
      setTab('imports');
    } catch (reason) { setError(messageOf(reason)); }
    finally { setBusy(false); }
  }
  async function discoverSources() {
    if (!modelId || sourceLoading || busy) return;
    const token = ++sourceRequest.current;
    setSourceLoading(true); setSourcesError('');
    try {
      const result = await api<ManualSource[]>(`/admin/manual-sources?modelId=${encodeURIComponent(modelId)}&discover=true`);
      if (sourceRequest.current === token) { setSources(result); setSourceDiscovered(true); }
    } catch (reason) { if (sourceRequest.current === token) setSourcesError(messageOf(reason)); }
    finally { if (sourceRequest.current === token) setSourceLoading(false); }
  }
  function validateFiles(selected: File[]) {
    if (!selected.length) return '请选择 PDF 或手册图片。';
    if (selected.length > 12) return '每次最多上传 12 张手册图片。';
    const pdfs = selected.filter(file => file.type === 'application/pdf');
    if (pdfs.length && selected.length !== 1) return 'PDF 每次上传 1 份，请勿与图片混合上传。';
    if (pdfs[0]?.size > 32 * 1024 * 1024) return 'PDF 不能超过 32 MB，请先压缩或提取需要的页面。';
    if (selected.some(file => !['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(file.type))) return '仅支持 PDF、JPEG、PNG 和 WebP。';
    if (selected.some(file => file.type !== 'application/pdf' && file.size > 8 * 1024 * 1024)) return '每张图片不能超过 8 MB。';
    if (selected.reduce((sum, file) => sum + file.size, 0) > 32 * 1024 * 1024) return '本次上传总大小不能超过 32 MB。';
    return '';
  }
  async function createImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    setError(''); setNotice('');
    if (!data.config.aiConfigured) { setError('AI 识别服务尚未配置，请联系部署者完成配置。'); return; }
    if (!validSourceLink(metadata.sourceUrl)) { setError('请填写不含登录凭据的 HTTPS 来源链接；手工照片可留空。'); return; }
    if (!consent) { setError('请先勾选同意使用当前 AI 服务识别手册。'); return; }
    if (method === 'upload') { const message = validateFiles(files); if (message) { setError(message); return; } }
    setBusy(true);
    try {
      let job: ManualImport;
      if (method === 'upload') {
        const body = new FormData();
        Object.entries({ modelId, ...metadata, consent: 'true' }).forEach(([key, value]) => body.append(key, value));
        files.forEach(file => body.append('files', file));
        job = await api<ManualImport>('/admin/manual-imports', { method: 'POST', body });
      } else job = await post<ManualImport>('/admin/manual-imports/from-url', { modelId, ...metadata, consent: true });
      adopt(job); setFiles([]); if (fileInput.current) fileInput.current.value = '';
      setConsent(false); setNotice('手册已导入，识别完成后请逐项核对。');
    } catch (reason) { setError(messageOf(reason)); }
    finally { setBusy(false); }
  }
  async function saveDraft() {
    if (busy) return; setBusy(true); setError(''); setNotice('');
    try { await persist(); setNotice('草稿已保存。请完成适用范围和原文核对后发布。'); }
    catch (reason) { setError(messageOf(reason)); }
    finally { setBusy(false); }
  }
  function checkPublish() {
    if (!active || !draft) return '请先选择已识别的手册。';
    if (dirty) return '请先保存当前草稿，再核对并发布。';
    const included = draft.rows.filter(row => row.include);
    if (!included.length) return '请至少选择一个需要发布的保养项目。';
    if (!draft.sourceTitle.trim() || !draft.edition.trim() || !draft.applicability.trim()) return '请补全手册名称、版本及车型适用范围并保存。';
    const imagePages = new Set(active.files.filter(file => file.mimeType.startsWith('image/')).map(file => file.pageNumber));
    const projects = new Set<string>();
    for (const [index, row] of draft.rows.entries()) {
      if (!row.include) continue;
      const prefix = `第 ${index + 1} 项「${row.name || '未命名'}」`;
      if (!row.name.trim()) return `${prefix}需要填写项目名称。`;
      if (!row.projectId && !row.createProject) return `${prefix}需要映射标准项目，或明确选择新增项目。`;
      if (row.projectId && projects.has(row.projectId)) return `${prefix}与另一项映射了相同标准项目，请合并或分别新建。`;
      if (row.projectId) projects.add(row.projectId);
      if (!row.sourceText.trim() || !row.pageNumbers.length || row.pageNumbers.some(page => !imagePages.has(page))) return `${prefix}需要原文摘录及有效证据页码。`;
      if (row.triggerType === 'periodic' && row.condition.trim()) return `${prefix}带有特殊适用条件，请选择“达到条件时”，或将普通说明放入脚注并清空适用条件。`;
      if (row.triggerType === 'periodic' && ((row.firstMonths == null && row.firstKm == null) || (row.intervalMonths == null && row.intervalKm == null))) return `${prefix}缺少首次或后续周期。请根据原文补全，无法确定的项目可取消本次导入。`;
      if (row.triggerType !== 'periodic' && !row.condition.trim()) return `${prefix}需要填写按条件或按需处理的依据。`;
    }
    if (!verified || !applicabilityConfirmed) return '请确认已逐项核对原文，并确认手册适用于所选车型。';
    return '';
  }
  async function publish() {
    if (busy || !active) return;
    const message = checkPublish(); if (message) { setError(message); return; }
    setBusy(true); setError(''); setNotice('');
    let saved = false;
    try {
      const job = await post<ManualImport>(`/admin/manual-imports/${active.id}/publish`, { expectedRevision: active.revision, verified: true, applicabilityConfirmed: true });
      saved = true; adopt(job); await onRefresh(); setNotice(`已发布 ${job.publishedRuleIds.length} 项规则，车主端将按该车型展示。`);
    } catch (reason) { setError(saved ? '规则已发布，业务数据刷新暂未完成。请刷新数据查看，勿重复发布。' : messageOf(reason)); }
    finally { setBusy(false); }
  }
  async function retry() {
    if (!active || busy) return; setBusy(true); setError(''); setNotice('');
    try { adopt(await post<ManualImport>(`/admin/manual-imports/${active.id}/retry`)); }
    catch (reason) { setError(messageOf(reason)); }
    finally { setBusy(false); }
  }
  async function refresh() {
    if (busy) return; setBusy(true); setError('');
    try {
      if (dirty) await persist();
      await loadJobs();
      if (active) adopt(await api<ManualImport>(`/admin/manual-imports/${active.id}`));
    } catch (reason) { setError(messageOf(reason)); }
    finally { setBusy(false); }
  }

  const images = active?.files.filter(file => file.mimeType.startsWith('image/')) || [];
  const preview = images.find(file => file.pageNumber === pageNumber) || images[0];
  const editing = active?.status === 'awaiting_confirmation';
  const includedCount = draft?.rows.filter(row => row.include).length || 0;

  return <div className="mw-workbench">
    <div className="mw-tabs" role="tablist" aria-label="保养资料管理">
      <button type="button" id="mw-import-tab" role="tab" tabIndex={tab === 'imports' ? 0 : -1} aria-selected={tab === 'imports'} aria-controls="mw-import-panel" onClick={() => setTab('imports')} onKeyDown={event => { if (['ArrowRight', 'ArrowLeft', 'End'].includes(event.key)) { event.preventDefault(); setTab('rules'); document.getElementById('mw-rules-tab')?.focus(); } }}><UploadCloud size={18} aria-hidden="true" />手册导入</button>
      <button type="button" id="mw-rules-tab" role="tab" tabIndex={tab === 'rules' ? 0 : -1} aria-selected={tab === 'rules'} aria-controls="mw-rules-panel" onClick={() => setTab('rules')} onKeyDown={event => { if (['ArrowRight', 'ArrowLeft', 'Home'].includes(event.key)) { event.preventDefault(); setTab('imports'); document.getElementById('mw-import-tab')?.focus(); } }}><BookOpen size={18} aria-hidden="true" />车型规则<span>{data.rules.length}</span></button>
    </div>
    <div ref={errorRef} tabIndex={-1} className={`mw-feedback mw-error ${error ? '' : 'mw-hidden'}`} role="alert"><AlertCircle size={19} aria-hidden="true" /><span>{error}</span></div>
    {notice && <div className="mw-feedback mw-success" role="status"><CheckCircle2 size={19} aria-hidden="true" /><span>{notice}</span></div>}
    <div id="mw-rules-panel" role="tabpanel" aria-labelledby="mw-rules-tab" hidden={tab !== 'rules'}>{children}</div>
    <div id="mw-import-panel" role="tabpanel" aria-labelledby="mw-import-tab" hidden={tab !== 'imports'}>
      <div className="mw-step-guide"><span><b>1</b>确定车型与来源</span><ArrowRight size={16} aria-hidden="true" /><span><b>2</b>AI 提取草稿</span><ArrowRight size={16} aria-hidden="true" /><span><b>3</b>核对后发布</span></div>
      <div className="mw-history-bar"><div><strong>手册导入任务</strong><small>上传原文与规则版本一起留存</small></div><div><button type="button" className="ad-button" onClick={() => void refresh()} disabled={busy}><RefreshCw size={16} aria-hidden="true" />刷新任务</button>{active && <button type="button" className="ad-button ad-button-primary" onClick={() => void chooseJob(null)} disabled={busy}><Plus size={16} aria-hidden="true" />导入另一份</button>}</div></div>
      {loading ? <p className="mw-loading" role="status"><LoaderCircle size={18} className="ad-spin" aria-hidden="true" />正在读取任务…</p> : jobs.length > 0 && <label className="mw-field mw-task-picker"><span>继续查看或核对手册</span><select value={active?.id || ''} disabled={busy} onChange={event => { const selected = jobs.find(job => job.id === event.target.value); void chooseJob(selected || null); }}><option value="">新建导入任务</option>{jobs.map(job => <option key={job.id} value={job.id}>{statusNames[job.status]} · {job.sourceTitle} · {modelName(job.modelId)} · {readableDate(job.createdAt)}</option>)}</select></label>}
      {!active ? <form ref={formRef} className="mw-new-import" onSubmit={event => void createImport(event)}>
        <section className="ad-panel mw-panel">
          <div className="mw-panel-title"><span className="mw-title-icon"><BookOpen size={21} aria-hidden="true" /></span><div><h2>为准确的车型建立保养依据</h2><p>先找对应版本，再上传保养周期表及相关脚注。</p></div></div>
          <label className="mw-field"><span>适用车型 <i>*</i></span><select value={modelId} required disabled={busy} onChange={event => setModelId(event.target.value)}><option value="">请选择车型</option>{data.models.map(model => <option key={model.id} value={model.id}>{modelName(model.id)}{model.isDemo ? '（课程演示档案）' : ''}</option>)}</select><small>请核对中国市场版本、年款及动力配置。车系相同不代表周期相同。</small></label>
          <div className="mw-source-heading"><div><h3>{sourceDiscovered ? '车型候选资料与补充来源' : '资料库入口'}</h3><p>优先查询 CarOBook，未找到时从品牌官方等渠道补充。</p></div><button type="button" className="ad-button" disabled={busy || sourceLoading || !modelId} onClick={() => void discoverSources()}>{sourceLoading ? <LoaderCircle size={16} className="ad-spin" aria-hidden="true" /> : <BookOpen size={16} aria-hidden="true" />}按当前车型查找手册</button></div>
          <p className="mw-source-explanation">{sourceDiscovered ? '已查询公开目录。候选资料仍需逐项核对年款、动力与市场版本；品牌入口仅用于继续查找。' : '以下是查询入口，尚未在线检索当前车型，也未确认有适用文件。点击上方按钮查找具体候选手册。'}</p>
          {sourceLoading && <p className="mw-loading" role="status">正在查询手册来源…</p>}
          {sourcesError && <p className="mw-source-error" role="status">查询暂未完成：{sourcesError}。可打开来源入口继续查找，或上传已取得的手册。</p>}
          <div className="mw-sources">{sources.map((source, index) => <article className="mw-source" key={`${source.kind}-${source.url}`}><div><span className={`mw-source-label ${source.kind === 'carobook' ? 'mw-source-priority' : ''}`}>{source.kind === 'carobook' ? '优先来源' : source.kind === 'official' ? '品牌官方' : '补充渠道'}</span><h4>{source.title}</h4><p>{source.description}</p></div><div><a href={source.url} target="_blank" rel="noreferrer">打开来源页面<ExternalLink size={14} aria-hidden="true" /></a><button type="button" disabled={busy} onClick={() => { setMetadata(current => ({ ...current, sourceUrl: source.url })); setMethod('url'); }}>填入来源链接{index === 0 && <span className="mw-sr-only">，优先来源</span>}</button></div></article>)}</div>
        </section>
        <section className="ad-panel mw-panel">
          <div className="mw-panel-title"><span className="mw-title-icon"><UploadCloud size={21} aria-hidden="true" /></span><div><h2>导入手册原文</h2><p>支持直接文件链接、PDF 和清晰的保养表图片。</p></div></div>
          <fieldset className="mw-method"><legend className="mw-sr-only">获取手册的方式</legend><label><input type="radio" name="manual-method" value="upload" checked={method === 'upload'} onChange={() => setMethod('upload')} disabled={busy} />上传 PDF／图片</label><label><input type="radio" name="manual-method" value="url" checked={method === 'url'} onChange={() => setMethod('url')} disabled={busy} />从链接下载</label></fieldset>
          <div className="mw-form-grid">
            <label className="mw-field"><span>手册名称 <i>*</i></span><input value={metadata.sourceTitle} onChange={event => setMetadata(current => ({ ...current, sourceTitle: event.target.value }))} required maxLength={1000} disabled={busy} placeholder="如：2024 款海豹保修及保养手册" /></label>
            <label className="mw-field"><span>手册版本／发布日期 <i>*</i></span><input value={metadata.edition} onChange={event => setMetadata(current => ({ ...current, edition: event.target.value }))} required maxLength={200} disabled={busy} placeholder="按原文填写，无法确定时注明待核实" /></label>
            <label className="mw-field mw-full"><span>{method === 'url' ? '文件或手册页面链接' : '原始来源链接（选填）'}{method === 'url' && <i> *</i>}</span><input type="url" value={metadata.sourceUrl} onChange={event => setMetadata(current => ({ ...current, sourceUrl: event.target.value }))} required={method === 'url'} maxLength={2000} disabled={busy} placeholder="https://…" /><small>{method === 'url' ? '可下载的公开 PDF／图片会直接导入。网盘分享、登录下载和仅有目录的页面，请先取得文件再上传。' : '手册实拍可留空。来源名称、版本及适用范围仍需记录。'}</small></label>
            <label className="mw-field mw-full"><span>车型适用范围 <i>*</i></span><textarea value={metadata.applicability} onChange={event => setMetadata(current => ({ ...current, applicability: event.target.value }))} required rows={2} maxLength={2000} disabled={busy} placeholder="如：中国大陆，2024 款纯电车型；具体配置以手册适用范围为准" /></label>
          </div>
          {method === 'upload' && <div className="mw-upload-area"><UploadCloud size={30} aria-hidden="true" /><label htmlFor="manual-upload-files">选择 PDF 或手册图片</label><input id="manual-upload-files" ref={fileInput} type="file" multiple accept="application/pdf,image/jpeg,image/png,image/webp" disabled={busy} onChange={event => { const selected = Array.from(event.target.files || []); const message = selected.length ? validateFiles(selected) : ''; setFiles(selected); setError(message); }} /><small>1 份 PDF（≤32 MB），或最多 12 张图片（每张≤8 MB）；总大小≤32 MB。</small>{files.length > 0 && <ul>{files.map((file, index) => <li key={`${file.name}-${index}`}>{file.name}<span>{(file.size / 1024 / 1024).toFixed(1)} MB</span></li>)}</ul>}</div>}
          {localPdf && <details className="mw-local-preview"><summary>预览待上传 PDF，查找保养表页码</summary><object data={localPdf} type="application/pdf" aria-label="待上传手册 PDF 预览"><p>当前浏览器无法内嵌预览，<a href={localPdf} target="_blank" rel="noreferrer">打开本地 PDF</a>。</p></object><a href={localPdf} target="_blank" rel="noreferrer">在新页打开 PDF<ExternalLink size={14} aria-hidden="true" /></a></details>}
          <label className="mw-field mw-page-range"><span>PDF 识别页码（图片无需填写）</span><input value={metadata.pageRange} onChange={event => setMetadata(current => ({ ...current, pageRange: event.target.value }))} maxLength={200} disabled={busy} placeholder="如：150-154,160" /><small>按 PDF 阅读器显示的物理页码，从 1 开始，最多识别 12 页。超过 12 页的 PDF 必须指定页码；请一并选中表格注释及适用范围页。</small></label>
          <label className="mw-check"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} disabled={busy} required /><span>同意将所选手册页交给当前配置的 AI 服务识别，并确认有权使用这些资料。<small>识别结果先保存为草稿，核对并发布后才会用于车型保养规则。</small></span></label>
          {!data.config.aiConfigured && <div className="mw-feedback mw-error"><AlertCircle size={18} aria-hidden="true" />AI 服务尚未配置，暂不能开始识别。</div>}
          <div className="mw-form-actions"><span>原文和来源会随任务留存</span><button type="submit" className="ad-button ad-button-primary" disabled={busy || !data.config.aiConfigured}>{busy ? <LoaderCircle size={17} className="ad-spin" aria-hidden="true" /> : <UploadCloud size={17} aria-hidden="true" />}{busy ? '正在导入…' : '导入并开始 AI 识别'}</button></div>
        </section>
      </form> : <div className="mw-review">
        <section className="ad-panel mw-panel mw-job-summary"><div><span className={`mw-status mw-status-${active.status}`}>{statusNames[active.status]}</span><h2>{active.sourceTitle}</h2><p>{modelName(active.modelId)}</p><small>{readableDate(active.createdAt)} · 草稿修订 {active.revision}{active.aiModel ? ` · ${active.aiModel}` : ''}</small></div>{active.status === 'published' && <span className="mw-published-mark"><ShieldCheck size={28} aria-hidden="true" />{active.publishedRuleIds.length} 项规则已发布</span>}</section>
        {active.reason && <div className={`mw-feedback ${active.status === 'failed' ? 'mw-error' : 'mw-information'}`} role="status">{pending(active) ? <LoaderCircle size={19} className="ad-spin" aria-hidden="true" /> : active.status === 'failed' ? <AlertCircle size={19} aria-hidden="true" /> : <FileText size={19} aria-hidden="true" />}<span>{active.reason}</span>{active.status === 'failed' && <button type="button" className="ad-button" onClick={() => void retry()} disabled={busy}>重新识别</button>}</div>}
        {active.warnings.length > 0 && <div className="mw-warnings"><h3><AlertCircle size={18} aria-hidden="true" />需要留意的原文问题</h3><ul>{active.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></div>}
        <div className="mw-review-grid">
          <aside className="ad-panel mw-evidence"><div className="mw-evidence-heading"><h3><ImageIcon size={18} aria-hidden="true" />手册原文</h3>{preview && <a href={preview.url} target="_blank" rel="noreferrer">放大查看<ExternalLink size={14} aria-hidden="true" /></a>}</div>{images.length > 0 ? <><div className="mw-page-buttons" aria-label="选择手册证据页">{images.map(file => <button key={file.id} type="button" aria-pressed={preview?.id === file.id} onClick={() => setPageNumber(file.pageNumber)}>第 {file.pageNumber ?? '?'} 页</button>)}</div>{preview && <img className="mw-evidence-image" src={preview.url} alt={`手册原文，第 ${preview.pageNumber ?? '?'} 页`} />}</> : <p className="mw-muted">暂无可预览的证据页。</p>}<div className="mw-original-files">{active.files.filter(file => file.original).map(file => <a key={file.id} href={file.url} target="_blank" rel="noreferrer"><FileText size={15} aria-hidden="true" /><span>{file.name}</span><ExternalLink size={14} aria-hidden="true" /></a>)}</div></aside>
          <div className="mw-draft-column">
            {draft && <section className="ad-panel mw-panel"><h3>手册信息与适用范围</h3><div className="mw-form-grid"><label className="mw-field mw-full"><span>手册名称</span><input value={draft.sourceTitle} disabled={!editing || busy} maxLength={1000} onChange={event => editDraft({ sourceTitle: event.target.value })} /></label><label className="mw-field"><span>手册版本</span><input value={draft.edition} disabled={!editing || busy} maxLength={200} onChange={event => editDraft({ edition: event.target.value })} /></label><label className="mw-field"><span>来源链接（选填）</span><input type="url" value={draft.sourceUrl} disabled={!editing || busy} maxLength={2000} onChange={event => editDraft({ sourceUrl: event.target.value })} /></label><label className="mw-field mw-full"><span>车型适用范围</span><textarea value={draft.applicability} disabled={!editing || busy} rows={2} maxLength={2000} onChange={event => editDraft({ applicability: event.target.value })} /></label></div></section>}
            {draft && !pending(active) && <section className="mw-candidate-section"><div className="mw-candidate-heading"><div><h3>{active.status === 'published' ? '已审核的保养项目' : '逐项对照识别结果'}</h3><p>共 {draft.rows.length} 项，{includedCount} 项纳入本次规则</p></div>{editing && <button type="button" className="ad-button" disabled={busy || draft.rows.length >= 60} onClick={() => { const row: ManualRuleDraft = { id: `row-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, name: '', projectId: null, createProject: false, include: true, action: 'inspect', triggerType: 'periodic', firstMonths: null, firstKm: null, intervalMonths: null, intervalKm: null, mileageType: 'total_km', condition: '', notes: '', sourceText: '', pageNumbers: [] }; editDraft({ rows: [...draft.rows, row] }); setExpanded(current => [...current, row.id]); }}><Plus size={16} aria-hidden="true" />补充遗漏项</button>}</div>
              {draft.rows.length === 0 && <div className="ad-panel mw-no-rows"><BookOpen size={25} aria-hidden="true" /><h4>还没有可核对的保养项目</h4><p>请查看识别说明，确认所选页面包含保养表、图例和脚注。</p></div>}
              {draft.rows.map((row, index) => <article className={`mw-rule ${!row.include ? 'mw-rule-excluded' : ''}`} key={row.id}><div className="mw-rule-top"><label className="mw-row-include"><input type="checkbox" checked={row.include} disabled={!editing || busy} onChange={event => editRow(row.id, { include: event.target.checked })} /><span className="mw-sr-only">纳入第 {index + 1} 项规则</span></label><button type="button" className="mw-rule-toggle" aria-expanded={expanded.includes(row.id)} aria-controls={`mw-row-${row.id}`} onClick={() => setExpanded(current => current.includes(row.id) ? current.filter(id => id !== row.id) : [...current, row.id])}><span><small>项目 {index + 1} · {manualActionNames[row.action]} · {triggerNames[row.triggerType]}</small><strong>{row.name || '待填写项目名称'}</strong><em>{row.pageNumbers.length ? `原文第 ${row.pageNumbers.join('、')} 页` : '尚未关联证据页'}{!row.include ? ' · 本次不导入' : !row.projectId && !row.createProject ? ' · 待映射标准项目' : ''}</em></span><ChevronDown size={19} aria-hidden="true" /></button></div>
                <div id={`mw-row-${row.id}`} className="mw-rule-fields" hidden={!expanded.includes(row.id)}><div className="mw-form-grid"><label className="mw-field mw-full"><span>保养项目名称</span><input value={row.name} disabled={!editing || busy} maxLength={160} onChange={event => editRow(row.id, { name: event.target.value })} /></label><label className="mw-field mw-full"><span>映射到标准服务项目</span><select value={row.createProject ? '__new__' : row.projectId || ''} disabled={!editing || busy} onChange={event => editRow(row.id, { projectId: event.target.value === '__new__' ? null : event.target.value || null, createProject: event.target.value === '__new__' })}><option value="">请选择，防止重复建立同义项目</option><option value="__new__">明确新增一个标准项目</option>{data.projects.filter(project => project.active && project.category !== 'diagnosis').map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select><small>{row.createProject ? '发布时将按上方名称创建新项目。检查和更换要求不同时，请保留不同的项目含义。' : '已有项目可直接关联，首次导入请人工核对项目含义。'}</small></label><label className="mw-field"><span>要求的操作</span><select value={row.action} disabled={!editing || busy} onChange={event => editRow(row.id, { action: event.target.value as MaintenanceAction })}>{Object.entries(manualActionNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="mw-field"><span>触发方式</span><select value={row.triggerType} disabled={!editing || busy} onChange={event => { const triggerType = event.target.value as MaintenanceTrigger; editRow(row.id, { triggerType, ...(triggerType !== 'periodic' ? { firstMonths: null, firstKm: null, intervalMonths: null, intervalKm: null } : {}) }); }}>{Object.entries(triggerNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                  {row.triggerType === 'periodic' && <>{(['firstMonths', 'firstKm', 'intervalMonths', 'intervalKm'] as const).map(key => <label className="mw-field" key={key}><span>{{ firstMonths: '首次保养（月）', firstKm: '首次保养（km）', intervalMonths: '后续周期（月）', intervalKm: '后续周期（km）' }[key]}</span><input type="number" min={1} max={key.endsWith('Months') ? 1200 : 2000000} step={1} value={row[key] ?? ''} disabled={!editing || busy} placeholder="原文未说明则留空" onChange={event => editRow(row.id, { [key]: event.target.value === '' ? null : Number(event.target.value) })} /></label>)}<p className="mw-inline-hint mw-full">时间和里程以先到者为准。只填写原文明确的阈值；空白表示该阈值未说明。</p></>}
                  <label className="mw-field mw-full"><span>里程口径</span><select value={row.mileageType} disabled={!editing || busy} onChange={event => editRow(row.id, { mileageType: event.target.value as ManualRuleDraft['mileageType'] })}><option value="total_km">车辆累计总里程</option><option value="engine_km">发动机累计里程</option></select></label><label className="mw-field mw-full"><span>{row.triggerType === 'periodic' ? '特殊适用条件（固定周期须留空）' : '触发条件／按需处理依据'}</span><textarea rows={2} value={row.condition} disabled={!editing || busy} maxLength={2000} onChange={event => editRow(row.id, { condition: event.target.value })} placeholder={row.triggerType === 'periodic' ? '特殊条件请改选“达到条件时”；普通说明请写入脚注' : '保留严苛工况、检测后更换等限制条件'} /></label><label className="mw-field mw-full"><span>脚注与补充说明</span><textarea rows={2} value={row.notes} disabled={!editing || busy} maxLength={4000} onChange={event => editRow(row.id, { notes: event.target.value })} /></label><label className="mw-field mw-full"><span>原文摘录</span><textarea rows={3} value={row.sourceText} disabled={!editing || busy} maxLength={6000} onChange={event => editRow(row.id, { sourceText: event.target.value })} /><small>请对照左侧原图核实文字、单位、图例和脚注。</small></label></div><fieldset className="mw-evidence-pages"><legend>关联原文页码</legend>{images.map(file => <label key={file.id}><input type="checkbox" checked={file.pageNumber != null && row.pageNumbers.includes(file.pageNumber)} disabled={!editing || busy || file.pageNumber == null} onChange={event => { if (file.pageNumber == null) return; const pages = new Set(row.pageNumbers); event.target.checked ? pages.add(file.pageNumber) : pages.delete(file.pageNumber); editRow(row.id, { pageNumbers: [...pages].sort((a, b) => a - b) }); setPageNumber(file.pageNumber); }} />第 {file.pageNumber ?? '?'} 页</label>)}</fieldset>{editing && <button type="button" className="mw-remove-row" disabled={busy} onClick={() => editDraft({ rows: draft.rows.filter(item => item.id !== row.id) })}>移除本行</button>}</div>
              </article>)}
            </section>}
            {editing && <section className="ad-panel mw-panel mw-publish"><div className="mw-publish-title"><ShieldCheck size={23} aria-hidden="true" /><div><h3>核对后发布到车型规则</h3><p>仅发布已勾选项目，原有规则版本和资料依据仍可追溯。</p></div></div><label className="mw-check"><input type="checkbox" checked={applicabilityConfirmed} disabled={busy || dirty} onChange={event => setApplicabilityConfirmed(event.target.checked)} /><span>已确认手册的市场、年款和动力配置适用于「{modelName(active.modelId)}」。</span></label><label className="mw-check"><input type="checkbox" checked={verified} disabled={busy || dirty} onChange={event => setVerified(event.target.checked)} /><span>已逐项对照原文，核对操作、周期、里程口径、触发条件及脚注。</span></label>{dirty && <p className="mw-unsaved" role="status">有未保存修改。请先保存草稿，再完成以上核对确认。</p>}<div className="mw-form-actions"><button type="button" className="ad-button" onClick={() => void saveDraft()} disabled={busy || !dirty}><Save size={17} aria-hidden="true" />保存草稿</button><button type="button" className="ad-button ad-button-primary" onClick={() => void publish()} disabled={busy || dirty || !verified || !applicabilityConfirmed || includedCount === 0}>{busy ? <LoaderCircle size={17} className="ad-spin" aria-hidden="true" /> : <CheckCircle2 size={17} aria-hidden="true" />}确认发布 {includedCount} 项</button></div></section>}
          </div>
        </div>
      </div>}
    </div>
  </div>;
}
