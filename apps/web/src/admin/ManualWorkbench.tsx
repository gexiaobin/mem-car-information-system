import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AlertCircle, ArrowRight, BookOpen, CheckCircle2, ChevronDown, ExternalLink, FileText, Image as ImageIcon, LoaderCircle, Plus, RefreshCw, Save, ShieldCheck, Sparkles, UploadCloud, X } from 'lucide-react';
import { applyCommonFirstService, hasRecurringMaintenanceThreshold, usesIndependentConditionThreshold, type Bootstrap, type CatalogProject, type CatalogProjectsResponse, type ManualImport, type ManualProjectMappingDiagnostic, type ManualRuleDraft, type ManualSource, type MaintenanceAction, type MaintenanceTrigger } from '@autovoyage/shared';
import { ApiError, api, patch, post, type ApiIssue } from '../lib/api';
import './manuals.css';

interface Props {
  data: Bootstrap;
  onRefresh: () => Promise<void>;
  children: ReactNode;
  modelId: string;
  onModelChange: (modelId: string) => void;
  focusRequest?: { id: string; token: number } | null;
  ruleFocusRequest?: { modelId: string; token: number } | null;
}

interface ManualAiAnswerResult {
  query: string; sources: ManualSource[]; summary: string; warnings: string[];
  aiStatus: 'completed' | 'unavailable' | 'not_configured'; searchedAt: string; evidenceMode: 'document_reading';
  answer: {
    status: 'ready' | 'partial' | 'not_found'; title: string; summary: string;
    applicability: string; edition: string; sourceTitle: string; sourceUrl: string;
    manuals: ManualSource[]; rows: ManualRuleDraft[]; warnings: string[]; mappingDiagnostics?: ManualProjectMappingDiagnostic[];
  };
}
interface ManualAiAnswerJob {
  id: string; modelId: string; status: 'searching' | 'reading' | 'organizing' | 'completed' | 'failed';
  message: string; result?: ManualAiAnswerResult; createdAt: string; updatedAt: string;
}
const answerStages = [{ status: 'searching', title: '检索手册' }, { status: 'reading', title: '读取原文' }, { status: 'organizing', title: '整理保养表' }] as const;
type Draft = Pick<ManualImport, 'sourceTitle' | 'sourceUrl' | 'edition' | 'applicability' | 'rows'> & { sourceExcerpt: string };
const statusNames: Record<ManualImport['status'], string> = { uploaded: '等待识别', processing: '正在识别', awaiting_confirmation: '待核对', published: '已发布', failed: '识别失败' };
export const manualActionNames: Record<MaintenanceAction, string> = { inspect: '检查', replace: '更换', clean: '清洁', lubricate: '润滑', other: '其他处理' };
const triggerNames: Record<MaintenanceTrigger, string> = { periodic: '固定周期', condition: '达到条件时', as_needed: '按需处理' };
const pending = (job: ManualImport) => ['uploaded', 'processing'].includes(job.status);
const draftOf = (job: ManualImport): Draft => ({ sourceTitle: job.sourceTitle, sourceUrl: job.sourceUrl, edition: job.edition, applicability: job.applicability, sourceExcerpt: job.sourceExcerpt ?? '', rows: structuredClone(job.rows) });
const readableDate = (value: string) => new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
const messageOf = (error: unknown) => error instanceof Error ? error.message : '操作暂未完成，请稍后重试';
const validSourceLink = (value: string) => { if (!value.trim() || /^\/api\/v1\/manual-files\/[\w-]+$/.test(value.trim())) return true; try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; } };

