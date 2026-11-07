import type { MaintenanceItem } from '@autovoyage/shared';

export function maintenanceCountdown(dueAt: string, date = new Date()): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  const days = Math.round((Date.parse(`${dueAt}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
  if (!Number.isFinite(days)) return '';
  return days < 0 ? `已逾期 ${-days} 天` : days === 0 ? '今天到期' : `还有 ${days} 天`;
}

export function compareMaintenance(a: MaintenanceItem, b: MaintenanceItem): number {
  const priority = { due: 0, soon: 1, missing: 2, ok: 3, conditional: 4 };
  return priority[a.status] - priority[b.status] || (a.dueAt || '9999-12-31').localeCompare(b.dueAt || '9999-12-31') || a.name.localeCompare(b.name, 'zh-CN');
}
