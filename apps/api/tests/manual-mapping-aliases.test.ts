import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ManualRuleDraft, Project } from '@autovoyage/shared';
import { autoMapManualProjects, manualProjectSubject } from '../src/manual-project-mapping.js';

const row = (name: string, action: ManualRuleDraft['action'] = 'replace'): ManualRuleDraft => ({
  id: 'synthetic-alias-row', name, action, include: true, projectId: null, catalogProjectId: null, createProject: false,
  triggerType: 'periodic', firstMonths: null, firstKm: null, intervalMonths: 12, intervalKm: 20000,
  mileageType: 'total_km', condition: '', notes: '仅用于合成回归，不用于实车', sourceText: '合成原文', pageNumbers: [1],
});

test('engine oil and filter compound service accepts explicit separators and either component order', () => {
  for (const name of ['机油、机油滤清器', '发动机机油，机油滤芯', '机油与机滤', '机油滤清器及发动机机油', '机油 + 机油滤芯', '机油／机油滤清器', '机油 & 机滤']) {
    assert.equal(manualProjectSubject(name), '机油与机滤', name);
    const mapped = autoMapManualProjects([row(name)], [])[0]!;
    assert.equal(mapped.catalogProjectId, 'ref-engine-oil-filter', name);
    assert.equal(mapped.createProject, false);
  }
  const existing: Project = { id: 'synthetic-existing-oil', code: 'SYNTHETIC_OIL', name: '更换发动机机油及机油滤清器', description: '更换发动机机油与机油滤清器', category: '发动机', unit: '次', active: true };
  assert.equal(autoMapManualProjects([row('机油、机油滤清器')], [existing])[0]?.projectId, existing.id);
  const duplicateAliases = autoMapManualProjects([row('机油、机油滤清器'), { ...row('机滤及机油'), id: 'second-oil-row' }], [existing]);
  assert(duplicateAliases.every(item => !item.projectId && !item.catalogProjectId), 'two aliases for one target stay unresolved together');
});

test('clear fluid and air-filter synonyms map while cabin air and engine air stay distinct', () => {
  for (const name of ['制动油', '刹车油', '刹车液']) {
    assert.equal(autoMapManualProjects([row(name)], [])[0]?.catalogProjectId, 'ref-brake-fluid-replace', name);
    assert.equal(autoMapManualProjects([row(name, 'inspect')], [])[0]?.catalogProjectId, null, 'inspection cannot select a replacement template');
  }
  for (const name of ['空气滤清器', '空气滤清器滤芯', '发动机空气滤清器', '发动机空气滤清器滤芯', '发动机空气滤芯'])
    assert.equal(autoMapManualProjects([row(name)], [])[0]?.catalogProjectId, 'ref-engine-air-filter', name);
  for (const name of ['空调滤清器', '空调滤清器滤芯', '空调空气滤清器', '空调空气滤清器滤芯', '座舱空气滤芯', '座舱滤清器', '驾驶室空气滤清器'])
    assert.equal(autoMapManualProjects([row(name)], [])[0]?.catalogProjectId, 'ref-cabin-filter', name);
});

test('independent oil services retain their own component and do not collapse into the compound service', () => {
  for (const name of ['机油', '发动机机油', '更换发动机机油']) {
    assert.equal(autoMapManualProjects([row(name)], [])[0]!.catalogProjectId, 'ref-engine-oil-only', name);
  }
  for (const name of ['机油滤清器', '发动机机油滤清器', '发动机机油滤芯', '更换发动机机油滤清器', '发动机机油滤清器滤芯']) {
    assert.equal(manualProjectSubject(name), '机滤', name);
    assert.equal(autoMapManualProjects([row(name)], [])[0]!.catalogProjectId, 'ref-engine-oil-filter-only', name);
  }
});

test('extra components and mixed actions never collapse into a single standard project', () => {
  for (const name of ['空气滤清器、空调滤清器', '空气滤清器滤芯及空调滤清器滤芯', '机油、机油滤清器、空气滤清器', '刹车油及变速器油', '机油及未知滤清器', '检查并更换机油、机油滤清器']) {
    const mapped = autoMapManualProjects([row(name)], [])[0]!;
    assert.equal(mapped.projectId, null, name);
    assert.equal(mapped.catalogProjectId, null, name);
    assert.equal(mapped.createProject, false, name);
  }
  assert.notEqual(manualProjectSubject('空气滤清器、空调滤清器'), manualProjectSubject('空气滤清器'));
  assert.notEqual(manualProjectSubject('空气滤清器、空调滤清器'), manualProjectSubject('空调滤清器'));
  assert.equal(autoMapManualProjects([row('检查制动油', 'replace')], [])[0]?.catalogProjectId, null);
  assert.equal(autoMapManualProjects([row('机油、机油滤清器', 'inspect')], [])[0]?.catalogProjectId, null);
});