export default function ManualWorkbench({ data, onRefresh, children, modelId, onModelChange, focusRequest, ruleFocusRequest }: Props) {
  const [tab, setTab] = useState<'imports' | 'rules'>('imports');
  const [jobs, setJobs] = useState<ManualImport[]>([]);
  const [active, setActive] = useState<ManualImport | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [sourcesError, setSourcesError] = useState('');
  const [sourceLoading, setSourceLoading] = useState(false);
  const [answerJob, setAnswerJob] = useState<ManualAiAnswerJob | null>(null);
  const [aiAnswerResult, setAiAnswerResult] = useState<ManualAiAnswerResult | null>(null);
  const [answerImportError, setAnswerImportError] = useState('');
  const [answerExpired, setAnswerExpired] = useState(false);
  const [answerImported, setAnswerImported] = useState(false);
  const [catalogProjects, setCatalogProjects] = useState<CatalogProject[]>([]);
  const [catalogError, setCatalogError] = useState('');
  const [commonFirstMonths, setCommonFirstMonths] = useState('');
  const [commonFirstKm, setCommonFirstKm] = useState('');
  const [method, setMethod] = useState<'search' | 'images'>('search');
  const [files, setFiles] = useState<File[]>([]);
  const [filePreviews, setFilePreviews] = useState<{ file: File; url: string }[]>([]);
  const [fileError, setFileError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [pageNumber, setPageNumber] = useState<number | null>(null);
  const [evidenceText, setEvidenceText] = useState({ url: '', content: '', error: '' });
  const [expanded, setExpanded] = useState<string[]>([]);
  const [serverIssues, setServerIssues] = useState<ApiIssue[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const issueSummaryRef = useRef<HTMLElement>(null);
  const sourceRequest = useRef(0);
  const formRef = useRef<HTMLFormElement>(null);
  const modelName = (id: string) => { const model = data.models.find(item => item.id === id); return model ? `${model.brand} ${model.name} · ${model.year}款 · ${model.power}` : '车型档案已变更'; };

  function adopt(job: ManualImport) {
    setActive(job); setDraft(draftOf(job)); setDirty(false); setServerIssues([]); onModelChange(job.modelId);
    setCommonFirstMonths(''); setCommonFirstKm('');
    setPageNumber(job.files.find(file => file.mimeType === 'text/plain')?.pageNumber ?? job.files.find(file => file.mimeType.startsWith('image/'))?.pageNumber ?? null);
    setExpanded([]);
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
    let cancelled = false;
    api<CatalogProjectsResponse>('/admin/catalog/projects').then(result => {
      if (!cancelled) { setCatalogProjects(result.items); setCatalogError(''); }
    }).catch(() => { if (!cancelled) setCatalogError('参考项目目录暂未读取，可重试自动关联，或先使用已有项目。'); });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    sourceRequest.current++; setAnswerJob(null); setAiAnswerResult(null); setSourcesError(''); setSourceLoading(false); setAnswerImportError(''); setAnswerExpired(false); setAnswerImported(false);
    return () => { sourceRequest.current++; };
  }, [modelId]);
  useEffect(() => {
    if (!answerJob || ['completed', 'failed'].includes(answerJob.status) || !sourceLoading) return;
    const token = sourceRequest.current;
    let cancelled = false; let refreshing = false;
    const timer = window.setInterval(() => {
      if (refreshing) return;
      refreshing = true;
      api<ManualAiAnswerJob>(`/admin/manual-imports/ai-answer/${answerJob.id}`).then(job => {
        if (!cancelled && sourceRequest.current === token) receiveAnswerJob(job);
      }).catch(reason => {
        if (!cancelled && sourceRequest.current === token) { setSourcesError(`读取查找进度失败：${messageOf(reason)}`); setSourceLoading(false); }
      }).finally(() => { refreshing = false; });
    }, 2000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [answerJob?.id, answerJob?.status, sourceLoading]);
  useEffect(() => {
    const previews = files.filter(file => file.type.startsWith('image/')).map(file => ({ file, url: URL.createObjectURL(file) }));
    setFilePreviews(previews);
    return () => { previews.forEach(preview => URL.revokeObjectURL(preview.url)); };
  }, [files]);
  useEffect(() => { if (error) (issueSummaryRef.current || errorRef.current)?.focus(); }, [error, serverIssues.length]);
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
  useEffect(() => {
    if (!ruleFocusRequest) return;
    setTab('rules'); onModelChange(ruleFocusRequest.modelId); setError('');
  }, [ruleFocusRequest?.token]);

  function editDraft(changes: Partial<Draft>) {
    setDraft(current => current ? { ...current, ...changes } : current); setDirty(true); setServerIssues([]); setError(''); setNotice('');
  }
  function editRow(id: string, changes: Partial<ManualRuleDraft>) {
    if (draft) editDraft({ rows: draft.rows.map(row => row.id === id ? {
      ...row,
      ...(('name' in changes && changes.name !== row.name) || ('action' in changes && changes.action !== row.action) ? { projectId: null, catalogProjectId: null, createProject: false } : {}),
      ...changes,
    } : row) });
  }
  function fillCommonFirstService() {
    if (!draft || busy) return;
    setError('');
    try {
      const result = applyCommonFirstService(draft.rows, commonFirstMonths.trim() ? Number(commonFirstMonths) : null, commonFirstKm.trim() ? Number(commonFirstKm) : null);
      if (result.changed) editDraft({ rows: result.rows });
      setNotice(result.changed ? `已填入 ${result.changed} 项空白首次周期，核对后可直接确认导入。` : '没有可填入的空白首次周期；已有值、未勾选及按条件处理的项目均保留。');
    } catch (reason) { setError(messageOf(reason)); }
  }
  async function autoMapProjects() {
    if (!active || busy || active.status !== 'awaiting_confirmation') return;
    setBusy(true); setError(''); setNotice('');
    try {
      const current = dirty ? await persist() : active;
      if (!current) return;
      const job = await post<ManualImport>(`/admin/manual-imports/${current.id}/auto-map`, { expectedRevision: current.revision });
      adopt(job);
      const previous = new Map(current.rows.map(row => [row.id, row]));
      const added = job.rows.filter(row => {
        const before = previous.get(row.id);
        return (row.projectId || row.catalogProjectId) && !before?.projectId && !before?.catalogProjectId && !before?.createProject;
      }).length;
      const remaining = job.rows.filter(row => !row.createProject && ((!row.projectId && !row.catalogProjectId) || job.mappingDiagnostics?.some(item => item.rowId === row.id && item.status === 'conflict'))).length;
      setNotice(`本次新增关联 ${added} 项，仍有 ${remaining} 项待处理，具体原因已显示在各项目下方。已有选择与勾选状态均保留，无需重新识别手册。`);
      if (catalogError) {
        try {
          const result = await api<CatalogProjectsResponse>('/admin/catalog/projects');
          setCatalogProjects(result.items); setCatalogError('');
        } catch { setCatalogError('标准项目关联已完成，但参考目录暂未读取。可按已显示的关联名称核对，或稍后重试。'); }
      }
    } catch (reason) { setError(messageOf(reason)); }
    finally { setBusy(false); }
  }
  async function persist(): Promise<ManualImport | null> {
    if (!active || !draft) return null;
    if (!validSourceLink(draft.sourceUrl)) throw new Error('来源链接须为 HTTPS；图片上传可留空。');
    const job = await patch<ManualImport>(`/admin/manual-imports/${active.id}/draft`, { expectedRevision: active.revision, ...draft, sourceTitle: draft.sourceTitle.trim() || `${modelName(active.modelId)}保养资料` });
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
  async function selectModel(nextId: string) {
    if (busy || nextId === modelId) return;
    setBusy(true); setError(''); setNotice('');
    try {
      if (dirty && active?.status === 'awaiting_confirmation') await persist();
      setActive(null); setDraft(null); setDirty(false); setServerIssues([]); setFiles([]);
      onModelChange(nextId);
    } catch (reason) { setError(`草稿尚未保存，已保留当前车型：${messageOf(reason)}`); }
    finally { setBusy(false); }
  }
  function receiveAnswerJob(job: ManualAiAnswerJob) {
    if (job.modelId !== modelId) { setSourcesError('返回资料的车型与当前选择不一致，请重新查询。'); setSourceLoading(false); return; }
    setAnswerJob(job);
    if (job.status === 'completed') {
      setSourceLoading(false);
      if (job.result) setAiAnswerResult(job.result);
      else setSourcesError('查找已结束，但未返回手册内容，请重新查询或使用保养表图片。');
    } else if (job.status === 'failed') { setSourcesError(job.message || '暂未取得可阅读的手册，请重试或使用保养表图片。'); setSourceLoading(false); }
  }
  async function aiDiscoverSources() {
    if (!modelId || sourceLoading || busy) return;
    const token = ++sourceRequest.current;
    setSourceLoading(true); setSourcesError(''); setAiAnswerResult(null); setAnswerJob(null); setAnswerImportError(''); setAnswerExpired(false); setAnswerImported(false);
    try {
      const job = await post<ManualAiAnswerJob>('/admin/manual-imports/ai-answer', { modelId, consent: true });
      if (sourceRequest.current === token) receiveAnswerJob(job);
    } catch (reason) { if (sourceRequest.current === token) { setSourcesError(messageOf(reason)); setSourceLoading(false); } }
  }
  async function importAnswer() {
    if (!answerJob || !aiAnswerResult?.answer.rows.length || answerExpired || busy || sourceLoading) return;
    setBusy(true); setError(''); setNotice(''); setServerIssues([]); setAnswerImportError('');
    try {
      const job = await post<ManualImport>('/admin/manual-imports/from-ai-answer', { modelId, answerId: answerJob.id, consent: true });
      adopt(job); setAnswerImported(true);
      setNotice(job.status === 'published' ? '这份手册已导入，正在显示已发布的资料与规则。' : '已将手册原文与保养表带入核对，资料信息和标准项目关联已自动整理；核对后可一次确认导入。');
    } catch (reason) {
      if (reason instanceof ApiError && (['AI_ANSWER_NOT_FOUND', 'MODEL_CHANGED', 'AI_ANSWER_NOT_READY'].includes(reason.code) || reason.status === 410)) {
        setAnswerExpired(true); setAnswerImportError('本次查询结果已失效，或车型资料已变更。请重新查询后再带入核对。');
      } else setAnswerImportError(messageOf(reason));
    }
    finally { setBusy(false); }
  }
  function receiveFiles(incoming: File[]) {
    if (busy || !incoming.length) return;
    const next = [...files, ...incoming].filter((file, index, all) => all.findIndex(other => other.name === file.name && other.size === file.size && other.lastModified === file.lastModified) === index);
    let message = '';
    if (next.some(file => !['image/jpeg', 'image/png', 'image/webp'].includes(file.type))) message = '请选择 JPEG、PNG 或 WebP 保养表图片。';
    else if (next.length > 12) message = '每次最多选择 12 张图片。';
    else if (next.some(file => file.size > 8 * 1024 * 1024)) message = '每张图片不能超过 8 MB。';
    else if (next.reduce((sum, file) => sum + file.size, 0) > 32 * 1024 * 1024) message = '本次图片总大小不能超过 32 MB。';
    setFileError(message); if (message) return;
    setFiles(next); setError('');
  }
  async function startImport() {
    if (busy || !modelId) return;
    setError(''); setNotice(''); setServerIssues([]);
    if (!data.config.aiConfigured) { setError('AI 服务尚未配置，请联系部署者完成配置。'); return; }
    if (!files.length) { setFileError('请添加至少一张保养表图片。'); return; }
    setBusy(true);
    try {
      const body = new FormData(); body.append('modelId', modelId); body.append('consent', 'true');
      files.forEach(file => body.append('files', file));
      const job = await api<ManualImport>('/admin/manual-imports', { method: 'POST', body });
      adopt(job); setFiles([]); if (fileInput.current) fileInput.current.value = '';
      setFileError(''); setNotice('资料已接收，AI 正在整理保养项目。识别后只需在此核对并导入。');
    } catch (reason) { setError(messageOf(reason)); }
    finally { setBusy(false); }
  }
  async function saveDraft() {
    if (busy) return; setBusy(true); setError(''); setNotice('');
    try { await persist(); setNotice('草稿已保存，可稍后继续；确认导入时也会自动保存修改。'); }
    catch (reason) { setError(messageOf(reason)); }
    finally { setBusy(false); }
  }
  function rowIssues(row: ManualRuleDraft, index: number): ApiIssue[] {
    const issues: ApiIssue[] = [];
    const add = (field: string, message: string) => issues.push({ rowId: row.id, rowNumber: index + 1, field, message });
    const pages = new Set(active?.files.map(file => file.pageNumber).filter(number => number != null));
    if (!row.name.trim()) add('name', '请填写项目名称。');
    if (!row.projectId && !row.catalogProjectId && !row.createProject) add('projectId', '未能自动关联标准项目，请选择项目，或本次不导入。');
    if (row.catalogProjectId && catalogProjects.length && catalogProjects.find(project => project.id === row.catalogProjectId)?.action !== row.action) add('projectId', '所选标准项目的操作不一致，请区分检查与更换。');
    if (row.projectId && !data.projects.some(project => project.id === row.projectId && project.active)) add('projectId', '所选标准项目不可用，请重新关联。');
    if (!row.sourceText.trim()) add('sourceText', '缺少支持本项的原文，请补充摘录。');
    if (!row.pageNumbers.length || row.pageNumbers.some(page => !pages.has(page))) add('pageNumbers', '请关联本份资料中的原文证据。');
    for (const key of ['firstMonths', 'firstKm', 'intervalMonths', 'intervalKm'] as const) {
      const value = row[key];
      if (value != null && (!Number.isInteger(value) || value <= 0 || value > (key.endsWith('Months') ? 1200 : 2000000))) add(key, '周期应为有效正整数，原文未说明时留空。');
    }
    if (row.triggerType === 'periodic') {
      if (row.condition.trim()) add('condition', '带特殊工况的项目请改为按条件处理，普通说明可移至脚注。');
      if (row.intervalMonths == null && row.intervalKm == null) add('intervalMonths', '未识别到后续周期，请按原文补充或本次不导入。');
    } else if (!row.condition.trim()) add('condition', '请保留按条件或按需处理的原文依据。');
    if (usesIndependentConditionThreshold(row) && !hasRecurringMaintenanceThreshold(row)) add('conditionThresholdsIndependent', '启用时间／里程提醒前，请填写原文明确的后续月份或公里阈值。');
    return issues;
  }
  function reviewIssues(): ApiIssue[] {
    if (!draft) return [];
    const issues = draft.rows.flatMap((row, index) => row.include ? rowIssues(row, index) : []);
    const targets = new Set<string>();
    for (const [index, row] of draft.rows.entries()) {
      if (!row.include) continue;
      const target = row.projectId || (row.catalogProjectId ? data.projects.find(project => project.catalogSource?.catalogId === row.catalogProjectId)?.id || `catalog:${row.catalogProjectId}` : '');
      if (target && targets.has(target)) issues.push({ rowId: row.id, rowNumber: index + 1, field: 'projectId', message: '与另一项关联了同一标准项目，请合并核对，或本次不导入。' });
      if (target) targets.add(target);
    }
    if (!validSourceLink(draft.sourceUrl)) issues.push({ field: 'sourceUrl', message: '资料来源链接须为 HTTPS，图片资料可以留空。' });
    return issues;
  }
  function revealIssue(issue: ApiIssue) {
    if (issue.rowId) {
      setExpanded(current => current.includes(issue.rowId!) ? current : [...current, issue.rowId!]);
      requestAnimationFrame(() => { const node = document.getElementById(`mw-row-${issue.rowId}`); node?.scrollIntoView({ block: 'center', behavior: 'auto' }); const field = issue.field === 'interval' ? 'intervalMonths' : issue.field; const control = node ? Array.from(node.querySelectorAll<HTMLElement>('[data-field]')).find(element => element.dataset.field === field) || node.querySelector<HTMLElement>('[aria-invalid="true"]') || node.querySelector<HTMLElement>('input:not([type="checkbox"]), select, textarea') : null; control?.focus(); });
    } else { const node = document.getElementById('mw-metadata'); if (node instanceof HTMLDetailsElement) node.open = true; requestAnimationFrame(() => node?.querySelector<HTMLElement>('input[type="url"]')?.focus()); }
  }
  function selectReadyRows() {
    if (!draft) return;
    const seen = new Set<string>();
    const rows = draft.rows.map((row, index) => {
      const target = row.projectId || (row.catalogProjectId ? data.projects.find(project => project.catalogSource?.catalogId === row.catalogProjectId)?.id || `catalog:${row.catalogProjectId}` : '');
      const ready = row.include && rowIssues(row, index).length === 0 && !serverIssues.some(issue => issue.rowId === row.id) && (!target || !seen.has(target));
      if (ready && target) seen.add(target);
      return { ...row, include: ready };
    });
    editDraft({ rows }); setNotice(`已选择 ${rows.filter(row => row.include).length} 项可导入项目，其他项目保留在资料中，不会生成规则。`);
  }
  async function publish() {
    if (busy || !active || !draft) return;
    const issues = reviewIssues();
    if (!draft.rows.some(row => row.include)) { setError('请至少选择一项可导入的保养项目。'); return; }
    if (issues.length) { setServerIssues([]); setError(`有 ${issues.length} 处需要处理，已在下方集中列出。可修改，或仅保留可导入项目。`); return; }
    setBusy(true); setError(''); setNotice(''); setServerIssues([]);
    let saved = false;
    try {
      const job = await post<ManualImport>(`/admin/manual-imports/${active.id}/publish`, { expectedRevision: active.revision, draft, verified: true, applicabilityConfirmed: true });
      saved = true; adopt(job); await onRefresh(); setNotice(`已为当前车型导入 ${job.publishedRuleIds.length} 项保养规则。`);
    } catch (reason) {
      if (reason instanceof ApiError && reason.issues.length) setServerIssues(reason.issues);
      setError(saved ? '规则已导入，业务数据刷新暂未完成。请刷新查看。' : messageOf(reason));
    } finally { setBusy(false); }
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
  const preview = images.find(file => file.pageNumber === pageNumber) || (active?.files.some(file => file.mimeType === 'text/plain') ? undefined : images[0]);
  const evidenceFiles = active?.files.filter(file => file.pageNumber != null).filter((file, index, all) => all.findIndex(other => other.pageNumber === file.pageNumber) === index) || [];
  const editing = active?.status === 'awaiting_confirmation';
  const includedCount = draft?.rows.filter(row => row.include).length || 0;
  const textImport = Boolean(active?.files.some(file => file.mimeType === 'text/plain'));
  const imageImport = !textImport && (active?.pageSelection?.mode === 'images' || Boolean(active && !active.files.some(file => file.mimeType === 'application/pdf')));
  const selectedTextEvidence = evidenceFiles.find(file => file.pageNumber === pageNumber && file.mimeType === 'text/plain');
  const evidenceName = (number: number | null) => {
    const file = evidenceFiles.find(item => item.pageNumber === number);
    if (file?.mimeType === 'text/plain') return `网页原文 ${evidenceFiles.filter(item => item.mimeType === 'text/plain').findIndex(item => item.id === file.id) + 1}`;
    if (textImport && file?.mimeType.startsWith('image/')) return `图片 ${images.findIndex(item => item.id === file.id) + 1}`;
    return imageImport ? `图片 ${number ?? '?'}` : `第 ${number ?? '?'} 页`;
  };
  useEffect(() => {
    const controller = new AbortController();
    const url = selectedTextEvidence?.url || '';
    setEvidenceText({ url, content: '', error: '' });
    if (!url) return () => controller.abort();
    fetch(url, { credentials: 'include', signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('原文暂未读取成功，请使用下方原件链接查看。');
      const content = (await response.text()).replace(/^\ufeff/, '');
      if (content.length > 100000) throw new Error('原文较长，请使用下方原件链接查看。');
      if (!controller.signal.aborted) setEvidenceText({ url, content, error: '' });
    }).catch(reason => { if (!controller.signal.aborted) setEvidenceText({ url, content: '', error: messageOf(reason) }); });
    return () => controller.abort();
  }, [selectedTextEvidence?.url]);
  const metadataHint = (field: 'sourceTitle' | 'edition' | 'applicability') => {
    if (draft && active && draft[field] !== active[field]) return '人工修改 · 保存后生效';
    const origin = active?.metadataOrigin?.[field];
    return origin ? { provided: '人工填写', document: '从资料原文识别 · 待核对', filename: '由文件名生成 · 待核对', target: '按所选车型拟关联 · 尚未证实', unknown: '原文未注明 · 可保留为空' }[origin] : '已保存信息 · 请对照原文核对';
  };

  const conciseMetadata = (field: 'edition' | 'applicability') => {
    const value = draft?.[field].trim() || '';
    const origin = active?.metadataOrigin?.[field];
    const unconfirmedOrigin = value === active?.[field] && (origin === 'unknown' || origin === 'target');
    const unknownMarker = /^(?:未知|不详|不明|未见|未识别|未提供|未标注|无法确定|待核对|待确认|unknown|n\/?a|适用范围未知|版本未知)(?:[（(：:；;，,。.!！\s]|$)/i.test(value);
    return !value || unconfirmedOrigin || unknownMarker ? '原文未注明' : value;
  };

  const applicabilityWarnings = (active?.warnings || []).filter(warning => {
    const mismatch = /不适用|不匹配|不符|冲突|混有|混合|混杂|不一致|多个年款|不同年款|不同车型|不同动力|不覆盖|不涵盖/.test(warning);
    const uncertainMatch = /不能(?:据此)?证明|无法(?:据此)?证明|不能确认|无法确认|未能证实/.test(warning) && /(?:19|20)\d{2}|混有|混合|不同|多个|冲突|年款|动力|配置|市场/.test(warning);
    const genericTargetNotice = /^(?:识别页面未明确给出适用车型与版本，请结合手册封面和原车资料核对；目标车型不构成适用证据。|(?:所选|目标)车型(?:本身|信息)?(?:不构成适用证据|不能证明手册适用)[。！!]?|适用范围未知（待核对）；拟关联：.*尚未证实适用。)$/.test(warning);
    return !genericTargetNotice && (mismatch || uncertainMatch);
  }).slice(0, 2);

  const modelJobs = jobs.filter(job => job.modelId === modelId);
  const currentModel = data.models.find(model => model.id === modelId);
  const currentRuleCount = data.rules.filter(rule => rule.modelId === modelId && !rule.supersededBy).length;
  const allIssues = [...reviewIssues(), ...serverIssues].filter((issue, index, all) => all.findIndex(other => other.rowId === issue.rowId && other.field === issue.field && other.message === issue.message) === index);
  const threshold = (months: number | null, km: number | null) => [months == null ? '' : `${months} 个月`, km == null ? '' : `${km.toLocaleString()} km`].filter(Boolean).join(' / ') || '原文未单列';
  const answer = aiAnswerResult?.answer;
  const answerHasRows = Boolean(answer && answer.status !== 'not_found' && answer.rows.length);
  const answerWarnings = [...(aiAnswerResult?.warnings || []), ...(answer?.warnings || [])].filter((warning, index, all) => all.indexOf(warning) === index);
  const answerManuals = (answer?.manuals || []).filter(source => source.isDirectory !== true);
  const answerStage = Math.max(0, answerStages.findIndex(stage => stage.status === answerJob?.status));
  // Mapping diagnostics describe saved matching inputs. Checkbox, cycle and
  // metadata edits preserve them; component/action/target edits invalidate them.
  const savedMappingInputs = new Map(active?.rows.map(row => [row.id, row]) || []);
  const mappingInputsChanged = Boolean(draft && active && (draft.rows.length !== active.rows.length || draft.rows.some(row => {
    const saved = savedMappingInputs.get(row.id);
    return !saved || row.name !== saved.name || row.action !== saved.action || row.projectId !== saved.projectId || row.catalogProjectId !== saved.catalogProjectId || row.createProject !== saved.createProject;
  })));
  const mappingDiagnostics = mappingInputsChanged ? undefined : active?.mappingDiagnostics;
  function mappingInfo(row: ManualRuleDraft, diagnostics?: readonly ManualProjectMappingDiagnostic[]) {
    const diagnostic = diagnostics?.find(item => item.rowId === row.id);
    if (row.createProject) return { status: 'new', title: `待新建标准项目：${row.name || '名称待填写'}`, detail: '确认导入时创建，不会覆盖已有项目。' };
    if (row.projectId || row.catalogProjectId) {
      const target = row.projectId ? data.projects.find(project => project.id === row.projectId)?.name : catalogProjects.find(project => project.id === row.catalogProjectId)?.name;
      const conflict = diagnostic?.status === 'conflict';
      return {
        status: conflict ? 'conflict' : 'matched',
        title: `${conflict ? '已选项目，关联待核对' : '已关联'}：${target || diagnostic?.targetName || (row.catalogProjectId ? '参考标准项目（目录待读取）' : '已有标准项目（名称待读取）')}`,
        detail: conflict ? diagnostic.message : row.catalogProjectId ? '参考标准项目将在确认导入时创建或复用。' : '使用系统已有标准项目。',
      };
    }
    if (diagnostic?.status === 'matched') return {
      status: 'suggested', title: `可自动关联：${diagnostic.targetName || '标准项目'}`,
      detail: '点击上方“重新自动关联标准项目”即可带入关联；本次勾选仍由你核对。',
    };
    return {
      status: diagnostic?.status === 'conflict' ? 'conflict' : 'unmapped',
      title: diagnostic?.status === 'conflict' ? '标准项目关联有冲突' : '尚未关联标准项目',
      detail: diagnostic ? diagnostic.message : mappingInputsChanged ? '项目或关联已修改，请重新自动关联，或展开后选择标准项目。' : '可重新自动关联，或展开后选择标准项目；原文与周期会保留。',
    };
  }
  const mappedCount = draft?.rows.filter(row => row.projectId || row.catalogProjectId).length || 0;
  const mappingPendingCount = draft?.rows.filter(row => ['suggested', 'unmapped', 'conflict'].includes(mappingInfo(row, mappingDiagnostics).status)).length || 0;
  const mappingNewCount = draft?.rows.filter(row => row.createProject).length || 0;

  return <div className="mw-workbench mw-simple-workbench">
    <section className="mw-model-context ad-panel" aria-label="按车型管理保养资料">
      <span className="mw-context-icon"><BookOpen size={25} aria-hidden="true" /></span>
      <label className="mw-field"><span>当前车型</span><select aria-label="当前保养车型" value={modelId} disabled={busy || !data.models.length} onChange={event => void selectModel(event.target.value)}>{!data.models.length && <option value="">请先建立车型档案</option>}{data.models.map(model => <option key={model.id} value={model.id}>{modelName(model.id)}{model.isDemo ? '（演示）' : ''}</option>)}</select></label>
      <div className="mw-context-stats"><span><strong>{currentRuleCount}</strong> 项现行规则</span><span><strong>{modelJobs.length}</strong> 份保养资料</span></div>
    </section>
    <div className="mw-tabs" role="tablist" aria-label="当前车型保养资料">
      <button type="button" id="mw-import-tab" role="tab" tabIndex={tab === 'imports' ? 0 : -1} aria-selected={tab === 'imports'} aria-controls="mw-import-panel" onClick={() => setTab('imports')} onKeyDown={event => { if (['ArrowRight', 'ArrowLeft', 'End'].includes(event.key)) { event.preventDefault(); setTab('rules'); document.getElementById('mw-rules-tab')?.focus(); } }}><Sparkles size={18} aria-hidden="true" />导入保养资料</button>
      <button type="button" id="mw-rules-tab" role="tab" tabIndex={tab === 'rules' ? 0 : -1} aria-selected={tab === 'rules'} aria-controls="mw-rules-panel" onClick={() => setTab('rules')} onKeyDown={event => { if (['ArrowRight', 'ArrowLeft', 'Home'].includes(event.key)) { event.preventDefault(); setTab('imports'); document.getElementById('mw-import-tab')?.focus(); } }}><BookOpen size={18} aria-hidden="true" />本车型规则<span>{currentRuleCount}</span></button>
    </div>
    <div ref={errorRef} tabIndex={-1} className={`mw-feedback mw-error ${error ? '' : 'mw-hidden'}`} role="alert"><AlertCircle size={19} aria-hidden="true" /><span>{error}</span></div>
    {notice && <div className="mw-feedback mw-success" role="status"><CheckCircle2 size={19} aria-hidden="true" /><span>{notice}</span></div>}
    <div id="mw-rules-panel" role="tabpanel" aria-labelledby="mw-rules-tab" hidden={tab !== 'rules'}>{children}</div>
    <div id="mw-import-panel" role="tabpanel" aria-labelledby="mw-import-tab" hidden={tab !== 'imports'}>
      <div className="mw-history-bar"><p className="mw-journey">选车型 <ArrowRight size={14} aria-hidden="true" />AI 查找或图片识别 <ArrowRight size={14} aria-hidden="true" />核对后一次导入</p><div>{active && <button type="button" className="ad-button" onClick={() => void chooseJob(null)} disabled={busy}><Plus size={16} aria-hidden="true" />导入另一份资料</button>}<button type="button" className="ad-button ad-button-ghost" onClick={() => void refresh()} disabled={busy} aria-label="刷新本车型资料"><RefreshCw size={16} aria-hidden="true" /></button></div></div>
      {loading ? <p className="mw-loading" role="status">正在读取本车型资料…</p> : modelJobs.length > 0 && <details className="mw-history-details"><summary>本车型已有资料 <span>{modelJobs.length} 份{modelJobs.some(job => job.status === 'awaiting_confirmation') ? ` · ${modelJobs.filter(job => job.status === 'awaiting_confirmation').length} 份待核对` : ''}</span><ChevronDown size={17} aria-hidden="true" /></summary><div className="mw-history-list">{modelJobs.map(job => <button key={job.id} type="button" aria-current={active?.id === job.id ? 'true' : undefined} disabled={busy} onClick={() => void chooseJob(job)}><span><strong>{job.sourceTitle || '保养资料'}</strong><small>{readableDate(job.createdAt)}</small></span><span className={`mw-status mw-status-${job.status}`}>{statusNames[job.status]}</span></button>)}</div></details>}
      {!active ? <div className="mw-new-import">
        <div className="mw-entry-switch" role="group" aria-label="选择导入方式">
          <button type="button" aria-pressed={method === 'search'} className={method === 'search' ? 'mw-entry-active' : ''} onClick={() => { setMethod('search'); setError(''); }}><Sparkles size={24} aria-hidden="true" /><span><strong>AI 查找手册</strong><small>直接阅读手册，整理保养项目与周期</small></span><ArrowRight size={18} aria-hidden="true" /></button>
          <button type="button" aria-pressed={method === 'images'} className={method === 'images' ? 'mw-entry-active' : ''} onClick={() => { setMethod('images'); setError(''); }}><ImageIcon size={24} aria-hidden="true" /><span><strong>图片识别导入</strong><small>上传或粘贴保养周期表截图</small></span><ArrowRight size={18} aria-hidden="true" /></button>
        </div>
        {method === 'search' ? <section className="ad-panel mw-panel mw-search-panel">
          <div className="mw-search-intro"><div className="mw-panel-title"><span className="mw-title-icon"><Sparkles size={23} aria-hidden="true" /></span><div><h2>直接找到手册，读出保养要求</h2><p>AI 将查找{currentModel ? `「${currentModel.brand} ${currentModel.name}」` : '当前车系'}的公开手册，读取可访问的原文，在这里给出保养项目与周期表。</p></div></div><button type="button" className={`ad-button ${answerHasRows ? '' : 'ad-button-primary'}`} disabled={busy || sourceLoading || !modelId} onClick={() => void aiDiscoverSources()}>{sourceLoading ? <LoaderCircle size={18} className="ad-spin" aria-hidden="true" /> : <Sparkles size={18} aria-hidden="true" />}{sourceLoading ? '正在查找并阅读…' : aiAnswerResult || sourcesError ? '重新查询保养手册' : 'AI 查询保养手册'}</button></div>
          {!sourceLoading && !aiAnswerResult && !sourcesError && <div className="mw-search-empty"><BookOpen size={33} aria-hidden="true" /><strong>手册原文、保养周期，一次整理</strong><p>找到可读取的资料后，直接显示手册与项目表；名称、版本和适用说明一并整理。</p></div>}
          {sourceLoading && <div className="mw-answer-progress" role="status" aria-live="polite"><div><LoaderCircle size={23} className="ad-spin" aria-hidden="true" /><strong>{answerJob?.message || '正在提交手册查询…'}</strong></div><ol aria-label="手册查询进度">{answerStages.map((stage, index) => <li key={stage.status} className={index < answerStage ? 'mw-stage-done' : index === answerStage ? 'mw-stage-current' : ''} aria-current={index === answerStage ? 'step' : undefined}><span>{index < answerStage ? <CheckCircle2 size={17} aria-hidden="true" /> : index + 1}</span>{stage.title}</li>)}</ol><p>完成后会自动显示手册内容与保养表。读取较长的手册需要一些时间。</p></div>}
          {sourcesError && <div className="mw-source-error" role="alert"><p>{sourcesError}</p><button type="button" className="ad-link-button" onClick={() => setMethod('images')}>改用保养表图片识别</button></div>}
          {answer && <section className={`mw-answer ${answerHasRows ? '' : 'mw-answer-empty'}`} aria-labelledby="mw-answer-title">
            <div className="mw-answer-heading"><span className="mw-answer-mark">{answerHasRows ? <BookOpen size={24} aria-hidden="true" /> : <AlertCircle size={24} aria-hidden="true" />}</span><div><span className="mw-answer-eyebrow">{answerHasRows ? answer.status === 'partial' ? '已读取手册 · 部分要求待核对' : '已读取手册原文' : '本次未取得可整理的保养项目'}</span><h3 id="mw-answer-title">{answerHasRows ? answer.title || '这款车的保养手册与周期表' : '暂未找到可直接使用的保养手册'}</h3></div></div>
            <p className="mw-answer-summary">{answer.summary || aiAnswerResult.summary}</p>
            {answerManuals.length > 0 && <div className="mw-answer-manuals" aria-label="已读取的手册资料">{answerManuals.map(source => <article key={source.url}><FileText size={22} aria-hidden="true" /><div><span>{source.kind === 'official' ? '品牌官方资料' : '公开手册资料'}</span><h4>{source.title}</h4>{source.url.startsWith('https://') && <a href={source.url} target="_blank" rel="noreferrer">阅读手册原文<ExternalLink size={14} aria-hidden="true" /></a>}{source.description && <details className="mw-answer-source-notes"><summary>来源说明<ChevronDown size={14} aria-hidden="true" /></summary><p>{source.description}</p></details>}</div></article>)}</div>}
            {answerHasRows && <>
              <dl className="mw-answer-metadata"><div><dt>原文适用范围</dt><dd>{answer.applicability || '原文未注明，请结合年款与动力核对'}</dd></div>{answer.edition && <div><dt>手册版本</dt><dd>{answer.edition}</dd></div>}</dl>
              {answerWarnings.length > 0 && <details className="mw-answer-warning"><summary><AlertCircle size={19} aria-hidden="true" /><strong>有 {answerWarnings.length} 项原文说明／待核对事项</strong><ChevronDown size={17} aria-hidden="true" /></summary><ul>{answerWarnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></details>}
              <div className="mw-answer-table-heading"><h4>保养项目与周期</h4><span>{answer.rows.length} 项 · 时间与里程支持单独设置；条件要求以原文为准</span></div>
              <table className="mw-answer-table" role="table"><caption className="mw-sr-only">AI 从手册整理的保养项目、首次与后续周期及待核对原文摘录</caption><thead><tr><th scope="col">保养项目</th><th scope="col">首次</th><th scope="col">后续周期／条件</th><th scope="col">原文依据</th></tr></thead><tbody>{answer.rows.map(row => <tr key={row.id}><td data-label="保养项目"><strong>{row.name}</strong><small>{manualActionNames[row.action]} · {triggerNames[row.triggerType]}</small></td><td data-label="首次">{threshold(row.firstMonths, row.firstKm)}{row.triggerType !== 'periodic' && (row.firstMonths != null || row.firstKm != null) && <small>{usesIndependentConditionThreshold(row) ? '与原文条件先到提醒' : '仅适用于原文条件'}</small>}</td><td data-label="后续周期／条件">{row.triggerType === 'periodic' ? threshold(row.intervalMonths, row.intervalKm) : <>{row.condition || '以手册说明为准'}{(row.intervalMonths != null || row.intervalKm != null) && <span className="mw-answer-condition-threshold">原文阈值：{threshold(row.intervalMonths, row.intervalKm)}<small>{usesIndependentConditionThreshold(row) ? '与原文条件先到提醒' : '限上述条件，不作为通用到期周期'}</small></span>}</>}{row.mileageType === 'engine_km' && <small>发动机累计里程</small>}</td><td data-label="原文依据"><details><summary>核对 AI 摘录<ChevronDown size={14} aria-hidden="true" /></summary><blockquote>{row.sourceText || '请打开手册原文核对。'}</blockquote>{row.notes && <p>{row.notes}</p>}{answerManuals.length <= 1 && answer.sourceUrl.startsWith('https://') ? <a href={answer.sourceUrl} target="_blank" rel="noreferrer">{answer.sourceTitle || '来源手册'}<ExternalLink size={13} aria-hidden="true" /></a> : <p>证据编号：{row.pageNumbers.join('、')} · 手册链接见上方</p>}</details></td></tr>)}</tbody></table>
              {answerImportError && <p className="mw-answer-import-error" role="alert"><AlertCircle size={18} aria-hidden="true" />{answerImportError}</p>}
              <div className="mw-answer-footer"><p>{answerExpired ? '已整理的结果仍可阅读。重新查询会取得当前车型的最新可用手册内容。' : answerImported ? '这份查询已带入资料，点击继续查看，不会重复创建。' : '资料信息与项目已自动整理。带入后对照原文核对一次，再确认导入本车型规则。'}</p><button type="button" className="ad-button ad-button-primary" disabled={busy || sourceLoading} onClick={() => void (answerExpired ? aiDiscoverSources() : importAnswer())}>{busy ? <LoaderCircle size={18} className="ad-spin" aria-hidden="true" /> : <ArrowRight size={18} aria-hidden="true" />}{busy ? '正在带入…' : answerExpired ? '重新查询并整理' : answerImported ? '查看已带入的资料' : `带入核对 ${answer.rows.length} 项`}</button></div>
            </>}
            {!answerHasRows && <>{answerWarnings.length > 0 && <details className="mw-answer-query-notes"><summary>查看查询说明<ChevronDown size={16} aria-hidden="true" /></summary><ul>{answerWarnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></details>}<p className="mw-answer-no-result">可尝试补全车型档案中的年款与动力后重新查询，或使用已有的保养表截图。</p><button type="button" className="ad-button" onClick={() => setMethod('images')}><ImageIcon size={17} aria-hidden="true" />使用保养表图片</button></>}
            <small className="mw-answer-date">查询时间：{readableDate(aiAnswerResult.searchedAt)}</small>
          </section>}
          <p className="mw-ai-consent">点击查询，即使用当前 AI 服务查找并阅读公开资料。项目表为 AI 整理结果，导入前请对照手册核对摘录、周期与车型适用性。</p>
        </section> : <form ref={formRef} className="ad-panel mw-panel mw-image-panel" onSubmit={event => { event.preventDefault(); void startImport(); }} onPaste={event => {
          if (busy || ['INPUT', 'TEXTAREA'].includes((event.target as HTMLElement).tagName) || (event.target as HTMLElement).isContentEditable) return;
          const pasted = Array.from(event.clipboardData.items).filter(item => item.kind === 'file').map(item => item.getAsFile()).filter((file): file is File => file != null);
          if (pasted.length) { event.preventDefault(); receiveFiles(pasted); }
        }}>
          <div className="mw-panel-title"><span className="mw-title-icon"><ImageIcon size={23} aria-hidden="true" /></span><div><h2>一张保养表，AI 帮你整理成规则</h2><p>上传截图或手册照片即可。名称、版本、来源和适用范围均自动整理，无需提前填写。</p></div></div>
          <div className={`mw-upload-area mw-dropzone ${dragging ? 'mw-dragging' : ''} ${fileError ? 'mw-upload-invalid' : ''}`} tabIndex={busy ? -1 : 0} role="region" aria-label="保养表图片上传区，可选择、拖入或粘贴截图" aria-describedby={fileError ? 'mw-file-help mw-file-error' : 'mw-file-help'} onDragOver={event => { event.preventDefault(); if (!busy) { event.dataTransfer.dropEffect = 'copy'; setDragging(true); } }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }} onDrop={event => { event.preventDefault(); setDragging(false); receiveFiles(Array.from(event.dataTransfer.files)); }}>
            <UploadCloud size={35} aria-hidden="true" /><strong>拖入保养表图片，或按 Ctrl+V 粘贴截图</strong><p>保留公里数、月份、表头及检查／更换图例，封面可以一起上传。</p><label className="mw-file-button" htmlFor="manual-upload-files"><Plus size={17} aria-hidden="true" />{files.length ? '继续添加图片' : '选择保养表图片'}</label><input id="manual-upload-files" className="mw-sr-only" ref={fileInput} type="file" multiple accept="image/jpeg,image/png,image/webp" disabled={busy} aria-describedby="mw-file-help" aria-invalid={Boolean(fileError)} onChange={event => { receiveFiles(Array.from(event.target.files || [])); event.target.value = ''; }} /><small id="mw-file-help">最多 12 张，每张不超过 8 MB，总大小不超过 32 MB。</small>
          </div>{fileError && <p id="mw-file-error" className="mw-field-error" role="alert">{fileError}</p>}
          {filePreviews.length > 0 && <div className="mw-uploaded-images" aria-label="已选择的保养表图片">{filePreviews.map(({ file, url }, index) => <figure key={`${file.name}-${file.lastModified}-${index}`}><img src={url} alt={`待识别的保养表图片 ${index + 1}`} /><figcaption><strong>{file.name}</strong><small>{(file.size / 1024 / 1024).toFixed(1)} MB</small></figcaption><button type="button" aria-label={`移除图片 ${index + 1}`} disabled={busy} onClick={() => { setFiles(current => current.filter((_, position) => position !== index)); setFileError(''); }}><X size={17} aria-hidden="true" /></button></figure>)}</div>}
          <p className="mw-ai-consent">点击开始识别，即将这些图片交给当前 AI 服务处理。请使用你有权导入的资料；识别结果先保存为待核对资料。</p>
          <div className="mw-form-actions"><span>{files.length ? `已选择 ${files.length} 张图片 · 为 ${currentModel?.brand || ''} ${currentModel?.name || '当前车型'} 整理规则` : '添加图片后即可开始'}</span><button type="submit" className="ad-button ad-button-primary" disabled={busy || !modelId || !data.config.aiConfigured}>{busy ? <LoaderCircle size={18} className="ad-spin" aria-hidden="true" /> : <Sparkles size={18} aria-hidden="true" />}{busy ? '正在接收图片…' : '开始识别图片'}</button></div>
        </form>}
      </div> : <div className="mw-review">
        <section className="ad-panel mw-panel mw-job-summary"><div><span className={`mw-status mw-status-${active.status}`}>{statusNames[active.status]}</span><h2>{active.sourceTitle || '保养资料（待识别）'}</h2><p>{modelName(active.modelId)}</p><small>{readableDate(active.createdAt)} · 草稿修订 {active.revision}{active.aiModel ? ` · ${active.aiModel}` : ''}</small></div>{active.status === 'published' && <span className="mw-published-mark"><ShieldCheck size={28} aria-hidden="true" />{active.publishedRuleIds.length} 项规则已发布</span>}</section>
        {applicabilityWarnings.length > 0 && <section className="mw-applicability-warning" role="status" aria-label="资料适用性提醒"><div><AlertCircle size={22} aria-hidden="true" /><h3>请先核对资料适用性</h3></div><ul>{applicabilityWarnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul><p>若年款、动力或市场不匹配，请更换资料；不要将其他配置的保养要求直接用于当前车型。</p></section>}
        {active.reason && <div className={`mw-feedback ${active.status === 'failed' ? 'mw-error' : 'mw-information'}`} role="status">{pending(active) ? <LoaderCircle size={19} className="ad-spin" aria-hidden="true" /> : active.status === 'failed' ? <AlertCircle size={19} aria-hidden="true" /> : <FileText size={19} aria-hidden="true" />}<span>{active.reason}</span>{active.status === 'failed' && <button type="button" className="ad-button" onClick={() => void retry()} disabled={busy}>重新识别</button>}</div>}
        {active.pageSelection && <div className="mw-page-selection" role="status"><FileText size={18} aria-hidden="true" /><div><strong>{textImport ? '公开网页与保养图片识别' : ({ auto: 'AI 自动定位保养表', manual: '按指定页码识别', all: '完整资料识别', images: '保养表图片识别' })[active.pageSelection.mode]}</strong><p>{textImport ? `已留存网页正文${images.length ? `及 ${images.length} 张原文图片` : ''}` : active.pageSelection.mode === 'images' ? `共 ${images.length} 张原文图片` : `${active.pageSelection.pages.length ? `采用第 ${active.pageSelection.pages.join('、')} 页` : '正在定位相关内容'}${active.pageSelection.totalPages ? ` · 全文 ${active.pageSelection.totalPages} 页` : ''}`}{active.pageSelection.notice ? ` · ${active.pageSelection.notice}` : ''}</p></div></div>}
        {active.warnings.length > 0 && <details className="mw-warnings"><summary><AlertCircle size={18} aria-hidden="true" />资料提示 <span>{active.warnings.length} 项</span><ChevronDown size={16} aria-hidden="true" /></summary><ul>{active.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></details>}
        {editing && allIssues.length > 0 && <section ref={issueSummaryRef} id="mw-review-issues" className="mw-review-issues" tabIndex={-1} aria-labelledby="mw-issues-title"><div><AlertCircle size={21} aria-hidden="true" /><h3 id="mw-issues-title">集中处理 {allIssues.length} 处问题</h3></div><p>已识别到的内容都保留在下方。可以修改这些项目，也可先导入完整项目，其余留作资料。</p><ul>{allIssues.map((issue, index) => <li key={`${issue.rowId}-${issue.field}-${index}`}><button type="button" onClick={() => revealIssue(issue)}>{issue.rowNumber ? `第 ${issue.rowNumber} 项：` : ''}{issue.message}</button></li>)}</ul><button type="button" className="ad-button" disabled={busy} onClick={selectReadyRows}>仅保留可导入项目</button></section>}
        <div className="mw-review-grid">
          <aside className="ad-panel mw-evidence"><div className="mw-evidence-heading"><h3><ImageIcon size={18} aria-hidden="true" />手册原文</h3>{preview && <a href={preview.url} target="_blank" rel="noreferrer">放大查看<ExternalLink size={14} aria-hidden="true" /></a>}</div>{evidenceFiles.length > 0 && <div className="mw-page-buttons" aria-label="选择原文证据">{evidenceFiles.map(file => <button key={file.id} type="button" aria-pressed={pageNumber === file.pageNumber || preview?.id === file.id} onClick={() => setPageNumber(file.pageNumber)}>{evidenceName(file.pageNumber)}</button>)}</div>}{preview ? <img className="mw-evidence-image" src={preview.url} alt={`资料原文，${evidenceName(preview.pageNumber)}`} /> : <div className="mw-text-evidence">{selectedTextEvidence ? <><p><strong>{selectedTextEvidence.name.replace(/\.txt$/i, '') || evidenceName(selectedTextEvidence.pageNumber)}</strong></p>{evidenceText.url === selectedTextEvidence.url && evidenceText.error ? <p role="alert">{evidenceText.error}</p> : evidenceText.url === selectedTextEvidence.url && evidenceText.content ? <pre className="mw-evidence-text-content">{evidenceText.content}</pre> : <p role="status">正在读取这份网页原文…</p>}</> : <><p>{pending(active) ? '正在整理原文证据，请稍候。' : '请打开下方原始资料核对。'}</p>{active.sourceExcerpt && <><p>以下为整份资料的 AI 摘录，未按当前页区分。</p><blockquote>{active.sourceExcerpt}</blockquote></>}{active.sourceUrl.startsWith('https://') && <a href={active.sourceUrl} target="_blank" rel="noreferrer">打开来源网页<ExternalLink size={14} aria-hidden="true" /></a>}</>}</div>}<div className="mw-original-files">{active.files.filter(file => file.original).map(file => <a key={file.id} href={file.url} target="_blank" rel="noreferrer"><FileText size={15} aria-hidden="true" /><span>{file.mimeType === 'text/plain' ? file.name.replace(/\.txt$/i, '') || evidenceName(file.pageNumber) : file.name}</span><ExternalLink size={14} aria-hidden="true" /></a>)}</div></aside>

          <div className="mw-draft-column">
            {draft && <section className="ad-panel mw-panel mw-recognized-metadata"><div className="mw-recognition-heading"><Sparkles size={20} aria-hidden="true" /><div><h3>{pending(active) ? 'AI 正在整理资料信息' : '资料信息已自动整理'}</h3><p>原文未注明的版本等信息可留空，不影响导入。</p></div></div><dl className="mw-metadata-summary"><div><dt>资料名称</dt><dd>{draft.sourceTitle || `${modelName(active.modelId)}保养资料`}</dd></div><div><dt>版本</dt><dd>{conciseMetadata('edition')}</dd></div><div><dt>适用范围</dt><dd>{conciseMetadata('applicability')}</dd></div></dl><details id="mw-metadata" className="mw-optional"><summary><span>{editing ? '修改资料信息（选填）' : '查看资料信息及原文摘录'}</span><ChevronDown size={17} aria-hidden="true" /></summary><div className="mw-form-grid">
              <label className="mw-field mw-full"><span>资料名称</span><input value={draft.sourceTitle} disabled={!editing || busy} maxLength={1000} onChange={event => editDraft({ sourceTitle: event.target.value })} placeholder="留空时自动使用当前车型名称" /><small>{metadataHint('sourceTitle')}</small></label>
              <label className="mw-field"><span>版本／发布日期（选填）</span><input value={draft.edition} disabled={!editing || busy} maxLength={200} onChange={event => editDraft({ edition: event.target.value })} placeholder="原文未注明可留空" /></label>
              <label className="mw-field"><span>来源链接（选填）</span><input type="url" value={draft.sourceUrl} disabled={!editing || busy} maxLength={2500} aria-invalid={!validSourceLink(draft.sourceUrl)} onChange={event => editDraft({ sourceUrl: event.target.value })} /></label>
              <label className="mw-field mw-full"><span>原文车型适用范围（选填）</span><textarea value={draft.applicability} disabled={!editing || busy} rows={2} maxLength={3000} onChange={event => editDraft({ applicability: event.target.value })} placeholder="保留原文已写明的范围，未知可留空" /><small>{metadataHint('applicability')}</small></label>
            </div>{active.sourceExcerpt && <blockquote className="mw-source-quote">{active.sourceExcerpt}</blockquote>}</details></section>}
            {draft && !pending(active) && <section className="mw-candidate-section"><div className="mw-candidate-heading"><div><h3>{active.status === 'published' ? '已导入的保养项目' : '保养项目识别结果'}</h3><p className="mw-mapping-counts"><span>共 {draft.rows.length} 项</span><span>已关联 <strong>{mappedCount}</strong></span><span>待关联／处理 <strong>{mappingPendingCount}</strong></span>{mappingNewCount > 0 && <span>待新建 <strong>{mappingNewCount}</strong></span>}<span>本次选择 <strong>{includedCount}</strong></span></p></div>{editing && <div className="mw-candidate-actions"><button type="button" className="ad-button" disabled={busy || !draft.rows.length} onClick={() => void autoMapProjects()}><Sparkles size={16} aria-hidden="true" />重新自动关联标准项目</button><button type="button" className="ad-button" disabled={busy || draft.rows.length >= 60} onClick={() => { const row: ManualRuleDraft = { id: `row-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, name: '', projectId: null, createProject: false, include: true, action: 'inspect', triggerType: 'periodic', firstMonths: null, firstKm: null, intervalMonths: null, intervalKm: null, mileageType: 'total_km', condition: '', notes: '', sourceText: '', pageNumbers: [] }; editDraft({ rows: [...draft.rows, row] }); setExpanded(current => [...current, row.id]); }}><Plus size={16} aria-hidden="true" />补充遗漏项</button></div>}</div>
              {editing && <p className="mw-mapping-help">已有资料可直接重新关联，无需再次 AI 识别。关联标准项目后，再按原文核对本次选择。</p>}
              {catalogError && <p className="mw-source-error" role="status">{catalogError}</p>}
              {editing && <details className="ad-panel mw-bulk-tools"><summary>批量补充通用首次保养 <ChevronDown size={17} aria-hidden="true" /></summary><div className="mw-bulk-content"><div className="mw-bulk-heading"><div><h4>通用首次保养</h4><p>仅在原文明确共用首保阈值时使用。只填入已选、首次月数和公里数均为空的固定周期项目，已有值不变。</p></div></div><div className="mw-form-grid"><label className="mw-field"><span>通用首次保养（月）</span><input type="number" min={1} max={1200} step={1} value={commonFirstMonths} disabled={busy} placeholder="原文明确的月数" onChange={event => setCommonFirstMonths(event.target.value)} /></label><label className="mw-field"><span>通用首次保养（km）</span><input type="number" min={1} max={2000000} step={1} value={commonFirstKm} disabled={busy} placeholder="原文明确的公里数" onChange={event => setCommonFirstKm(event.target.value)} /></label></div><div className="mw-bulk-footer"><small>只补充原文明示的首次阈值；后续周期仍需逐项核对。</small><button type="button" className="ad-button" disabled={busy || (!commonFirstMonths.trim() && !commonFirstKm.trim())} onClick={fillCommonFirstService}>填入空白首次周期</button></div></div></details>}
              {draft.rows.length === 0 && <div className="ad-panel mw-no-rows"><BookOpen size={25} aria-hidden="true" /><h4>还没有可核对的保养项目</h4><p>请查看识别说明，确认所选页面包含保养表、图例和脚注。</p></div>}
              {draft.rows.map((row, index) => {
                const mapping = mappingInfo(row, mappingDiagnostics);
                return <article className={`mw-rule ${!row.include ? 'mw-rule-excluded' : ''} ${row.include && allIssues.some(issue => issue.rowId === row.id) ? 'mw-rule-needs-review' : ''}`} key={row.id}>
                  <div className="mw-rule-top"><label className="mw-row-include"><input type="checkbox" checked={row.include} disabled={!editing || busy} onChange={event => editRow(row.id, { include: event.target.checked })} /><span className="mw-sr-only">纳入第 {index + 1} 项规则：{row.name || '待填写项目名称'}</span></label>
                    <button type="button" className="mw-rule-toggle" aria-expanded={expanded.includes(row.id)} aria-controls={`mw-row-${row.id}`} onClick={() => setExpanded(current => current.includes(row.id) ? current.filter(id => id !== row.id) : [...current, row.id])}><span>
                      <small>项目 {index + 1} · {manualActionNames[row.action]} · {triggerNames[row.triggerType]}</small><strong>{row.name || '待填写项目名称'}</strong>
                      <em>{row.sourceText.trim() && row.pageNumbers.length ? `原文已提取 · ${row.pageNumbers.map(page => evidenceName(page)).join('、')}` : '原文依据待补充'}</em>
                      <span className={`mw-row-mapping mw-row-mapping-${mapping.status}`}><span>{mapping.title}</span><span>{mapping.detail}</span></span>
                      <span className="mw-row-selection" data-selected={row.include}><span>{active.status === 'published' ? row.include ? '已导入规则' : '原文留存，未导入' : row.include ? '本次已选择' : '本次未选择'}</span>{row.triggerType !== 'periodic' && <span>按原文条件适用，核对后可选择</span>}</span>
                      <span className="mw-row-cycles">{row.triggerType === 'periodic' ? <><span>{row.firstMonths == null && row.firstKm == null ? row.intervalMonths != null || row.intervalKm != null ? '首保未单列，按已注明周期起算' : '首保未单列，待核对保养周期' : `首次：${threshold(row.firstMonths, row.firstKm)}`}</span><span>后续：{threshold(row.intervalMonths, row.intervalKm)}</span></> : <><span>{row.condition || '按原文条件处理'}</span>{(row.firstMonths != null || row.firstKm != null) && <span>原文首次阈值：{threshold(row.firstMonths, row.firstKm)}（{usesIndependentConditionThreshold(row) ? '与原文条件先到提醒' : '限该条件'}）</span>}{(row.intervalMonths != null || row.intervalKm != null) && <span>原文阈值：{threshold(row.intervalMonths, row.intervalKm)}（{usesIndependentConditionThreshold(row) ? '与原文条件先到提醒' : '限该条件'}）</span>}</>}</span>
                    </span><ChevronDown size={19} aria-hidden="true" /></button>
                  </div>
                <div id={`mw-row-${row.id}`} className="mw-rule-fields" hidden={!expanded.includes(row.id)} aria-describedby={allIssues.some(issue => issue.rowId === row.id) ? `mw-row-problems-${row.id}` : undefined}>{allIssues.some(issue => issue.rowId === row.id) && <ul className="mw-row-problems" id={`mw-row-problems-${row.id}`}>{allIssues.filter(issue => issue.rowId === row.id).map((issue, i) => <li key={i}>{issue.message}</li>)}</ul>}<div className="mw-form-grid"><label className="mw-field mw-full"><span>保养项目名称</span><input data-field="name" aria-describedby={allIssues.some(issue => issue.rowId === row.id) ? `mw-row-problems-${row.id}` : undefined} aria-invalid={row.include && allIssues.some(issue => issue.rowId === row.id && issue.field === 'name')} value={row.name} disabled={!editing || busy} maxLength={160} onChange={event => editRow(row.id, { name: event.target.value })} /></label><label className="mw-field mw-full"><span>映射到标准服务项目</span><select data-field="projectId" aria-describedby={allIssues.some(issue => issue.rowId === row.id) ? `mw-row-problems-${row.id}` : undefined} aria-invalid={row.include && allIssues.some(issue => issue.rowId === row.id && issue.field === 'projectId')} value={row.createProject ? '__new__' : row.projectId || (row.catalogProjectId ? `catalog:${row.catalogProjectId}` : '')} disabled={!editing || busy} onChange={event => { const value = event.target.value; editRow(row.id, { projectId: !value || value === '__new__' || value.startsWith('catalog:') ? null : value, catalogProjectId: value.startsWith('catalog:') ? value.slice(8) : null, createProject: value === '__new__' }); }}><option value="">未关联，自动匹配失败时留空</option><optgroup label="系统已有项目">{data.projects.filter(project => project.active && project.category !== 'diagnosis').map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</optgroup><optgroup label="公开参考标准项目（发布时导入）">{catalogProjects.filter(project => project.category !== 'diagnosis').map(project => <option key={project.id} value={`catalog:${project.id}`}>{project.name}</option>)}{row.catalogProjectId && !catalogProjects.some(project => project.id === row.catalogProjectId) && <option value={`catalog:${row.catalogProjectId}`}>已关联参考项目（目录暂未读取）</option>}</optgroup><option value="__new__">明确新增一个标准项目</option></select><small>{row.createProject ? '发布时将按上方名称创建新项目。检查和更换要求不同时，请保留不同的项目含义。' : row.catalogProjectId ? '已关联公开参考项目，发布时导入或复用已有标准项目；请核对操作含义。' : '自动关联会保留已有人工选择，不确定时留空。名称或操作修改后需重新关联。'}</small></label><label className="mw-field"><span>要求的操作</span><select data-field="action" aria-invalid={row.include && allIssues.some(issue => issue.rowId === row.id && issue.field === 'action')} aria-describedby={allIssues.some(issue => issue.rowId === row.id) ? `mw-row-problems-${row.id}` : undefined} value={row.action} disabled={!editing || busy} onChange={event => editRow(row.id, { action: event.target.value as MaintenanceAction })}>{Object.entries(manualActionNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="mw-field"><span>触发方式</span><select data-field="triggerType" aria-invalid={row.include && allIssues.some(issue => issue.rowId === row.id && issue.field === 'triggerType')} aria-describedby={allIssues.some(issue => issue.rowId === row.id) ? `mw-row-problems-${row.id}` : undefined} value={row.triggerType} disabled={!editing || busy} onChange={event => { const triggerType = event.target.value as MaintenanceTrigger; editRow(row.id, { triggerType, ...(triggerType !== 'condition' ? { conditionThresholdsIndependent: false } : {}) }); }}>{Object.entries(triggerNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                  <fieldset className="mw-threshold-editor mw-full"><legend>{row.triggerType === 'periodic' ? '时间与里程周期' : '原文中的时间与里程阈值'}</legend><div className="mw-form-grid">{(['firstMonths', 'firstKm', 'intervalMonths', 'intervalKm'] as const).map(key => <label className="mw-field" key={key}><span>{{ firstMonths: '首次保养（月）', firstKm: '首次保养（km）', intervalMonths: '后续周期（月）', intervalKm: '后续周期（km）' }[key]}</span><input data-field={key} aria-describedby={allIssues.some(issue => issue.rowId === row.id) ? `mw-row-problems-${row.id}` : `mw-threshold-help-${row.id}`} aria-invalid={row.include && allIssues.some(issue => issue.rowId === row.id && (issue.field === key || issue.field === 'interval' && key.startsWith('interval')))} type="number" min={1} max={key.endsWith('Months') ? 1200 : 2000000} step={1} value={row[key] ?? ''} disabled={!editing || busy} placeholder="原文未说明则留空" onChange={event => editRow(row.id, { [key]: event.target.value === '' ? null : Number(event.target.value) })} /></label>)}</div><p id={`mw-threshold-help-${row.id}`} className="mw-inline-hint">可以只填月份、只填公里，或同时填写；留空表示原文未注明。{row.triggerType === 'periodic' ? '同时填写时以先到者为准。' : '这些数值保留原文要求；按条件或按需处理的适用限制仍然有效。'}</p>{row.triggerType === 'condition' && <label className="mw-check mw-independent-threshold"><input data-field="conditionThresholdsIndependent" type="checkbox" checked={usesIndependentConditionThreshold(row)} disabled={!editing || busy || !hasRecurringMaintenanceThreshold(row) && !usesIndependentConditionThreshold(row)} aria-invalid={row.include && allIssues.some(issue => issue.rowId === row.id && issue.field === 'conditionThresholdsIndependent')} aria-describedby={allIssues.some(issue => issue.rowId === row.id) ? `mw-row-problems-${row.id}` : `mw-independent-help-${row.id}`} onChange={event => editRow(row.id, { conditionThresholdsIndependent: event.target.checked })} /><span>时间／里程达到时也提醒（与原文条件先到为准）<small id={`mw-independent-help-${row.id}`}>{hasRecurringMaintenanceThreshold(row) ? '仅在原文明确允许时间／里程独立触发时启用，例如“出现机油警告或6个月”。仅严苛工况适用的阈值请保留为条件要求。' : '请先填写原文明确的后续月份或公里阈值，再启用此提醒。'}</small></span></label>}</fieldset>
                  <label className="mw-field mw-full"><span>里程口径</span><select value={row.mileageType} disabled={!editing || busy} onChange={event => editRow(row.id, { mileageType: event.target.value as ManualRuleDraft['mileageType'] })}><option value="total_km">车辆累计总里程</option><option value="engine_km">发动机累计里程</option></select></label><label className="mw-field mw-full"><span>{row.triggerType === 'periodic' ? '特殊适用条件（固定周期须留空）' : '触发条件／按需处理依据'}</span><textarea data-field="condition" aria-describedby={allIssues.some(issue => issue.rowId === row.id) ? `mw-row-problems-${row.id}` : undefined} aria-invalid={row.include && allIssues.some(issue => issue.rowId === row.id && issue.field === 'condition')} rows={2} value={row.condition} disabled={!editing || busy} maxLength={2000} onChange={event => editRow(row.id, { condition: event.target.value })} placeholder={row.triggerType === 'periodic' ? '特殊条件请改选“达到条件时”；普通说明请写入脚注' : '保留严苛工况、检测后更换等限制条件'} /></label><label className="mw-field mw-full"><span>脚注与补充说明</span><textarea rows={2} value={row.notes} disabled={!editing || busy} maxLength={4000} onChange={event => editRow(row.id, { notes: event.target.value })} /></label><label className="mw-field mw-full"><span>原文摘录</span><textarea data-field="sourceText" aria-describedby={allIssues.some(issue => issue.rowId === row.id) ? `mw-row-problems-${row.id}` : undefined} aria-invalid={row.include && allIssues.some(issue => issue.rowId === row.id && issue.field === 'sourceText')} rows={3} value={row.sourceText} disabled={!editing || busy} maxLength={6000} onChange={event => editRow(row.id, { sourceText: event.target.value })} /><small>请对照左侧原图核实文字、单位、图例和脚注。</small></label></div><fieldset data-field="pageNumbers" tabIndex={-1} aria-invalid={row.include && allIssues.some(issue => issue.rowId === row.id && issue.field === 'pageNumbers')} aria-describedby={allIssues.some(issue => issue.rowId === row.id) ? `mw-row-problems-${row.id}` : undefined} className="mw-evidence-pages"><legend>{textImport ? '关联原文证据' : imageImport ? '关联原文图片' : '关联原文页码'}</legend>{evidenceFiles.map(file => <label key={file.id}><input type="checkbox" checked={file.pageNumber != null && row.pageNumbers.includes(file.pageNumber)} disabled={!editing || busy || file.pageNumber == null} onChange={event => { if (file.pageNumber == null) return; const pages = new Set(row.pageNumbers); event.target.checked ? pages.add(file.pageNumber) : pages.delete(file.pageNumber); editRow(row.id, { pageNumbers: [...pages].sort((a, b) => a - b) }); setPageNumber(file.pageNumber); }} />{evidenceName(file.pageNumber)}</label>)}</fieldset>{editing && <button type="button" className="mw-remove-row" disabled={busy} onClick={() => editDraft({ rows: draft.rows.filter(item => item.id !== row.id) })}>移除本行</button>}</div>
              </article>; })}
            </section>}
            {editing && <form className="ad-panel mw-panel mw-publish" onSubmit={event => { event.preventDefault(); void publish(); }}><div className="mw-publish-title"><ShieldCheck size={23} aria-hidden="true" /><div><h3>确认并导入到当前车型</h3><p>只导入已选择的 {includedCount} 项，未选择的内容仍保留在资料中。修改会随本次提交一起保存。</p></div></div><p className="mw-publish-confirmation">点击“确认并导入”，表示你已对照原文核对保养要求，并确认这些项目适用于「{modelName(active.modelId)}」。</p><div className="mw-form-actions"><button type="button" className="ad-button ad-button-ghost" onClick={() => void saveDraft()} disabled={busy || !dirty}><Save size={17} aria-hidden="true" />稍后继续，保存草稿</button><button type="submit" className="ad-button ad-button-primary" disabled={busy || includedCount === 0}>{busy ? <LoaderCircle size={17} className="ad-spin" aria-hidden="true" /> : <CheckCircle2 size={17} aria-hidden="true" />}{busy ? '正在导入…' : `确认并导入 ${includedCount} 项规则`}</button></div></form>}

          </div>
        </div>
      </div>}
    </div>
  </div>;
}
