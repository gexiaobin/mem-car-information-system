import { useEffect, useState } from 'react';
import { ExternalLink, FileText, LoaderCircle } from 'lucide-react';
import type { ManualDocument } from '@autovoyage/shared';
import { api } from '../lib/api';
import { ErrorBox, Modal } from './UI';
import './PublishedManual.css';

export default function PublishedManual({ id, onClose }: { id: string; onClose: () => void }) {
  const [document, setDocument] = useState<ManualDocument | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [page, setPage] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false; setDocument(null); setError('');
    api<ManualDocument>(`/manuals/${id}`).then(value => {
      if (!cancelled) { setDocument(value); setPage(value.files.find(file => file.mimeType.startsWith('image/'))?.pageNumber ?? null); }
    }).catch(reason => { if (!cancelled) setError(reason instanceof Error ? reason.message : '手册读取失败，请稍后重试'); });
    return () => { cancelled = true; };
  }, [id, attempt]);
  const images = document?.files.filter(file => file.mimeType.startsWith('image/')) || [];
  const image = images.find(file => file.pageNumber === page) || images[0];
  return <Modal title={document?.sourceTitle || '车型保养手册'} subtitle="已由平台审核发布的手册原文" onClose={onClose} wide>
    <div className="published-manual">
      {error ? <><ErrorBox message={error} /><button type="button" className="btn btn-secondary" onClick={() => setAttempt(value => value + 1)}>重新读取</button></> : !document ? <p className="published-manual-loading" role="status"><LoaderCircle size={19} aria-hidden="true" />正在读取手册…</p> : <>
        <div className="published-manual-meta"><p><strong>版本：</strong>{document.edition}</p><p><strong>适用范围：</strong>{document.applicability}</p>{document.sourceUrl && <a href={document.sourceUrl} target="_blank" rel="noreferrer">查看原始来源<ExternalLink size={14} aria-hidden="true" /></a>}</div>
        <div className="published-manual-pages" aria-label="选择手册原文页">{images.map(file => <button type="button" key={file.id} aria-pressed={image?.id === file.id} onClick={() => setPage(file.pageNumber)}>第 {file.pageNumber ?? '?'} 页</button>)}</div>
        {image && <><a className="published-manual-enlarge" href={image.url} target="_blank" rel="noreferrer">放大查看第 {image.pageNumber} 页<ExternalLink size={14} aria-hidden="true" /></a><img src={image.url} alt={`已审核保养手册原文，第 ${image.pageNumber ?? '?'} 页`} /></>}
        <div className="published-manual-files">{document.files.filter(file => file.original).map(file => <a key={file.id} href={file.url} target="_blank" rel="noreferrer"><FileText size={16} aria-hidden="true" /><span>{file.name}</span><ExternalLink size={14} aria-hidden="true" /></a>)}</div>
      </>}
    </div>
  </Modal>;
}
