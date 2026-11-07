import { ensure } from './domain.js';
import { recognizeManual } from './manual-vision.js';

type VisionConfig = Parameters<typeof recognizeManual>[0];
type ImagePage = Parameters<typeof recognizeManual>[1][number];
type TextPage = NonNullable<Parameters<typeof recognizeManual>[3]>[number];
type Recognition = Awaited<ReturnType<typeof recognizeManual>>;
type ExtractionScope = { targetPageNumbers: number[] };
type EvidenceRecognizer = (config: VisionConfig, pages: ImagePage[], modelDescription: string, texts?: TextPage[], scope?: ExtractionScope) => Promise<Recognition>;

const unique = (values: string[]) => [...new Set(values.map(value => value.trim()).filter(Boolean))];
const batchLimit = (condition: unknown) => ensure(condition, 422, 'AI_BATCH_LIMIT', '分段识别结果超出完整导入范围，请使用保养表及脚注截图重新识别');

function rowKey(row: Recognition['rows'][number]): string {
  // Preserve differences in actions, conditions, thresholds and quoted notes.
  // Only object-key order and the ordering of identical evidence-page sets are
  // irrelevant; similar-looking rows must never be merged heuristically.
  const { pageNumbers, ...fields } = row;
  return JSON.stringify([Object.keys(fields).sort().map(key => [key, fields[key as keyof typeof fields]]), [...new Set(pageNumbers)].sort((a, b) => a - b)]);
}

/**
 * Bound each output to one target image while every call can still inspect the
 * entire selected chapter, its global legends/footnotes and directory evidence.
 * Exact PDF text can replace a non-target image; missing text retains the image.
 * Scope is a trusted system option, never an instruction embedded in a document
 * or the model description. No page, including the first two, is silently skipped.
 */
export async function recognizeManualEvidence(
  config: VisionConfig,
  pages: ImagePage[],
  modelDescription: string,
  texts: TextPage[] = [],
  recognize: EvidenceRecognizer = recognizeManual,
  alternatives: TextPage[] = [],
  onProgress?: (completed: number, total: number) => void,
): Promise<Recognition> {
  ensure(pages.length + texts.length > 0 && pages.length + texts.length <= 12, 400, 'MANUAL_PAGE_LIMIT', '每次识别1至12页保养资料');
  const available = new Set([...pages, ...texts].map(page => page.pageNumber));
  ensure(available.size === pages.length + texts.length, 400, 'AI_PAGE_INVALID', '手册证据页码不能重复');
  if (pages.length <= 5) return recognize(config, pages, modelDescription, texts);

  const imageNumbers = new Set(pages.map(page => page.pageNumber));
  ensure(alternatives.every(page => imageNumbers.has(page.pageNumber)) && new Set(alternatives.map(page => page.pageNumber)).size === alternatives.length, 400, 'AI_PAGE_INVALID', 'PDF 文字替代页必须唯一对应已提供的图片页码');
  ensure(alternatives.every(page => page.text.length <= 100000), 400, 'MANUAL_TEXT_LIMIT', 'PDF 原文过长，请改用保养表图片');
  const alternativeText = new Map(alternatives.filter(page => page.text.trim()).map(page => [page.pageNumber, page]));

  const targets = [...pages].sort((a, b) => a.pageNumber - b.pageNumber);
  const groups = targets.map(page => [page.pageNumber]);
  const results: Array<Recognition | undefined> = new Array(groups.length);
  onProgress?.(0, groups.length);
  const failures: Array<{ index: number; error: unknown }> = [];
  let cursor = 0, stopped = false;
  const worker = async () => {
    while (!stopped) {
      const index = cursor++;
      if (index >= groups.length) return;
      try {
        const target = new Set(groups[index]);
        const contextTexts = alternativeText.size ? [...texts] : texts;
        const contextImages = alternativeText.size ? pages.filter(page => {
          const alternative = alternativeText.get(page.pageNumber);
          if (target.has(page.pageNumber) || !alternative) return true;
          contextTexts.push(alternative);
          return false;
        }) : pages;
        const result = await recognize(config, contextImages, modelDescription, contextTexts, { targetPageNumbers: groups[index] });
        batchLimit(result.rows.length <= 60 && result.warnings.length <= 30);
        ensure(result.rows.every(row => row.pageNumbers.length && row.pageNumbers.every(number => available.has(number))), 422, 'AI_PAGE_INVALID', '分段识别结果引用了未提供的原文页码');
        const rows = result.rows.filter(row => row.pageNumbers.some(number => target.has(number)));
        const warnings = rows.length === result.rows.length ? result.warnings : [...result.warnings, '分段识别已排除未引用本段目标页的额外项目；完整原文仍供各段核对图例与脚注。'];
        results[index] = { ...result, rows, warnings };
        onProgress?.(results.filter(Boolean).length, groups.length);
      } catch (error) { stopped = true; failures.push({ index, error }); }
    }
  };
  // Wait for both workers even on failure, so a failed query leaves no orphaned
  // requests. A partial chapter is never returned as a complete maintenance table.
  await Promise.all([worker(), worker()]);
  if (failures.length) throw failures.sort((a, b) => a.index - b.index)[0].error;
  const completed = results as Recognition[];
  batchLimit(completed.every(Boolean));

  const seen = new Set<string>();
  const rows = completed.flatMap(result => result.rows).filter(row => { const key = rowKey(row); if (seen.has(key)) return false; seen.add(key); return true; });
  const titles = unique(completed.map(result => result.sourceTitle));
  const editions = unique(completed.map(result => result.edition));
  const scopes = unique(completed.map(result => result.applicability));
  const warnings = unique(completed.flatMap(result => result.warnings));
  if (titles.length > 1) warnings.push('分段识别的资料标题表述不一致，已保留首个可见标题，请对照原文核对。');
  if (editions.length > 1) warnings.push('无法确定各段手册版本是否一致，版本暂留空，请对照原文核对。');
  if (scopes.length > 1) warnings.push('无法确定各段适用范围表述是否完全一致，已分别保留，请对照原文核对。');
  const merged = {
    rows, warnings,
    sourceTitle: titles[0] || '', edition: editions.length === 1 ? editions[0] : '',
    applicability: scopes.join('\n'), sourceExcerpt: unique(completed.map(result => result.sourceExcerpt)).join('\n\n'),
  };
  // Each bounded call may provide thirty distinct warnings plus one scope-filter
  // notice; the merge can add three metadata notices. Preserve all of them.
  batchLimit(merged.rows.length <= 120 && merged.warnings.length <= groups.length * 31 + 3 && merged.warnings.every(warning => warning.length <= 2000) && merged.sourceTitle.length <= 1000 && merged.edition.length <= 500 && merged.applicability.length <= 3000 && merged.sourceExcerpt.length <= 16000);
  return merged;
}
