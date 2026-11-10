import { useState } from 'react';
import { Plus, Save, Trash2 } from 'lucide-react';
import type { Bootstrap, ManualImport, ManualRuleDraft } from '@autovoyage/shared';
import { post } from '../lib/api';

type Row = ManualRuleDraft;
const actions: Record<string, string> = { inspect: '检查', replace: '更换', clean: '清洁', lubricate: '润滑', other: '其他处理' };
const triggers: Record<string, string> = { periodic: '固定周期', condition: '按条件', as_needed: '按需处理' };
const number = (value: string) => (value.trim() ? Number(value) : null);
const newRow = (): Row => ({
  id: crypto.randomUUID(), name: '', projectId: null, catalogProjectId: null, createProject: false, include: true,
  action: 'replace', triggerType: 'periodic', firstMonths: null, firstKm: null, intervalMonths: null, intervalKm: null,
  mileageType: 'total_km', condition: '', notes: '', sourceText: '', pageNumbers: [],
});

/** Platform-side keyboard entry of a printed maintenance table; the draft enters the usual review and publish flow. */
export default function ManualTableEntry({ data, modelId, onCreated, onCancel }: {
  data: Bootstrap; modelId: string; onCreated: (job: ManualImport) => void; onCancel: () => void;
}) {
  const [rows, setRows] = useState<Row[]>([newRow()]);
  const [sourceTitle, setSourceTitle] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [edition, setEdition] = useState('');
  const [applicability, setApplicability] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const model = data.models.find(item => item.id === modelId);
  const edit = (id: string, changes: Partial<Row>) => setRows(current => current.map(row => row.id === id ? { ...row, ...changes } : row));
  function validate() {
    if (!model) return '请先选择车型。';
    if (!rows.length) return '请至少录入一条保养项目。';
    if (rows.some(row => !row.name.trim())) return '每条项目都要填写名称。';
    if (rows.some(row => row.triggerType === 'periodic' && row.firstMonths === null && row.firstKm === null && row.intervalMonths === null && row.intervalKm === null)) return '固定周期项目至少要写明首次或后续的月份或公里数。';
    if (rows.some(row => row.triggerType !== 'periodic' && !row.condition.trim())) return '按条件或按需处理的项目要写明手册中的触发条件。';
    if (rows.some(row => !row.sourceText.trim())) return '每条项目都要写明手册依据摘录，便于后续核对。';
    if (sourceUrl && !/^https:\/\//.test(sourceUrl)) return '来源链接须为 HTTPS 地址，也可以留空。';
    return '';
  }
  async function submit() {
    const problem = validate();
    if (problem) { setError(problem); return; }
    setBusy(true); setError('');
    try {
      onCreated(await post<ManualImport>('/admin/manual-imports/manual-entry', {
        modelId, consent: true, sourceTitle, sourceUrl, edition, applicability, sourceExcerpt: '', rows,
      }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存失败，请重试');
    } finally { setBusy(false); }
  }
  return <section className="ad-panel mw-panel mw-manual-table">
    <div className="mw-panel-title"><span className="mw-title-icon"><Save size={23} aria-hidden="true" /></span><div><h2>把手册保养表录入成规则</h2><p>按纸质或官方手册逐项录入。保存后同样进入核对与发布流程，未核对发布前不会影响任何车辆。</p></div></div>
    <div className="mw-form-grid">
      <label className="mw-field"><span>资料名称</span><input value={sourceTitle} maxLength={1000} placeholder={model ? `留空则记为「${model.brand} ${model.name} 保养表格（手工录入）」` : '留空则按车型自动命名'} onChange={event => setSourceTitle(event.target.value)} /></label>
      <label className="mw-field"><span>版本／发布日期（选填）</span><input value={edition} maxLength={500} onChange={event => setEdition(event.target.value)} /></label>
      <label className="mw-field"><span>来源链接（选填，HTTPS）</span><input type="url" value={sourceUrl} maxLength={2500} onChange={event => setSourceUrl(event.target.value)} /></label>
      <label className="mw-field"><span>适用年款／动力／市场</span><input value={applicability} maxLength={3000} onChange={event => setApplicability(event.target.value)} /></label>
    </div>
    <div className="mw-manual-rows">
      {rows.map((row, index) => <article className="mw-manual-row" key={row.id}>
        <div className="mw-manual-row-head"><strong>项目 {index + 1}</strong>
          <label className="mw-inline-check"><input type="checkbox" checked={row.include} onChange={event => edit(row.id, { include: event.target.checked })} /><span>本次导入</span></label>
          <button type="button" className="ad-link-button" disabled={rows.length === 1} onClick={() => setRows(current => current.filter(item => item.id !== row.id))}><Trash2 size={15} aria-hidden="true" />移除本项</button>
        </div>
        <div className="mw-form-grid">
          <label className="mw-field mw-full"><span>保养项目名称</span><input value={row.name} maxLength={160} placeholder="如：发动机机油及机油滤清器" onChange={event => edit(row.id, { name: event.target.value })} /></label>
          <label className="mw-field"><span>操作</span><select value={row.action} onChange={event => edit(row.id, { action: event.target.value as Row['action'] })}>{Object.entries(actions).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="mw-field"><span>周期类型</span><select value={row.triggerType} onChange={event => edit(row.id, { triggerType: event.target.value as Row['triggerType'] })}>{Object.entries(triggers).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="mw-field"><span>首次保养（月）</span><input type="number" min={1} max={1200} step={1} value={row.firstMonths ?? ''} onChange={event => edit(row.id, { firstMonths: number(event.target.value) })} /></label>
          <label className="mw-field"><span>首次保养（km）</span><input type="number" min={1} max={2000000} step={1} value={row.firstKm ?? ''} onChange={event => edit(row.id, { firstKm: number(event.target.value) })} /></label>
          <label className="mw-field"><span>后续周期（月）</span><input type="number" min={1} max={1200} step={1} value={row.intervalMonths ?? ''} onChange={event => edit(row.id, { intervalMonths: number(event.target.value) })} /></label>
          <label className="mw-field"><span>后续周期（km）</span><input type="number" min={1} max={2000000} step={1} value={row.intervalKm ?? ''} onChange={event => edit(row.id, { intervalKm: number(event.target.value) })} /></label>
          <label className="mw-field"><span>里程口径</span><select value={row.mileageType} onChange={event => edit(row.id, { mileageType: event.target.value as Row['mileageType'] })}><option value="total_km">车辆累计总里程</option><option value="engine_km">发动机累计里程</option></select></label>
          <label className="mw-field"><span>{row.triggerType === 'periodic' ? '特殊适用条件（固定周期请留空）' : '触发条件／按需依据'}</span><input value={row.condition} maxLength={3000} onChange={event => edit(row.id, { condition: event.target.value })} /></label>
          <label className="mw-field mw-full"><span>手册依据摘录</span><textarea rows={2} value={row.sourceText} maxLength={6000} placeholder="抄录该行对应的表头、节点与脚注，便于日后核对" onChange={event => edit(row.id, { sourceText: event.target.value })} /></label>
          <label className="mw-field mw-full"><span>备注（选填）</span><input value={row.notes} maxLength={4000} onChange={event => edit(row.id, { notes: event.target.value })} /></label>
        </div>
      </article>)}
    </div>
    {error && <p className="mw-field-error" role="alert">{error}</p>}
    <div className="mw-form-actions">
      <button type="button" className="ad-button" disabled={busy || rows.length >= 120} onClick={() => setRows(current => [...current, newRow()])}><Plus size={16} aria-hidden="true" />增加一项</button>
      <button type="button" className="ad-button ad-button-ghost" disabled={busy} onClick={onCancel}>取消</button>
      <button type="button" className="ad-button ad-button-primary" disabled={busy} onClick={() => void submit()}>{busy ? '正在保存…' : '保存为待核对草稿'}</button>
    </div>
  </section>;
}
