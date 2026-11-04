import { useEffect, useId, useRef, useState } from 'react';
import { AlertCircle, ArrowDown, CheckCircle2, History, RefreshCw, X } from 'lucide-react';
import type { SystemRelease, SystemReleasesResponse } from '@autovoyage/shared';
import { api } from '../lib/api';
import './system-update-log.css';

const releaseDate = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '时间待记录' : new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
};

export function SystemUpdateLogButton({ version }: { version: string }) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" className="sul-entry" onClick={() => setOpen(true)} aria-haspopup="dialog"><History size={15} aria-hidden="true" /><span>系统更新日志</span><small title={`版本 ${version}`}>v{version}</small></button>
    {open && <SystemUpdateLog version={version} onClose={() => setOpen(false)} />}
  </>;
}

function SystemUpdateLog({ version, onClose }: { version: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [items, setItems] = useState<SystemRelease[]>([]);
  const [response, setResponse] = useState<SystemReleasesResponse | null>(null);
  const [offset, setOffset] = useState(0);
  const [retry, setRetry] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const node = ref.current;
    node?.showModal();
    return () => { node?.close(); if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    void api<SystemReleasesResponse>(`/releases?offset=${offset}&limit=20`, { signal: controller.signal }).then(value => {
      if (controller.signal.aborted) return;
      setResponse(value);
      setItems(previous => offset === 0 ? value.items : [...previous, ...value.items.filter(item => !previous.some(existing => existing.id === item.id))]);
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '暂时无法加载更新日志。'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [offset, retry]);

  return <dialog ref={ref} className="sul-dialog" aria-labelledby={titleId} onCancel={event => { event.preventDefault(); onClose(); }}>
    <header className="sul-header"><div><span className="sul-eyebrow">AUTOVOYAGE UPDATES</span><h2 id={titleId}>系统更新日志</h2><p>了解云程每一次功能更新与体验改进。</p></div><button type="button" className="sul-close" onClick={onClose} aria-label="关闭系统更新日志" autoFocus><X size={21} /></button></header>
    <div className="sul-body" aria-busy={loading}>
      <div className="sul-current"><span><CheckCircle2 size={18} aria-hidden="true" />当前运行版本</span><strong>v{response?.currentVersion || version}</strong></div>
      {items.length > 0 && <ol className="sul-timeline">{items.map(item => <li key={item.id} className={item.id === response?.currentReleaseId ? 'sul-release sul-release-current' : 'sul-release'}><div className="sul-release-meta"><strong>v{item.version}</strong>{item.id === response?.currentReleaseId && <span className="sul-current-badge">当前版本</span>}</div><time dateTime={item.deployedAt}>首次上线 {releaseDate(item.deployedAt)}</time><h3>{item.title}</h3><ul>{item.changes.map((change, index) => <li key={`${item.id}-${index}`}>{change}</li>)}</ul></li>)}</ol>}
      {loading && <div className="sul-status" role="status"><RefreshCw size={18} className="sul-spin" aria-hidden="true" />正在加载更新记录…</div>}
      {error && <div className="sul-error" role="alert"><AlertCircle size={19} aria-hidden="true" /><div><p>{error}</p><button type="button" className="sul-action" onClick={() => setRetry(value => value + 1)}><RefreshCw size={15} />重新加载</button></div></div>}
      {!loading && !error && !items.length && <div className="sul-empty"><History size={32} aria-hidden="true" /><h3>暂无更新记录</h3><p>系统发布新版本后，更新记录会自动出现在这里。</p></div>}
      {!loading && !error && response && offset + response.items.length < response.total && <button type="button" className="sul-action sul-more" onClick={() => setOffset(offset + response.limit)}><ArrowDown size={16} />加载更早的更新</button>}
    </div>
    <footer className="sul-footer"><span>时间均为北京时间（UTC+8）</span><button type="button" className="sul-action" onClick={onClose}>关闭</button></footer>
  </dialog>;
}
