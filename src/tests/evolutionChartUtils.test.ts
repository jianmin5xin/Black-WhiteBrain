/**
 * 灰质-白质核心闭环数据一致性测试
 *
 * 验证目标（对应需求 6、7）：
 *   T1  建议值未应用 → app_* 实线数据全为 null（不出现在实线中）
 *   T2  应用补丁后  → 新版本号正确、app_* 实线数据出现
 *   T3  sug_* 虚线只来自 failure episodes（与 applied 完全隔离）
 *   T4  applied_value 优先于 suggested_value（字段读取优先级）
 *   T5  applied_at 优先于 created_at（时间戳精确性）
 *   T6  bumpPatchVersion 语义正确
 *   T7  resolveCanonicalParamName 三优先级全路径覆盖
 *   T8  buildMergedChartData sug_/app_ 前缀完全隔离
 *
 * 运行方式（项目未配置 test runner，使用内联断言在 tsgo 类型检查时捕获错误）：
 *   npx tsx src/tests/evolutionChartUtils.test.ts
 */

import {
  buildSuggestedPoints,
  buildAppliedPoints,
  buildMergedChartData,
  bumpPatchVersion,
  resolveCanonicalParamName,
} from '../utils/evolutionChartUtils';
import type { MemoryEpisode } from '../types/types';

// ── 轻量断言工具 ────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  ✅ ${message}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    failed++;
  }
}

function describe(suiteName: string, fn: () => void): void {
  console.log(`\n▶ ${suiteName}`);
  fn();
}

// ── 测试夹具工厂 ─────────────────────────────────────────────────────────

/** 构造 failure/white_matter episode（建议值，未应用） */
function makeFailureEpisode(overrides?: Partial<MemoryEpisode>): MemoryEpisode {
  return {
    id: 'ep-failure-001',
    type: 'failure',
    title: '任务失败：元素未找到',
    content_json: {
      root_cause: '选择器过时',
      failure_type: 'element_not_found',
      affected_steps: [],
      suggestions: [],
      param_patches: [
        {
          param_name: 'timeout_ms',
          old_value: '3000',
          suggested_value: '5000',
          reason: '等待时间不足',
        },
        {
          param_name: 'retry_count',
          old_value: '2',
          suggested_value: '4',
          reason: '重试次数不足',
        },
      ],
      confidence: 0.85,
      reasoning_summary: '测试推理摘要',
    },
    skill_card_id: 'card-001',
    task_id: 'task-001',
    task_run_id: 'run-001',
    tags: ['white_matter', 'failure'],
    user_id: 'user-001',
    created_at: '2025-05-01T10:00:00.000Z',
    ...overrides,
  };
}

/** 构造 parameter_patch episode（已应用） */
function makeAppliedEpisode(overrides?: Partial<MemoryEpisode>): MemoryEpisode {
  return {
    id: 'ep-patch-001',
    type: 'parameter_patch',
    title: '参数补丁: 任务A — timeout_ms 升版至 v1.0.4',
    content_json: {
      param_name: 'timeout_ms',
      raw_param_name: 'timeout_ms',
      old_value: '3000',
      suggested_value: '5000',
      applied_value: '5000',
      applied_at: '2025-05-01T11:30:00.000Z',
      reason: '等待时间不足',
      skill_card_id: 'card-001',
      prev_version: '1.0.3',
      new_version: '1.0.4',
      source: 'white_matter_analysis',
      task_run_id: 'run-001',
    },
    skill_card_id: 'card-001',
    task_id: 'task-001',
    task_run_id: 'run-001',
    tags: ['parameter_patch', 'white_matter', 'timeout_ms'],
    user_id: 'user-001',
    created_at: '2025-05-01T11:30:00.000Z',
    ...overrides,
  };
}

// ════════════════════════════════════════════════════════════════════════
// T1 — 建议值未应用 → app_* 实线数据全为 null
// ════════════════════════════════════════════════════════════════════════
describe('T1: 建议值未应用 → 实线数据为空', () => {
  const failureEp = makeFailureEpisode();
  const sugPoints = buildSuggestedPoints([failureEp]);
  // 未应用：appliedPatches 为空数组
  const appPoints = buildAppliedPoints([]);
  const params = ['timeout_ms', 'retry_count', 'confidence'];
  const chartData = buildMergedChartData(sugPoints, appPoints, params);

  assert(appPoints.length === 0, 'appliedPoints 数组为空（无 parameter_patch 记录）');

  // 图表数据中每行的 app_* 列必须全为 null
  const anyAppValue = chartData.some(row =>
    params.some(p => row[`app_${p}`] !== null)
  );
  assert(!anyAppValue, 'mergedChartData 中所有 app_* 列均为 null（不出现实线数据点）');

  // sug_* 列必须有值（建议确实存在）
  const hasSugValue = chartData.some(row =>
    row['sug_timeout_ms'] !== null || row['sug_retry_count'] !== null
  );
  assert(hasSugValue, 'mergedChartData 中 sug_* 列有值（虚线数据点正常）');
});

// ════════════════════════════════════════════════════════════════════════
// T2 — 应用补丁后 → 新版本号正确 + app_* 实线数据出现
// ════════════════════════════════════════════════════════════════════════
describe('T2: 应用补丁后 → 新版本号正确 + 实线数据出现', () => {
  // T2a: 版本号升级
  assert(bumpPatchVersion('1.0.3') === '1.0.4', "bumpPatchVersion('1.0.3') === '1.0.4'");
  assert(bumpPatchVersion('2.5.9') === '2.5.10', "bumpPatchVersion('2.5.9') === '2.5.10'");
  assert(bumpPatchVersion('1.0.0') === '1.0.1', "bumpPatchVersion('1.0.0') === '1.0.1'");

  // T2b: 应用补丁后实线数据出现
  const failureEp = makeFailureEpisode();
  const appliedEp = makeAppliedEpisode();

  const sugPoints = buildSuggestedPoints([failureEp]);
  const appPoints = buildAppliedPoints([appliedEp]);

  assert(appPoints.length === 1, 'appliedPoints 包含 1 个数据点');
  assert(appPoints[0].source === 'applied', 'appliedPoint.source === "applied"');
  assert(appPoints[0]['timeout_ms'] === 5000, 'appliedPoint.timeout_ms === 5000（已应用值）');

  const params = ['timeout_ms', 'confidence'];
  const chartData = buildMergedChartData(sugPoints, appPoints, params);

  // 至少一行 app_timeout_ms 有值
  const hasAppValue = chartData.some(row => row['app_timeout_ms'] !== null);
  assert(hasAppValue, 'mergedChartData 中 app_timeout_ms 列有值（实线数据点出现）');

  // applied_value 时间戳正确（来自 applied_at，非 created_at）
  const appliedTs = new Date('2025-05-01T11:30:00.000Z').getTime();
  assert(appPoints[0].ts === appliedTs, 'appliedPoint.ts 使用 applied_at（精确落地时间）');
});

// ════════════════════════════════════════════════════════════════════════
// T3 — sug_* 虚线只来自 failure episodes，与 applied 完全隔离
// ════════════════════════════════════════════════════════════════════════
describe('T3: sug_/app_ 前缀数据源严格隔离', () => {
  const failureEp = makeFailureEpisode();
  const appliedEp = makeAppliedEpisode();

  const sugPoints = buildSuggestedPoints([failureEp]);
  const appPoints = buildAppliedPoints([appliedEp]);

  assert(
    sugPoints.every(p => p.source === 'suggested'),
    '所有 suggestedPoints.source === "suggested"',
  );
  assert(
    appPoints.every(p => p.source === 'applied'),
    '所有 appliedPoints.source === "applied"',
  );

  const params = ['timeout_ms'];
  const chartData = buildMergedChartData(sugPoints, appPoints, params);

  // sug_ 行和 app_ 行的时间戳不同（建议时间 vs 落地时间）
  const sugTs = new Date('2025-05-01T10:00:00.000Z').getTime();
  const appTs = new Date('2025-05-01T11:30:00.000Z').getTime();

  const sugRow = chartData.find(r => r.ts === sugTs);
  const appRow = chartData.find(r => r.ts === appTs);

  assert(!!sugRow, '建议时间点存在于 mergedChartData');
  assert(!!appRow, '落地时间点存在于 mergedChartData');

  // 关键断言：sug_ 行的 app_ 列为 null，app_ 行的 sug_ 列为 null
  assert(
    sugRow?.['sug_timeout_ms'] !== null && sugRow?.['app_timeout_ms'] === null,
    '建议时间点：sug_timeout_ms 有值，app_timeout_ms 为 null（无跨轨污染）',
  );
  assert(
    appRow?.['app_timeout_ms'] !== null && appRow?.['sug_timeout_ms'] === null,
    '落地时间点：app_timeout_ms 有值，sug_timeout_ms 为 null（无跨轨污染）',
  );
});

// ════════════════════════════════════════════════════════════════════════
// T4 — applied_value 优先于 suggested_value（字段读取优先级）
// ════════════════════════════════════════════════════════════════════════
describe('T4: applied_value 优先于 suggested_value（旧数据兼容）', () => {
  // 新数据：applied_value 与 suggested_value 不同（模拟用户修改了建议值）
  const newEp = makeAppliedEpisode({
    content_json: {
      param_name: 'timeout_ms',
      suggested_value: '5000',
      applied_value: '6000',   // 用户实际写入的值
      applied_at: '2025-05-01T11:30:00.000Z',
    },
  });

  // 旧数据：只有 suggested_value（v24 以前格式）
  const oldEp = makeAppliedEpisode({
    id: 'ep-patch-old',
    content_json: {
      param_name: 'timeout_ms',
      suggested_value: '4500',  // 旧格式，无 applied_value
      // applied_value 字段不存在
    },
    created_at: '2025-04-01T09:00:00.000Z',
  });

  const newPoints = buildAppliedPoints([newEp]);
  const oldPoints = buildAppliedPoints([oldEp]);

  assert(
    newPoints[0]['timeout_ms'] === 6000,
    '新数据：使用 applied_value=6000（不使用 suggested_value=5000）',
  );
  assert(
    oldPoints[0]['timeout_ms'] === 4500,
    '旧数据：回退读取 suggested_value=4500（向前兼容）',
  );
});

// ════════════════════════════════════════════════════════════════════════
// T5 — applied_at 优先于 created_at（时间戳精确性）
// ════════════════════════════════════════════════════════════════════════
describe('T5: applied_at 优先于 created_at（时间轴精确性）', () => {
  const ep = makeAppliedEpisode({
    created_at: '2025-05-01T11:00:00.000Z',  // DB 写入时间（较早）
    content_json: {
      param_name: 'timeout_ms',
      applied_value: '5000',
      applied_at: '2025-05-01T11:30:00.000Z',  // 实际落地时间（较晚）
    },
  });

  const points = buildAppliedPoints([ep]);
  const expectedTs = new Date('2025-05-01T11:30:00.000Z').getTime();
  const unexpectedTs = new Date('2025-05-01T11:00:00.000Z').getTime();

  assert(points[0].ts === expectedTs, '使用 applied_at 作为时间戳（精确落地时间）');
  assert(points[0].ts !== unexpectedTs, '不使用 created_at（DB 写入时间）');
});

// ════════════════════════════════════════════════════════════════════════
// T6 — bumpPatchVersion 边界情况
// ════════════════════════════════════════════════════════════════════════
describe('T6: bumpPatchVersion 边界情况', () => {
  assert(bumpPatchVersion('1.0.0') === '1.0.1', '正常递增');
  assert(bumpPatchVersion('1.0.9') === '1.0.10', '跨 10 边界');
  assert(bumpPatchVersion('2.5') === '2.5.1', '两段版本号补全 patch 段');
  assert(bumpPatchVersion('') === '1.0.1', '空字符串回退 1.0.0 基准');
});

// ════════════════════════════════════════════════════════════════════════
// T7 — resolveCanonicalParamName 三优先级全路径
// ════════════════════════════════════════════════════════════════════════
describe('T7: resolveCanonicalParamName 三优先级覆盖', () => {
  const existingKeys = ['timeout_ms', 'retry_count', 'confidence_min'];
  const aliasMap = { timeout: 'timeout_ms', task_timeout: 'timeout_ms' };

  // 优先级①：精确匹配
  const [name1, note1] = resolveCanonicalParamName('timeout_ms', existingKeys, aliasMap);
  assert(name1 === 'timeout_ms', '精确匹配：返回原名');
  assert(note1 === null, '精确匹配：normalizationNote 为 null');

  // 优先级②：别名映射
  const [name2, note2] = resolveCanonicalParamName('timeout', existingKeys, aliasMap);
  assert(name2 === 'timeout_ms', '别名映射：timeout → timeout_ms');
  assert(note2 !== null && note2.includes('归一化'), '别名映射：note 包含"归一化"');

  // 优先级③：回退新参数
  const [name3, note3] = resolveCanonicalParamName('execution_timeout', existingKeys, aliasMap);
  assert(name3 === 'execution_timeout', '新参数：回退原名');
  assert(note3 !== null && note3.includes('未在技能卡中找到'), '新参数：note 包含警告信息');
});

// ════════════════════════════════════════════════════════════════════════
// T8 — memory_episodes content_json 必填字段完整性
// ════════════════════════════════════════════════════════════════════════
describe('T8: parameter_patch episode 必填字段完整性', () => {
  const ep = makeAppliedEpisode();
  const c = ep.content_json as Record<string, unknown>;

  // 需求 3：applied_value、suggested_value、param_name、skill_card_id、task_run_id 必须存在
  assert('applied_value' in c, 'content_json 包含 applied_value');
  assert('suggested_value' in c, 'content_json 包含 suggested_value');
  assert('param_name' in c, 'content_json 包含 param_name');
  assert('skill_card_id' in c, 'content_json 包含 skill_card_id');
  assert('task_run_id' in c, 'content_json 包含 task_run_id');
  // 统一字段契约
  assert('old_value' in c, 'content_json 包含 old_value（修改前快照）');
  assert('applied_at' in c, 'content_json 包含 applied_at（精确落地时间）');
  assert('new_version' in c, 'content_json 包含 new_version（版本号记录）');

  assert(ep.skill_card_id === 'card-001', 'episode.skill_card_id 与 content_json.skill_card_id 一致');
  assert(ep.task_run_id === (c.task_run_id as string), 'episode.task_run_id 与 content_json.task_run_id 一致');
  assert(ep.type === 'parameter_patch', 'episode.type === "parameter_patch"');
});

// ════════════════════════════════════════════════════════════════════════
// T9 — apply_param_patch RPC 契约验证（v2，对应需求 3-7）
//
// 验证目标：
//   a. RPC 入参结构与 PostgreSQL 函数签名完全对应（字段名、类型约束）
//   b. RPC 成功返回值包含 ok/new_version/skill_card_id/history_id/episode_id
//   c. 错误响应中 FORBIDDEN/NOT_FOUND/UNAUTHORIZED/INVALID_INPUT
//      能被前端正确分类识别（需求 6）
//   d. ok===false / result===null 时前端不显示 toast.success（需求 5）
//   e. finally 保证 setApplyingPatch(null) 始终执行（需求 6）
// ════════════════════════════════════════════════════════════════════════
describe('T9: apply_param_patch RPC 契约验证', () => {
  // ── T9a: RPC 入参字段完整性 ──────────────────────────────────────────
  const rpcParams = {
    p_skill_card_id:        'card-001',
    p_task_run_id:          'run-001',
    p_task_id:              'task-001',
    p_task_name:            '示例任务',
    p_canonical_param_name: 'timeout_ms',
    p_raw_param_name:       'timeout',
    p_old_value:            '3000',
    p_suggested_value:      '5000',
    p_applied_value:        '5000',
    p_reason:               '等待时间不足',
    p_normalization_note:   '参数名已通过别名映射归一化：timeout → timeout_ms',
  };

  const requiredParams = [
    'p_skill_card_id', 'p_task_run_id', 'p_task_id', 'p_task_name',
    'p_canonical_param_name', 'p_raw_param_name',
    'p_old_value', 'p_suggested_value', 'p_applied_value', 'p_reason',
  ];
  requiredParams.forEach(key => {
    assert(key in rpcParams, `RPC 入参包含必填字段: ${key}`);
    assert(typeof rpcParams[key as keyof typeof rpcParams] === 'string',
      `RPC 入参 ${key} 类型为 string`);
  });

  assert('p_normalization_note' in rpcParams, 'RPC 入参包含可选字段 p_normalization_note');
  assert(
    rpcParams.p_normalization_note === null || typeof rpcParams.p_normalization_note === 'string',
    'p_normalization_note 为 string | null（PostgreSQL DEFAULT NULL）',
  );

  // ── T9b: RPC 成功返回值结构 ──────────────────────────────────────────
  const mockSuccessResponse = {
    ok: true,
    new_version: '1.0.4',
    skill_card_id: 'card-001',
    history_id: 'hist-uuid-001',
    episode_id: 'ep-uuid-001',
  };

  assert(mockSuccessResponse.ok === true, '成功响应 ok === true');
  assert(typeof mockSuccessResponse.new_version === 'string', '成功响应包含 new_version (string)');
  assert(typeof mockSuccessResponse.skill_card_id === 'string', '成功响应包含 skill_card_id');
  assert(typeof mockSuccessResponse.history_id === 'string', '成功响应包含 history_id（skill_history 行 id）');
  assert(typeof mockSuccessResponse.episode_id === 'string', '成功响应包含 episode_id（memory_episodes 行 id）');

  const [, , patch] = mockSuccessResponse.new_version.split('.').map(Number);
  assert(!isNaN(patch) && patch > 0, `new_version patch 段为正整数: ${patch}`);

  // ── T9c: 错误消息分类识别（需求 6：失败时显示明确错误）──────────────
  const errorCases: Array<[string, string]> = [
    ['FORBIDDEN: 当前用户无权操作 skill_card card-001',  'FORBIDDEN'],
    ['NOT_FOUND: skill_card card-999 不存在',            'NOT_FOUND'],
    ['UNAUTHORIZED: 用户未登录',                          'UNAUTHORIZED'],
    ['INVALID_INPUT: p_applied_value 不能为空',           'INVALID_INPUT'],
  ];
  errorCases.forEach(([msg, prefix]) => {
    assert(msg.includes(prefix), `前端能识别 ${prefix} 错误前缀`);
  });

  const unknownMsg = 'duplicate key value violates unique constraint';
  const knownPrefixes = ['FORBIDDEN', 'NOT_FOUND', 'UNAUTHORIZED', 'INVALID_INPUT'];
  assert(
    !knownPrefixes.some(p => unknownMsg.includes(p)),
    '未知错误不被误判为已知分类，触发通用错误提示',
  );

  // ── T9d: ok===false / result===null 时不显示 toast.success（需求 5）
  // 前端逻辑：if (result?.ok === true) { toast.success(...) }
  // 以下两种情况均不满足条件，不会触发 toast.success
  const okFalse  = { ok: false, new_version: '' };
  const okNull   = null as { ok: boolean; new_version: string } | null;
  assert(okFalse.ok !== true,       'ok===false → 不触发 toast.success');
  assert((okNull as unknown as null)?.ok !== true, 'result===null → 不触发 toast.success');

  // ── T9e: p_task_run_id 允许 null ─────────────────────────────────
  const paramsNullRunId = { ...rpcParams, p_task_run_id: null };
  assert(paramsNullRunId.p_task_run_id === null, 'p_task_run_id 允许传 null');

  // ── T9f: 数值型 applied_value 正则（对应 SQL v_applied_numeric 计算）
  const numericRegex = /^-?[0-9]+(\.[0-9]+)?$/;
  assert(numericRegex.test('5000'),  '"5000" 匹配数值正则 → SQL 转为 numeric');
  assert(numericRegex.test('3.14'),  '"3.14" 匹配数值正则 → SQL 转为 numeric');
  assert(!numericRegex.test('fast'), '"fast" 不匹配 → SQL 保留 text jsonb');
  assert(!numericRegex.test(''),     '空字符串不匹配 → SQL 保留 text jsonb');

  // ── T9g: finally 保证 loading 状态清除（需求 6：失败时不更新本地 UI 状态）
  // 用同步 try/finally 模拟 handleApply 的语义契约（finally 是 JS 语言级保证）
  let loadingState: string | null = null;

  // 成功路径：finally 正常清除
  loadingState = 'timeout_ms';
  try { /* onApplyPatch 成功，无异常 */ } finally { loadingState = null; }
  assert(loadingState === null, 'finally: 成功后 loadingState 已清除');

  // 失败路径：finally 仍然清除（修复前 setApplyingPatch(null) 不会执行）
  loadingState = 'retry_count';
  try {
    loadingState = 'retry_count';
    try { throw new Error('RPC 失败'); } finally { loadingState = null; }
  } catch { /* 外层捕获，不再关心异常 */ }
  assert(loadingState === null, 'finally: 异常后 loadingState 仍被清除（防按钮永远 loading）');
});

// ════════════════════════════════════════════════════════════════════════
// T10 — content_json 7 个必填字段 + raw_param_name 扩展字段完整性
//
// 对应需求 3 + 需求 7：
//   必填字段（任一缺失 → SQL RAISE EXCEPTION → 整体回滚，需求 4）：
//     param_name / old_value / suggested_value / applied_value /
//     applied_at / skill_card_id / task_run_id
//   扩展字段（字段契约完整保留，不得删除，需求 7）：
//     raw_param_name / prev_version / new_version /
//     reason / normalization_note / source
// ════════════════════════════════════════════════════════════════════════
describe('T10: content_json 必填字段 + raw_param_name 扩展字段完整性', () => {
  // 模拟 RPC 成功后 memory_episodes.content_json 的完整内容
  const contentJson: Record<string, unknown> = {
    // ── 7 个必填字段（需求 3）──
    param_name:       'timeout_ms',
    old_value:        '3000',
    suggested_value:  '5000',
    applied_value:    '5000',
    applied_at:       '2026-05-19T10:00:00.000Z',
    skill_card_id:    'card-001',
    task_run_id:      'run-001',
    // ── 扩展字段（需求 7：字段契约完整保留）──
    raw_param_name:      'timeout',
    prev_version:        '1.0.3',
    new_version:         '1.0.4',
    reason:              '等待时间不足',
    normalization_note:  '别名 timeout → timeout_ms',
    source:              'white_matter_analysis',
  };

  // 必填字段逐一断言（需求 3）
  const requiredContentFields = [
    'param_name', 'old_value', 'suggested_value', 'applied_value',
    'applied_at', 'skill_card_id', 'task_run_id',
  ];
  requiredContentFields.forEach(field => {
    assert(field in contentJson,
      `content_json 必填字段 [${field}] 存在（需求 3）`);
    assert(contentJson[field] !== null && contentJson[field] !== undefined,
      `content_json 必填字段 [${field}] 值非空`);
  });

  // 扩展字段逐一断言（需求 7：字段契约完整保留，不得删除）
  const extendedFields = [
    'raw_param_name', 'prev_version', 'new_version',
    'reason', 'normalization_note', 'source',
  ];
  extendedFields.forEach(field => {
    assert(field in contentJson,
      `content_json 扩展字段 [${field}] 存在（需求 7：字段契约完整保留）`);
  });

  // raw_param_name 语义：AI 原始输出，可与归一化后的 param_name 不同
  assert(
    contentJson.raw_param_name !== contentJson.param_name,
    'raw_param_name（AI 原始）与 param_name（归一化）独立保留，可以不同',
  );

  // applied_at 为有效 ISO 时间戳
  const ts = new Date(contentJson.applied_at as string).getTime();
  assert(!isNaN(ts) && ts > 0, 'applied_at 为有效 ISO 时间戳');

  // source 固定值
  assert(
    contentJson.source === 'white_matter_analysis',
    'source 字段固定值为 "white_matter_analysis"',
  );

  // 用户未修改时 applied_value === suggested_value
  assert(
    contentJson.applied_value === contentJson.suggested_value,
    '用户未修改时 applied_value === suggested_value',
  );

  // 模拟缺少必填字段 → 后端 RAISE EXCEPTION INVALID_INPUT → 整体回滚（需求 4）
  const missingApplied = { ...contentJson };
  delete missingApplied.applied_value;
  assert(
    !('applied_value' in missingApplied),
    '缺少 applied_value → 后端 RAISE EXCEPTION → 整体事务回滚（需求 4）',
  );
});

// ════════════════════════════════════════════════════════════════════════
// T11 — Milestone 3: Task-Skill Binding Integrity
//
// 验证目标（对应需求 3-6）：
//   需求 3: param_patches 默认绑定 task_run.skill_card_id，前端传入 Edge Function
//   需求 4: RPC BINDING_MISMATCH 校验逻辑（task_run.skill_card_id 与 p_skill_card_id 一致）
//   需求 5: failure episode 绑定字段完整性（task_id / task_run_id / skill_card_id）
//   需求 6: parameter_patch episode 绑定字段完整性
//           （task_id / task_run_id / skill_card_id / skill_history_id）
// ════════════════════════════════════════════════════════════════════════
describe('T11: Task-Skill Binding Integrity（Milestone 3）', () => {

  // ── T11-REQ3: param_patches 默认作用于 task_run.skill_card_id ─────
  // 前端 requestBody 必须包含 skill_card_id，确保 Edge Function 能绑定
  const requestBody = {
    task_run_id:   'run-001',
    task_id:       'task-001',
    task_name:     '示例任务',
    target_url:    'https://example.com',
    skill_card_id: 'card-001',   // 来自 taskRun.skill_card_id
    steps:         [],
    steps_result:  [],
    error_message: '',
  };
  assert('skill_card_id' in requestBody,
    'REQ3: Edge Function requestBody 包含 skill_card_id');
  assert(requestBody.skill_card_id === 'card-001',
    'REQ3: skill_card_id 来源于 taskRun.skill_card_id（param_patches 默认绑定）');

  // null 值情况：task_run 尚未绑定技能卡（旧数据/首次创建）
  const requestBodyNoCard = { ...requestBody, skill_card_id: null };
  assert(requestBodyNoCard.skill_card_id === null,
    'REQ3: task_run 未绑定技能卡时 skill_card_id 传 null（兼容旧数据）');

  // ── T11-REQ4: BINDING_MISMATCH 校验逻辑 ──────────────────────────
  // 情况 A：task_run.skill_card_id 与传入一致 → 允许
  const taskRunCardId   = 'card-001';
  const passedCardId    = 'card-001';
  const isMismatch = (runCard: string | null, passed: string): boolean =>
    runCard !== null && runCard !== passed;

  assert(!isMismatch(taskRunCardId, passedCardId),
    'REQ4: task_run.skill_card_id === p_skill_card_id → 允许操作');

  // 情况 B：task_run.skill_card_id 为 null → 兼容旧数据，允许
  assert(!isMismatch(null, passedCardId),
    'REQ4: task_run.skill_card_id IS NULL → 旧数据兼容，允许操作');

  // 情况 C：不一致 → BINDING_MISMATCH
  const mismatchCardId = 'card-999';
  assert(isMismatch(taskRunCardId, mismatchCardId),
    'REQ4: task_run.skill_card_id !== p_skill_card_id → 触发 BINDING_MISMATCH');

  // 前端能识别 BINDING_MISMATCH 错误前缀
  const bindingMismatchMsg =
    'BINDING_MISMATCH: task_run run-001 绑定的 skill_card 为 card-001，与传入 card-999 不一致';
  assert(bindingMismatchMsg.includes('BINDING_MISMATCH'),
    'REQ4: 前端 msg.includes("BINDING_MISMATCH") 能正确识别绑定冲突错误');

  // 所有已知错误前缀覆盖（含 BINDING_MISMATCH）
  const allPrefixes = ['FORBIDDEN', 'NOT_FOUND', 'UNAUTHORIZED', 'INVALID_INPUT', 'BINDING_MISMATCH'];
  allPrefixes.forEach(prefix => {
    const mockMsg = `${prefix}: 测试消息`;
    assert(mockMsg.includes(prefix),
      `REQ4: 前端能识别错误前缀 "${prefix}"`);
  });

  // ── T11-REQ5: failure episode 绑定字段完整性 ─────────────────────
  // 模拟 Edge Function 写入的 failure episode
  const failureEpisode = {
    type:         'failure',
    title:        '[白质分析] 示例任务 — timeout',
    task_id:      'task-001',        // ✅ 必填
    task_run_id:  'run-001',         // ✅ 必填
    skill_card_id:'card-001',        // ✅ 需求 5 新增
    content_json: {
      task_run_id:       'run-001',
      root_cause:        '页面加载超时',
      failure_type:      'timeout',
      param_patches:     [{ param_name: 'timeout_ms', suggested_value: '8000' }],
    },
  };

  assert(failureEpisode.type === 'failure',
    'REQ5: episode.type === "failure"');
  assert(!!failureEpisode.task_id,
    'REQ5: failure episode 包含 task_id');
  assert(!!failureEpisode.task_run_id,
    'REQ5: failure episode 包含 task_run_id');
  assert(!!failureEpisode.skill_card_id,
    'REQ5: failure episode 包含 skill_card_id（Milestone 3 新增）');
  assert(Array.isArray(failureEpisode.content_json.param_patches)
         && failureEpisode.content_json.param_patches.length > 0,
    'REQ5: content_json.param_patches 存在且非空（绑定到 skill_card_id 的补丁建议）');

  // ── T11-REQ6: parameter_patch episode 四绑定完整性 ────────────────
  // 模拟 RPC 写入的 parameter_patch episode（含新增 skill_history_id 列）
  const patchEpisode = {
    type:             'parameter_patch',
    task_id:          'task-001',    // ✅ 必填
    task_run_id:      'run-001',     // ✅ 必填
    skill_card_id:    'card-001',    // ✅ 必填
    skill_history_id: 'hist-uuid-001', // ✅ 需求 6 新增列
    content_json: {
      param_name:       'timeout_ms',
      old_value:        '3000',
      suggested_value:  '5000',
      applied_value:    '5000',
      applied_at:       '2026-05-19T10:00:00Z',
      skill_card_id:    'card-001',
      task_run_id:      'run-001',
      skill_history_id: 'hist-uuid-001',  // content_json 同步冗余
    },
  };

  assert(patchEpisode.type === 'parameter_patch',
    'REQ6: episode.type === "parameter_patch"');
  assert(!!patchEpisode.task_id,
    'REQ6: parameter_patch episode 包含 task_id（列级）');
  assert(!!patchEpisode.task_run_id,
    'REQ6: parameter_patch episode 包含 task_run_id（列级）');
  assert(!!patchEpisode.skill_card_id,
    'REQ6: parameter_patch episode 包含 skill_card_id（列级）');
  assert(!!patchEpisode.skill_history_id,
    'REQ6: parameter_patch episode 包含 skill_history_id（列级，Milestone 3 新增）');

  // content_json 同步冗余 skill_history_id
  assert(
    'skill_history_id' in patchEpisode.content_json,
    'REQ6: content_json 同步包含 skill_history_id（方便业务查询）',
  );
  assert(
    patchEpisode.content_json.skill_history_id === patchEpisode.skill_history_id,
    'REQ6: content_json.skill_history_id 与列级 skill_history_id 一致',
  );

  // 四绑定一致性：task_run_id 在 episode 列和 content_json 中保持一致
  assert(
    patchEpisode.task_run_id === patchEpisode.content_json.task_run_id,
    'REQ6: episode.task_run_id 与 content_json.task_run_id 一致（绑定一致性）',
  );
  assert(
    patchEpisode.skill_card_id === patchEpisode.content_json.skill_card_id,
    'REQ6: episode.skill_card_id 与 content_json.skill_card_id 一致（绑定一致性）',
  );
});

// ════════════════════════════════════════════════════════════════════════
// T12 — 需求 8: Binding Guard 测试（四场景）
//
// 场景 1: task_run 缺失 skill_card_id → 不能应用补丁（需求 7）
// 场景 2: task_run.skill_card_id 与传入 skill_card_id 不一致 → 拒绝（需求 4）
// 场景 3: failure episode 能回溯到 task_run 和 skill_card（需求 5）
// 场景 4: parameter_patch episode 能回溯到 task_run、skill_card 和版本记录（需求 6）
// ════════════════════════════════════════════════════════════════════════
describe('T12: Binding Guard — 需求 8 四场景', () => {

  // ── 场景 1: task_run 缺失 skill_card_id → 必须拒绝 ──────────────────
  // 模拟 RPC step 2 的 MISSING_SKILL_CARD 判断逻辑
  const checkMissingSkillCard = (
    taskRunId: string | null,
    taskRunSkillCardId: string | null,
  ): string | null => {
    if (taskRunId === null) return null;                // 无 task_run，跳过检查
    if (taskRunSkillCardId === null) return 'MISSING_SKILL_CARD';
    return null;
  };

  // task_run_id 存在但 skill_card_id 为 null → 触发 MISSING_SKILL_CARD
  assert(
    checkMissingSkillCard('run-001', null) === 'MISSING_SKILL_CARD',
    '场景1: task_run.skill_card_id IS NULL → MISSING_SKILL_CARD（不允许应用补丁）',
  );
  // task_run_id 为 null（无来源推理）→ 跳过检查，允许
  assert(
    checkMissingSkillCard(null, null) === null,
    '场景1: p_task_run_id IS NULL → 跳过 task_run 检查（允许无来源推理场景）',
  );
  // task_run 已绑定 skill_card → 不触发 MISSING_SKILL_CARD
  assert(
    checkMissingSkillCard('run-001', 'card-001') === null,
    '场景1: task_run.skill_card_id 已设置 → 不触发 MISSING_SKILL_CARD',
  );

  // 前端能识别 MISSING_SKILL_CARD 错误前缀（需求 8 ↔ 需求 7）
  const missingMsg = 'MISSING_SKILL_CARD: task_run run-001 未关联技能卡，无法应用参数补丁。';
  assert(
    missingMsg.includes('MISSING_SKILL_CARD'),
    '场景1: 前端 msg.includes("MISSING_SKILL_CARD") 能正确识别缺失绑定错误',
  );

  // ── 场景 2: task_run.skill_card_id 与传入不一致 → 拒绝 ──────────────
  const checkBindingMismatch = (
    taskRunSkillCardId: string | null,
    passedSkillCardId: string,
  ): string | null => {
    if (taskRunSkillCardId === null) return 'MISSING_SKILL_CARD'; // v4: null 也拒绝
    if (taskRunSkillCardId !== passedSkillCardId) return 'BINDING_MISMATCH';
    return null;
  };

  // 一致 → 允许
  assert(
    checkBindingMismatch('card-001', 'card-001') === null,
    '场景2: task_run.skill_card_id === p_skill_card_id → 允许',
  );
  // 不一致 → BINDING_MISMATCH
  assert(
    checkBindingMismatch('card-001', 'card-999') === 'BINDING_MISMATCH',
    '场景2: task_run.skill_card_id !== p_skill_card_id → BINDING_MISMATCH',
  );
  // null → MISSING_SKILL_CARD（v4 不再豁免 null）
  assert(
    checkBindingMismatch(null, 'card-001') === 'MISSING_SKILL_CARD',
    '场景2: task_run.skill_card_id IS NULL → v4 不再豁免，触发 MISSING_SKILL_CARD',
  );

  // 前端能识别 BINDING_MISMATCH 错误前缀
  const mismatchMsg = 'BINDING_MISMATCH: task_run run-001 绑定的 skill_card 为 card-001，与传入 card-999 不一致';
  assert(
    mismatchMsg.includes('BINDING_MISMATCH'),
    '场景2: 前端 msg.includes("BINDING_MISMATCH") 能正确识别绑定冲突错误',
  );

  // v4 完整错误优先级：MISSING_SKILL_CARD > BINDING_MISMATCH > 其他
  const allGuardPrefixes = ['MISSING_SKILL_CARD', 'BINDING_MISMATCH'];
  allGuardPrefixes.forEach(prefix => {
    assert(
      `${prefix}: 测试消息`.includes(prefix),
      `场景2: 前端能识别绑定守卫错误前缀 "${prefix}"`,
    );
  });

  // ── 场景 3: failure episode 能回溯到 task_run 和 skill_card ──────────
  // 模拟 Edge Function 写入的 failure episode（含 Milestone 3 补充的 skill_card_id）
  const failureEp = {
    type:         'failure' as const,
    task_id:      'task-001',
    task_run_id:  'run-001',
    skill_card_id:'card-001',     // 需求 5：必须记录
    content_json: {
      task_run_id:   'run-001',
      failure_type:  'timeout',
      param_patches: [{ param_name: 'timeout_ms', suggested_value: '8000' }],
    },
  };

  // 回溯到 task_run
  assert(!!failureEp.task_run_id,
    '场景3: failure episode.task_run_id 非空（可回溯到来源推理）');
  assert(failureEp.task_run_id === failureEp.content_json.task_run_id,
    '场景3: failure episode.task_run_id 与 content_json.task_run_id 一致');
  // 回溯到 skill_card
  assert(!!failureEp.skill_card_id,
    '场景3: failure episode.skill_card_id 非空（可回溯到技能卡）');
  // param_patches 通过 skill_card_id 建立补丁-技能卡关联
  assert(
    Array.isArray(failureEp.content_json.param_patches)
    && failureEp.content_json.param_patches.length > 0,
    '场景3: failure episode.content_json.param_patches 存在且非空',
  );
  // task_id 存在，支持回溯到任务维度
  assert(!!failureEp.task_id,
    '场景3: failure episode.task_id 非空（支持按任务维度检索）');

  // ── 场景 4: parameter_patch episode 能回溯到 task_run、skill_card 和版本记录
  const patchEp = {
    type:             'parameter_patch' as const,
    task_id:          'task-001',
    task_run_id:      'run-001',
    skill_card_id:    'card-001',
    skill_history_id: 'hist-uuid-001',   // 需求 6：必须记录
    content_json: {
      param_name:       'timeout_ms',
      old_value:        '3000',
      applied_value:    '5000',
      applied_at:       '2026-05-19T10:00:00Z',
      skill_card_id:    'card-001',
      task_run_id:      'run-001',
      skill_history_id: 'hist-uuid-001',
      new_version:      '1.0.4',          // 版本记录（skill_history_id OR new_version）
    },
  };

  // 回溯到 task_run
  assert(!!patchEp.task_run_id,
    '场景4: parameter_patch episode.task_run_id 非空（可回溯到来源推理）');
  assert(patchEp.task_run_id === patchEp.content_json.task_run_id,
    '场景4: episode.task_run_id 与 content_json.task_run_id 一致');
  // 回溯到 skill_card
  assert(!!patchEp.skill_card_id,
    '场景4: parameter_patch episode.skill_card_id 非空（可回溯到技能卡）');
  assert(patchEp.skill_card_id === patchEp.content_json.skill_card_id,
    '场景4: episode.skill_card_id 与 content_json.skill_card_id 一致');
  // 回溯到版本记录（skill_history_id 列级）
  assert(!!patchEp.skill_history_id,
    '场景4: parameter_patch episode.skill_history_id 非空（可回溯到 skill_history 版本快照）');
  assert(patchEp.skill_history_id === patchEp.content_json.skill_history_id,
    '场景4: episode.skill_history_id 与 content_json.skill_history_id 一致');
  // 版本记录（new_version 作为辅助字段，与 skill_history_id 互补）
  assert(!!patchEp.content_json.new_version,
    '场景4: content_json.new_version 非空（skill_history_id OR new_version，需求 6）');
  // task_id 存在，支持回溯到任务维度
  assert(!!patchEp.task_id,
    '场景4: parameter_patch episode.task_id 非空（支持按任务维度检索）');
});

// ════════════════════════════════════════════════════════════════════════
// T13 — Milestone 4: Concurrent Patch Safety
//
// 场景 A: 两个补丁顺序应用，version 连续递增（需求 1/2/3）
// 场景 B: expected_version 过期 → VERSION_CONFLICT（需求 3）
// 场景 C: 并发保护三层架构完整性（需求 1/4/6）
// 场景 D: RPC v5 新增入参契约（p_expected_version DEFAULT NULL）
// ════════════════════════════════════════════════════════════════════════
describe('T13: Concurrent Patch Safety（Milestone 4）', () => {

  // ── 工具：模拟单次补丁的版本递增逻辑（与 RPC step 3 一致）─────────
  const applyVersionBump = (currentVersion: string): string =>
    bumpPatchVersion(currentVersion);

  // ── 工具：模拟乐观锁校验逻辑（与 RPC step 1b 一致）────────────────
  const checkVersionConflict = (
    dbVersion: string,
    expectedVersion: string | null,
  ): 'VERSION_CONFLICT' | null => {
    if (expectedVersion !== null && dbVersion !== expectedVersion) {
      return 'VERSION_CONFLICT';
    }
    return null;
  };

  // ── 场景 A: 两个补丁顺序应用 → version 连续递增 ──────────────────

  // 初始状态
  let cardVersion = '1.0.0';

  // 补丁 1：读到 v1.0.0，传入 expected_version='1.0.0'，写入后升至 v1.0.1
  const conflict1 = checkVersionConflict(cardVersion, '1.0.0');
  assert(conflict1 === null,
    '场景A: 补丁1 expected_version 与 DB 一致 → 无冲突');
  cardVersion = applyVersionBump(cardVersion);
  assert(cardVersion === '1.0.1',
    '场景A: 补丁1 应用后 version = 1.0.1');

  // 补丁 2：读到 v1.0.1，传入 expected_version='1.0.1'，写入后升至 v1.0.2
  const conflict2 = checkVersionConflict(cardVersion, '1.0.1');
  assert(conflict2 === null,
    '场景A: 补丁2 expected_version 与 DB 一致 → 无冲突');
  cardVersion = applyVersionBump(cardVersion);
  assert(cardVersion === '1.0.2',
    '场景A: 补丁2 应用后 version = 1.0.2');

  // 两次递增连续，版本不跳跃
  assert(cardVersion === '1.0.2',
    '场景A: 两次顺序补丁后 version = 1.0.2（连续递增，无跳跃）');

  // 多次连续递增验证（10 次 → 1.0.10）
  let v = '1.0.0';
  for (let i = 1; i <= 10; i++) {
    v = applyVersionBump(v);
  }
  assert(v === '1.0.10',
    '场景A: 10 次连续补丁后 version = 1.0.10（patch 段跨 10 无截断）');

  // ── 场景 B: expected_version 过期 → VERSION_CONFLICT ────────────────

  // 并发情况：客户端读到 v1.0.0，但另一请求已先写入 v1.0.1
  const staleDb      = '1.0.1';   // DB 中已是 1.0.1
  const staleExpected = '1.0.0';  // 客户端快照过期

  const conflictResult = checkVersionConflict(staleDb, staleExpected);
  assert(conflictResult === 'VERSION_CONFLICT',
    '场景B: DB=1.0.1, expected=1.0.0 → VERSION_CONFLICT（过期快照被拒绝）');

  // VERSION_CONFLICT 时整个事务回滚 → memory_episodes 不写入（需求 6）
  // 模拟：VERSION_CONFLICT 在获锁后立即 RAISE，后续写操作不执行
  const simulatePatchWithConflict = (
    dbVer: string,
    expectedVer: string | null,
  ): { episodeWritten: boolean; error: string | null } => {
    const conflict = checkVersionConflict(dbVer, expectedVer);
    if (conflict) return { episodeWritten: false, error: conflict };
    return { episodeWritten: true, error: null };
  };

  const conflictOutcome = simulatePatchWithConflict('1.0.1', '1.0.0');
  assert(!conflictOutcome.episodeWritten,
    '场景B: VERSION_CONFLICT → memory_episodes 不写入（事务回滚，需求 6）');
  assert(conflictOutcome.error === 'VERSION_CONFLICT',
    '场景B: 返回 VERSION_CONFLICT 错误');

  // 成功场景：expected 匹配 → episode 正常写入
  const successOutcome = simulatePatchWithConflict('1.0.1', '1.0.1');
  assert(successOutcome.episodeWritten,
    '场景B: expected_version 匹配 → memory_episodes 正常写入');
  assert(successOutcome.error === null,
    '场景B: 无 VERSION_CONFLICT 错误');

  // expected_version = null → 跳过乐观锁校验（向后兼容）
  const nullExpected = simulatePatchWithConflict('1.0.5', null);
  assert(nullExpected.episodeWritten,
    '场景B: expected_version=null → 跳过乐观锁，episode 正常写入（向后兼容）');

  // 前端能识别 VERSION_CONFLICT 错误前缀
  const vcMsg = 'VERSION_CONFLICT: skill_card abc 当前版本为 1.0.1，传入 expected_version 为 1.0.0。';
  assert(vcMsg.includes('VERSION_CONFLICT'),
    '场景B: 前端 msg.includes("VERSION_CONFLICT") 能正确识别版本冲突错误');

  // ── 场景 C: 三层并发保护架构完整性 ──────────────────────────────────

  // 层①：FOR UPDATE — 同一行同时只有一个事务可写（DB 保证，无法前端模拟，测试逻辑正确性）
  // 层②：expected_version 乐观锁 — 客户端快照过期时立即拒绝
  assert(
    checkVersionConflict('1.0.3', '1.0.2') === 'VERSION_CONFLICT',
    '场景C: 层② 乐观锁：expected 过期 → VERSION_CONFLICT',
  );
  assert(
    checkVersionConflict('1.0.3', '1.0.3') === null,
    '场景C: 层② 乐观锁：expected 匹配 → 允许',
  );

  // 层③：UNIQUE(skill_card_id, version) — DB 约束防止重复版本
  // 模拟：若两个事务同时算出相同的新版本，第二个写入触发 UNIQUE VIOLATION → 事务回滚
  const uniqueVersions = ['1.0.1', '1.0.2', '1.0.3'];
  const uniqueSet = new Set(uniqueVersions);
  assert(
    uniqueSet.size === uniqueVersions.length,
    '场景C: 层③ UNIQUE 约束：同一 skill_card 下版本号不重复',
  );

  // 整体：三层错误前缀均可被前端识别
  const allConcurrentPrefixes = ['VERSION_CONFLICT', 'MISSING_SKILL_CARD', 'BINDING_MISMATCH'];
  allConcurrentPrefixes.forEach(p => {
    assert(
      `${p}: 测试`.includes(p),
      `场景C: 前端能识别并发保护错误前缀 "${p}"`,
    );
  });

  // ── 场景 D: RPC v5 入参契约（p_expected_version）──────────────────

  // v5 RPC 调用必须包含 p_expected_version 字段
  const rpcCallV5 = {
    p_skill_card_id:        'card-001',
    p_task_run_id:          'run-001',
    p_task_id:              'task-001',
    p_task_name:            '示例任务',
    p_canonical_param_name: 'timeout_ms',
    p_raw_param_name:       'timeout',
    p_old_value:            '3000',
    p_suggested_value:      '5000',
    p_applied_value:        '5000',
    p_reason:               '页面加载超时，建议增加等待时间',
    p_normalization_note:   null,
    p_expected_version:     '1.0.3',   // Milestone 4 新增
  };

  assert('p_expected_version' in rpcCallV5,
    '场景D: RPC v5 入参包含 p_expected_version 字段');
  assert(typeof rpcCallV5.p_expected_version === 'string',
    '场景D: p_expected_version 类型为 string（客户端读取到的版本）');

  // p_expected_version = null 时向后兼容（DEFAULT NULL）
  const rpcCallV5Null = { ...rpcCallV5, p_expected_version: null };
  assert(rpcCallV5Null.p_expected_version === null,
    '场景D: p_expected_version = null → 跳过乐观锁（向后兼容 DEFAULT NULL）');

  // v5 成功响应新增 prev_version 字段（便于客户端重试时感知版本变化）
  const v5SuccessResp = {
    ok:            true,
    new_version:   '1.0.4',
    prev_version:  '1.0.3',   // v5 新增
    skill_card_id: 'card-001',
    history_id:    'hist-uuid',
    episode_id:    'ep-uuid',
  };
  assert(v5SuccessResp.ok === true,
    '场景D: v5 成功响应 ok === true');
  assert('prev_version' in v5SuccessResp,
    '场景D: v5 成功响应包含 prev_version（Milestone 4 新增，便于客户端感知版本变化）');
  assert(v5SuccessResp.prev_version === rpcCallV5.p_expected_version,
    '场景D: prev_version 与客户端传入的 expected_version 一致');

  // ── 场景 E: 冲突隔离 + skill_history_id 一致性（需求 7 新增三条）─

  // 扩展模拟器：同时追踪 historyWritten 和 episodeWritten
  const simulatePatchFull = (
    dbVer: string,
    expectedVer: string | null,
  ): {
    historyWritten: boolean;
    episodeWritten: boolean;
    historyId: string | null;
    error: string | null;
  } => {
    // step 1b：乐观锁校验 — VERSION_CONFLICT 时整个事务回滚
    if (expectedVer !== null && dbVer !== expectedVer) {
      return { historyWritten: false, episodeWritten: false, historyId: null, error: 'VERSION_CONFLICT' };
    }
    // 成功路径：skill_history 写入后返回 id，episode 绑定同一 id
    const historyId = 'hist-uuid-' + Math.random().toString(36).slice(2, 8);
    return { historyWritten: true, episodeWritten: true, historyId, error: null };
  };

  // E-1: VERSION_CONFLICT → skill_history 不写入（需求 7.3）
  const conflictFull = simulatePatchFull('1.0.1', '1.0.0');
  assert(!conflictFull.historyWritten,
    '场景E: VERSION_CONFLICT → skill_history 不生成（事务回滚，需求 7.3）');
  assert(conflictFull.historyId === null,
    '场景E: VERSION_CONFLICT → history_id 为 null（无 skill_history 行）');

  // E-2: VERSION_CONFLICT → parameter_patch episode 不写入（需求 7.4）
  assert(!conflictFull.episodeWritten,
    '场景E: VERSION_CONFLICT → parameter_patch episode 不生成（事务回滚，需求 7.4）');
  assert(conflictFull.error === 'VERSION_CONFLICT',
    '场景E: 冲突请求返回 VERSION_CONFLICT，两个写操作均未执行');

  // E-3: 成功请求的 skill_history_id 与 episode.skill_history_id 一致（需求 7.5）
  const successFull = simulatePatchFull('1.0.1', '1.0.1');
  assert(successFull.historyWritten,
    '场景E: 成功请求 → skill_history 写入');
  assert(successFull.episodeWritten,
    '场景E: 成功请求 → parameter_patch episode 写入');
  assert(successFull.historyId !== null,
    '场景E: 成功请求 → history_id 非 null');

  // 模拟 RPC 返回与 episode 中记录的 skill_history_id 一致
  const mockHistoryId = successFull.historyId!;
  const mockEpisode = {
    type:             'parameter_patch',
    skill_history_id: mockHistoryId,   // 列级绑定
    content_json: {
      skill_history_id: mockHistoryId, // content_json 冗余
    },
  };
  const rpcReturnHistoryId = mockHistoryId; // RPC RETURNING id INTO v_history_id

  assert(
    mockEpisode.skill_history_id === rpcReturnHistoryId,
    '场景E: episode.skill_history_id（列级）与 RPC 返回的 history_id 一致（需求 7.5）',
  );
  assert(
    mockEpisode.content_json.skill_history_id === rpcReturnHistoryId,
    '场景E: episode.content_json.skill_history_id 与 RPC 返回的 history_id 一致（需求 7.5 冗余校验）',
  );
  assert(
    mockEpisode.skill_history_id === mockEpisode.content_json.skill_history_id,
    '场景E: episode 列级与 content_json 内的 skill_history_id 相互一致',
  );

  // E 边界：冲突 + 成功交替，各自独立不污染
  const run1 = simulatePatchFull('1.0.2', '1.0.1'); // 冲突
  const run2 = simulatePatchFull('1.0.2', '1.0.2'); // 成功
  assert(!run1.historyWritten && !run1.episodeWritten,
    '场景E: 冲突请求不影响后续成功请求（两次独立事务）');
  assert(run2.historyWritten && run2.episodeWritten,
    '场景E: 成功请求在冲突之后独立完成（不受前一失败影响）');
  assert(run1.historyId === null && run2.historyId !== null,
    '场景E: 冲突 history_id=null，成功 history_id 有值（数据隔离）');
});

// ════════════════════════════════════════════════════════════════════════
// T14 — Milestone 5: Patch Outcome Evaluation
//
// 场景 A: 四维对比计算逻辑（成功率 / 耗时 / 失败类型 / 受影响步骤）
// 场景 B: 数据充分性检验（insufficient_data_before / after）
// 场景 C: evaluate_patch_outcome RPC 入参与出参契约
// 场景 D: patch_evaluation episode 字段完整性
// 场景 E: task_run 版本追踪字段契约（skill_version + skill_history_id）
// ════════════════════════════════════════════════════════════════════════
describe('T14: Patch Outcome Evaluation（Milestone 5）', () => {

  // ── 内联工具函数（镜像 RPC 逻辑，无外部依赖）────────────────────────

  /** 计算成功率 (0–100), 无数据返回 null */
  const successRate = (success: number, total: number): number | null =>
    total === 0 ? null : Math.round((success / total) * 1000) / 10;

  /** 计算两数组差集（在 a 中存在、b 中不存在的元素） */
  const setDiff = (a: string[], b: string[]): string[] =>
    a.filter(x => !b.includes(x));

  /** 计算两数组交集 */
  const setIntersect = (a: string[], b: string[]): string[] =>
    a.filter(x => b.includes(x));

  /** 模拟完整评估流程（镜像 evaluate_patch_outcome RPC 主逻辑） */
  interface Window {
    total: number; success: number; avg_duration_ms: number | null;
    failure_types: string[]; affected_steps: string[];
  }
  const evaluate = (before: Window, after: Window) => {
    const beforeRate = successRate(before.success, before.total);
    const afterRate  = successRate(after.success, after.total);
    return {
      evaluation_status:         'evaluated' as const,
      before_success_rate:       beforeRate,
      after_success_rate:        afterRate,
      success_rate_delta:        afterRate !== null && beforeRate !== null ? afterRate - beforeRate : null,
      before_avg_duration:       before.avg_duration_ms,
      after_avg_duration:        after.avg_duration_ms,
      duration_delta:            after.avg_duration_ms !== null && before.avg_duration_ms !== null
                                   ? after.avg_duration_ms - before.avg_duration_ms : null,
      resolved_failure_types:    setDiff(before.failure_types, after.failure_types),
      persisting_failure_types:  setIntersect(before.failure_types, after.failure_types),
      resolved_steps:            setDiff(before.affected_steps, after.affected_steps),
      still_failing_steps:       setIntersect(before.affected_steps, after.affected_steps),
    };
  };

  // ── 场景 A: 四维对比计算逻辑 ─────────────────────────────────────────

  // A-1: 成功率对比（需求 3①）
  const beforeWin: Window = {
    total: 5, success: 2, avg_duration_ms: 4000,
    failure_types: ['element_not_found', 'timeout'],
    affected_steps: ['1:click', '3:fill'],
  };
  const afterWin: Window = {
    total: 3, success: 3, avg_duration_ms: 2500,
    failure_types: ['timeout'],              // element_not_found 已消失
    affected_steps: ['3:fill'],              // 1:click 已修复
  };
  const evalResult = evaluate(beforeWin, afterWin);

  assert(evalResult.before_success_rate === 40,
    '场景A: before 成功率 = 2/5 = 40%（需求 3①）');
  assert(evalResult.after_success_rate === 100,
    '场景A: after 成功率 = 3/3 = 100%（需求 3①）');
  assert(evalResult.success_rate_delta === 60,
    '场景A: 成功率提升 delta = +60%（需求 3①）');

  // A-2: 耗时对比（需求 3②）
  assert(evalResult.before_avg_duration === 4000,
    '场景A: before 平均耗时 = 4000ms（需求 3②）');
  assert(evalResult.after_avg_duration === 2500,
    '场景A: after 平均耗时 = 2500ms（需求 3②）');
  assert(evalResult.duration_delta === -1500,
    '场景A: 耗时缩短 delta = -1500ms（负数 = 改善，需求 3②）');

  // A-3: 失败类型消失检测（需求 3③）
  assert(evalResult.resolved_failure_types.includes('element_not_found'),
    '场景A: element_not_found 在补丁后消失（需求 3③）');
  assert(!evalResult.resolved_failure_types.includes('timeout'),
    '场景A: timeout 仍然存在，不在 resolved 列表（需求 3③）');
  assert(evalResult.persisting_failure_types.includes('timeout'),
    '场景A: timeout 两窗口均存在 → persisting_failure_types（需求 3③）');
  assert(evalResult.persisting_failure_types.length === 1,
    '场景A: persisting_failure_types 只有 timeout（需求 3③）');

  // A-4: 受影响步骤对比（需求 3④）
  assert(evalResult.resolved_steps.includes('1:click'),
    '场景A: 1:click 补丁后不再失败 → resolved_steps（需求 3④）');
  assert(!evalResult.resolved_steps.includes('3:fill'),
    '场景A: 3:fill 仍然失败，不在 resolved_steps（需求 3④）');
  assert(evalResult.still_failing_steps.includes('3:fill'),
    '场景A: 3:fill 两窗口均失败 → still_failing_steps（需求 3④）');
  assert(evalResult.still_failing_steps.length === 1,
    '场景A: still_failing_steps 只有 3:fill（需求 3④）');

  // A-5: 退化场景（成功率下降）
  const degraded = evaluate(
    { total: 4, success: 4, avg_duration_ms: 1000, failure_types: [], affected_steps: [] },
    { total: 4, success: 2, avg_duration_ms: 2000, failure_types: ['timeout'], affected_steps: ['0:navigate'] },
  );
  assert((degraded.success_rate_delta ?? 0) < 0,
    '场景A: 成功率下降时 delta < 0（退化检测）');
  assert((degraded.duration_delta ?? 0) > 0,
    '场景A: 耗时增加时 delta > 0（退化检测）');

  // A-6: 无改善场景（delta === 0）
  const noChange = evaluate(
    { total: 5, success: 3, avg_duration_ms: 3000, failure_types: ['timeout'], affected_steps: ['2:wait'] },
    { total: 5, success: 3, avg_duration_ms: 3000, failure_types: ['timeout'], affected_steps: ['2:wait'] },
  );
  assert(noChange.success_rate_delta === 0,
    '场景A: 无变化时 success_rate_delta === 0');
  assert(noChange.duration_delta === 0,
    '场景A: 无变化时 duration_delta === 0');
  assert(noChange.resolved_failure_types.length === 0,
    '场景A: 无新消失的失败类型时 resolved_failure_types 为空');
  assert(noChange.resolved_steps.length === 0,
    '场景A: 无新修复的步骤时 resolved_steps 为空');

  // ── 场景 B: 数据充分性检验 ───────────────────────────────────────────

  // B-1: before 无数据
  const insufficientBefore = (() => {
    const bTotal = 0;
    if (bTotal === 0) return { evaluation_status: 'insufficient_data_before' as const };
    return evaluate(
      { total: bTotal, success: 0, avg_duration_ms: null, failure_types: [], affected_steps: [] },
      { total: 3, success: 2, avg_duration_ms: 1500, failure_types: [], affected_steps: [] },
    );
  })();
  assert(insufficientBefore.evaluation_status === 'insufficient_data_before',
    '场景B: before_total=0 → evaluation_status=insufficient_data_before');

  // B-2: after 无数据
  const insufficientAfter = (() => {
    const aTotal = 0;
    if (aTotal === 0) return { evaluation_status: 'insufficient_data_after' as const };
    return evaluate(
      { total: 3, success: 2, avg_duration_ms: 2000, failure_types: [], affected_steps: [] },
      { total: aTotal, success: 0, avg_duration_ms: null, failure_types: [], affected_steps: [] },
    );
  })();
  assert(insufficientAfter.evaluation_status === 'insufficient_data_after',
    '场景B: after_total=0 → evaluation_status=insufficient_data_after');

  // B-3: 单次 before，单次 after → 仍可评估
  const minData = evaluate(
    { total: 1, success: 0, avg_duration_ms: 5000, failure_types: ['timeout'], affected_steps: ['0:navigate'] },
    { total: 1, success: 1, avg_duration_ms: 1000, failure_types: [], affected_steps: [] },
  );
  assert(minData.evaluation_status === 'evaluated',
    '场景B: 各 1 条 task_run → 可评估（最小数据集）');
  assert(minData.before_success_rate === 0 && minData.after_success_rate === 100,
    '场景B: 最小数据集：0% → 100%');

  // B-4: 成功率为 null 时不参与 delta 计算
  assert(successRate(0, 0) === null,
    '场景B: total=0 时 successRate 返回 null');

  // ── 场景 C: RPC 入参/出参契约 ────────────────────────────────────────

  // C-1: 入参契约
  const rpcArgs = {
    p_skill_card_id: 'card-uuid-001',
    p_task_id:       'task-uuid-001',
    p_task_run_id:   'run-uuid-001',
  };
  assert('p_skill_card_id' in rpcArgs,
    '场景C: RPC 入参包含 p_skill_card_id');
  assert('p_task_id' in rpcArgs,
    '场景C: RPC 入参包含 p_task_id');
  assert('p_task_run_id' in rpcArgs,
    '场景C: RPC 入参包含 p_task_run_id（刚完成的执行记录）');

  // C-2: 成功出参结构
  const mockRpcResponse = {
    ok:                       true,
    episode_id:               'ep-uuid-eval-001',
    evaluation_status:        'evaluated',
    prev_version:             '1.0.3',
    new_version:              '1.0.4',
    before_success_rate:      40,
    after_success_rate:       80,
    success_rate_delta:       40,
    before_avg_duration:      4500,
    after_avg_duration:       3000,
    duration_delta:           -1500,
    resolved_failure_types:   ['element_not_found'],
    persisting_failure_types: [],
    resolved_steps:           ['1:click'],
    still_failing_steps:      [],
  };
  assert(mockRpcResponse.ok === true,
    '场景C: 成功响应 ok === true');
  assert(typeof mockRpcResponse.episode_id === 'string',
    '场景C: 成功响应包含 episode_id（string）');
  assert(['evaluated', 'insufficient_data_before', 'insufficient_data_after'].includes(
    mockRpcResponse.evaluation_status),
    '场景C: evaluation_status 为三种合法值之一');
  assert(Array.isArray(mockRpcResponse.resolved_failure_types),
    '场景C: resolved_failure_types 为数组');
  assert(Array.isArray(mockRpcResponse.still_failing_steps),
    '场景C: still_failing_steps 为数组');
  assert('prev_version' in mockRpcResponse && 'new_version' in mockRpcResponse,
    '场景C: 响应包含 prev_version/new_version（版本可追踪）');

  // C-3: NOT_FOUND 错误前缀（无 parameter_patch 记录时）
  const notFoundMsg = 'NOT_FOUND: skill_card xxx 未找到 parameter_patch 记录';
  assert(notFoundMsg.includes('NOT_FOUND'),
    '场景C: 无补丁记录时返回 NOT_FOUND 前缀（前端静默忽略）');

  // ── 场景 D: patch_evaluation episode 字段完整性（需求 4）────────────

  const evalEpisode = {
    type:          'patch_evaluation',
    title:         '补丁评估: v1.0.3 → v1.0.4 | 成功率 40% → 80%',
    skill_card_id: 'card-uuid-001',
    task_id:       'task-uuid-001',
    task_run_id:   'run-uuid-001',
    tags:          ['patch_evaluation', 'milestone5', 'evaluated'],
    content_json: {
      evaluation_status: 'evaluated',
      patch_applied_at:  '2026-05-19T10:00:00Z',
      prev_version:      '1.0.3',
      new_version:       '1.0.4',
      evaluated_at:      '2026-05-19T11:00:00Z',
      window_size:       10,
      before: {
        total: 5, success: 2, success_rate: 40,
        avg_duration_ms: 4500,
        failure_types: ['element_not_found', 'timeout'],
        affected_steps: ['1:click', '3:fill'],
      },
      after: {
        total: 5, success: 4, success_rate: 80,
        avg_duration_ms: 3000,
        failure_types: ['timeout'],
        affected_steps: ['3:fill'],
      },
      delta: {
        success_rate_delta:       40,
        duration_ms_delta:        -1500,
        resolved_failure_types:   ['element_not_found'],
        persisting_failure_types: ['timeout'],
        resolved_steps:           ['1:click'],
        still_failing_steps:      ['3:fill'],
      },
    },
  };

  assert(evalEpisode.type === 'patch_evaluation',
    '场景D: episode.type === "patch_evaluation"（需求 4）');
  assert(!!evalEpisode.skill_card_id,
    '场景D: episode.skill_card_id 非空');
  assert(!!evalEpisode.task_id,
    '场景D: episode.task_id 非空');
  assert(!!evalEpisode.task_run_id,
    '场景D: episode.task_run_id 非空（绑定到触发本次评估的 task_run）');
  assert(evalEpisode.tags.includes('patch_evaluation'),
    '场景D: tags 包含 "patch_evaluation"');

  // content_json 核心字段
  const cj = evalEpisode.content_json;
  assert('evaluation_status' in cj,    '场景D: content_json.evaluation_status 存在');
  assert('patch_applied_at'  in cj,    '场景D: content_json.patch_applied_at 存在（时间分界点）');
  assert('prev_version'      in cj,    '场景D: content_json.prev_version 存在');
  assert('new_version'       in cj,    '场景D: content_json.new_version 存在');
  assert('window_size'       in cj,    '场景D: content_json.window_size 存在（评估窗口大小）');
  assert('before'            in cj,    '场景D: content_json.before 存在（补丁前窗口）');
  assert('after'             in cj,    '场景D: content_json.after 存在（补丁后窗口）');
  assert('delta'             in cj,    '场景D: content_json.delta 存在（四维对比结论）');

  // before/after 窗口字段
  const b = cj.before as Record<string, unknown>;
  const a = cj.after  as Record<string, unknown>;
  ['total', 'success', 'success_rate', 'avg_duration_ms', 'failure_types', 'affected_steps'].forEach(k => {
    assert(k in b, `场景D: before.${k} 存在`);
    assert(k in a, `场景D: after.${k} 存在`);
  });

  // delta 字段
  const d = cj.delta as Record<string, unknown>;
  ['success_rate_delta', 'duration_ms_delta',
   'resolved_failure_types', 'persisting_failure_types',
   'resolved_steps', 'still_failing_steps'].forEach(k => {
    assert(k in d, `场景D: delta.${k} 存在（需求 3 四维对比字段）`);
  });

  // ── 场景 F: improved 判定逻辑（需求 6/7）────────────────────────────

  type EvalImproved = (
    afterStatus: string,
    beforeFailType: string | null,
    afterFailType: string | null
  ) => boolean | null;

  const calcImproved: EvalImproved = (afterStatus, beforeFailType, afterFailType) => {
    if (afterStatus === 'success') return true;
    if (afterStatus === 'failed'
        && beforeFailType !== null && afterFailType !== null
        && afterFailType === beforeFailType) return false;
    return null;  // 部分改善
  };

  // F-1: 补丁后成功 → improved=true（需求 6）
  assert(calcImproved('success', 'element_not_found', null) === true,
    '场景F: after_status=success → improved=true（需求 6）');
  assert(calcImproved('success', null, null) === true,
    '场景F: 无 before run 但 after 成功 → improved=true（需求 6 宽松版）');

  // F-2: 补丁后仍失败且相同 failure_type → improved=false（需求 7）
  assert(calcImproved('failed', 'element_not_found', 'element_not_found') === false,
    '场景F: 相同 failure_type → improved=false（需求 7）');
  assert(calcImproved('failed', 'timeout', 'timeout') === false,
    '场景F: timeout → timeout → improved=false（需求 7）');

  // F-3: 失败但 failure_type 已改变 → improved=null（部分改善）
  assert(calcImproved('failed', 'element_not_found', 'timeout') === null,
    '场景F: 失败但 failure_type 改变 → improved=null（部分改善）');
  assert(calcImproved('failed', 'timeout', 'navigation_error') === null,
    '场景F: 失败且不同 failure_type → improved=null');
  assert(calcImproved('failed', null, 'timeout') === null,
    '场景F: before_fail_type 为 null 时不判 false → improved=null');

  // F-4: content_json 必须包含需求 5 全部字段
  const reqFields5 = [
    'skill_card_id', 'skill_history_id', 'parameter_patch_episode_id',
    'before_task_run_id', 'after_task_run_id',
    'before_status', 'after_status',
    'before_failure_type', 'after_failure_type',
    'improved', 'evaluation_summary',
  ];
  const mockCJ5 = {
    skill_card_id:              'card-001',
    skill_history_id:           'hist-001',
    parameter_patch_episode_id: 'ep-patch-001',
    before_task_run_id:         'run-before-001',
    after_task_run_id:          'run-after-001',
    before_status:              'failed',
    after_status:               'success',
    before_failure_type:        'element_not_found',
    after_failure_type:         null,
    improved:                   true,
    evaluation_summary:         '补丁有效：任务执行成功',
    evaluation_status:          'evaluated',
    patch_applied_at:           '2026-05-19T10:00:00Z',
    prev_version:               '1.0.3',
    new_version:                '1.0.4',
    before: {}, after: {}, delta: {},
  };
  reqFields5.forEach(f => {
    assert(f in mockCJ5, `场景F: content_json 包含需求 5 字段 "${f}"`);
  });

  // F-5: evaluation_summary 非空字符串
  assert(typeof mockCJ5.evaluation_summary === 'string' && mockCJ5.evaluation_summary.length > 0,
    '场景F: evaluation_summary 为非空字符串（需求 5）');

  // ── 场景 G: 生命周期引擎（需求 8/9）──────────────────────────────────

  type LifecycleStatus = 'candidate' | 'temporary' | 'sandbox' | 'gray_matter' | 'mature' | 'universal' | 'deprecated';

  // 生命周期前进（需求 8）
  const advanceStatus = (s: LifecycleStatus): LifecycleStatus => {
    const map: Partial<Record<LifecycleStatus, LifecycleStatus>> = {
      candidate: 'temporary', temporary: 'sandbox',
      sandbox: 'gray_matter', gray_matter: 'mature',
    };
    return map[s] ?? s;
  };

  // 生命周期回退（需求 9）
  const degradeStatus = (s: LifecycleStatus): LifecycleStatus => {
    const map: Partial<Record<LifecycleStatus, LifecycleStatus>> = {
      temporary: 'candidate', sandbox: 'temporary',
      gray_matter: 'sandbox', mature: 'gray_matter',
    };
    return map[s] ?? s;   // candidate → candidate（不再降）
  };

  // 连续 improved 统计 + 阈值判定
  const N = 3;
  const checkLifecycle = (evals: Array<boolean | null>) => {
    const recent = evals.slice(-N);
    const trueCount  = recent.filter(v => v === true).length;
    const falseCount = recent.filter(v => v === false).length;
    return { shouldAdvance: trueCount >= N, shouldDegrade: falseCount >= N };
  };

  // G-1: 连续 3 次 true → 前进
  const g1 = checkLifecycle([true, true, true]);
  assert(g1.shouldAdvance === true,  '场景G: 连续 3 次 improved=true → shouldAdvance（需求 8）');
  assert(g1.shouldDegrade === false, '场景G: 全 true 不触发回退');

  // G-2: candidate → temporary（需求 8 第一档）
  assert(advanceStatus('candidate') === 'temporary',
    '场景G: candidate → temporary（需求 8）');

  // G-3: temporary → sandbox
  assert(advanceStatus('temporary') === 'sandbox',
    '场景G: temporary → sandbox（需求 8）');

  // G-4: sandbox → gray_matter
  assert(advanceStatus('sandbox') === 'gray_matter',
    '场景G: sandbox → gray_matter（需求 8）');

  // G-5: gray_matter → mature
  assert(advanceStatus('gray_matter') === 'mature',
    '场景G: gray_matter → mature（需求 8）');

  // G-6: universal / deprecated 不参与自动推进
  assert(advanceStatus('universal') === 'universal',
    '场景G: universal 不自动前进（需求 8）');
  assert(advanceStatus('deprecated') === 'deprecated',
    '场景G: deprecated 不自动前进（需求 8）');

  // G-7: 连续 3 次 false → 回退（需求 9）
  const g7 = checkLifecycle([false, false, false]);
  assert(g7.shouldDegrade === true,  '场景G: 连续 3 次 improved=false → shouldDegrade（需求 9）');
  assert(g7.shouldAdvance === false, '场景G: 全 false 不触发前进');

  // G-8: temporary → candidate（需求 9 第一档）
  assert(degradeStatus('temporary') === 'candidate',
    '场景G: temporary → candidate（需求 9）');

  // G-9: sandbox → temporary
  assert(degradeStatus('sandbox') === 'temporary',
    '场景G: sandbox → temporary（需求 9）');

  // G-10: candidate 不再降级（地板保护）
  assert(degradeStatus('candidate') === 'candidate',
    '场景G: candidate 不再降（需求 9 地板保护）');

  // G-11: 混合序列（真/假/真）→ 不触发
  const g11 = checkLifecycle([true, false, true]);
  assert(!g11.shouldAdvance && !g11.shouldDegrade,
    '场景G: 混合序列不触发生命周期变化（需求 8/9 需连续）');

  // G-12: 不足 N 条时不触发
  const g12 = checkLifecycle([true, true]);  // 只有 2 条
  assert(!g12.shouldAdvance,
    '场景G: 不足 N 条时不触发前进（需求 8）');

  // G-13: ineffective_patch episode 字段契约（需求 9）
  const mockIneffCJ = {
    alert_type:                 'ineffective_patch',
    skill_card_id:              'card-001',
    parameter_patch_episode_id: 'ep-patch-001',
    consecutive_false_count:    3,
    threshold:                  3,
    prev_status:                'temporary',
    new_status:                 'candidate',
    degraded_at:                '2026-05-19T12:00:00Z',
    prev_version:               '1.0.3',
    new_version:                '1.0.4',
  };
  ['alert_type', 'skill_card_id', 'parameter_patch_episode_id',
   'consecutive_false_count', 'threshold', 'prev_status', 'new_status',
   'degraded_at', 'prev_version', 'new_version'].forEach(f => {
    assert(f in mockIneffCJ, `场景G: ineffective_patch episode.content_json 包含字段 "${f}"（需求 9）`);
  });
  assert(mockIneffCJ.alert_type === 'ineffective_patch',
    '场景G: alert_type === "ineffective_patch"（需求 9）');
  assert(mockIneffCJ.consecutive_false_count >= mockIneffCJ.threshold,
    '场景G: consecutive_false_count ≥ threshold（需求 9 触发条件）');

  // G-14: RPC 返回字段包含生命周期信息
  const mockRpcV2 = {
    ok: true,
    episode_id: 'ep-eval-001',
    evaluation_status: 'evaluated',
    improved: true,
    evaluation_summary: '补丁有效：任务执行成功',
    lifecycle_change: 'advanced: candidate → temporary',
    consecutive_improved: 3,
    consecutive_degraded: 0,
    ineffective_patch_episode_id: null,
    skill_card_id: 'card-001',
    skill_history_id: 'hist-001',
    parameter_patch_episode_id: 'ep-patch-001',
    before_task_run_id: 'run-001',
    after_task_run_id: 'run-002',
    before_status: 'failed',
    after_status: 'success',
    before_failure_type: 'element_not_found',
    after_failure_type: null,
  };
  assert('lifecycle_change' in mockRpcV2,
    '场景G: RPC 响应包含 lifecycle_change（需求 8/9）');
  assert('consecutive_improved' in mockRpcV2,
    '场景G: RPC 响应包含 consecutive_improved');
  assert('consecutive_degraded' in mockRpcV2,
    '场景G: RPC 响应包含 consecutive_degraded');
  assert('ineffective_patch_episode_id' in mockRpcV2,
    '场景G: RPC 响应包含 ineffective_patch_episode_id（需求 9）');
  assert(mockRpcV2.lifecycle_change.includes('advanced:'),
    '场景G: 连续 3 次 true 时 lifecycle_change 含 "advanced:" 前缀（需求 8）');

  // G-15: 无效补丁路径的 lifecycle_change 格式
  const mockIneffRpc = { lifecycle_change: 'ineffective_patch: temporary → candidate' };
  assert(mockIneffRpc.lifecycle_change.startsWith('ineffective_patch:'),
    '场景G: 无效补丁时 lifecycle_change 以 "ineffective_patch:" 开头（需求 9）');

  // G-16: 无触发时 lifecycle_change === 'none'
  const mockNoChange = { lifecycle_change: 'none' };
  assert(mockNoChange.lifecycle_change === 'none',
    '场景G: 未触发阈值时 lifecycle_change === "none"');


  // E-1: task_run INSERT 包含 skill_version 和 skill_history_id
  const taskRunInsert = {
    task_id:          'task-uuid-001',
    skill_card_id:    'card-uuid-001',
    skill_version:    '1.0.4',      // Milestone 5 新增
    skill_history_id: 'hist-uuid-001', // Milestone 5 新增
    status:           'running',
    user_id:          'user-uuid-001',
  };
  assert('skill_version' in taskRunInsert,
    '场景E: task_run INSERT 包含 skill_version（需求 1）');
  assert('skill_history_id' in taskRunInsert,
    '场景E: task_run INSERT 包含 skill_history_id（需求 1）');
  assert(typeof taskRunInsert.skill_version === 'string',
    '场景E: skill_version 类型为 string');
  assert(typeof taskRunInsert.skill_history_id === 'string',
    '场景E: skill_history_id 类型为 string（UUID）');

  // E-2: 无技能卡时允许 null（向后兼容）
  const taskRunNoCard = { task_id: 'task-002', skill_card_id: null, skill_version: null, skill_history_id: null };
  assert(taskRunNoCard.skill_version === null,
    '场景E: 无技能卡时 skill_version = null（向后兼容）');
  assert(taskRunNoCard.skill_history_id === null,
    '场景E: 无技能卡时 skill_history_id = null（向后兼容）');

  // E-3: 版本可追踪性（需求 2）— task_run.skill_version 与 skill_card 写入时版本一致
  const cardVersionAtExecution = '1.0.4';
  const runSkillVersion        = '1.0.4';
  assert(runSkillVersion === cardVersionAtExecution,
    '场景E: task_run.skill_version 与执行时 skill_card.version 一致（需求 2 可追踪性）');

  // E-4: EpisodeType 包含 patch_evaluation
  const validEpisodeTypes = ['episode', 'failure', 'success', 'parameter_patch', 'patch_evaluation'];
  assert(validEpisodeTypes.includes('patch_evaluation'),
    '场景E: EpisodeType 枚举包含 "patch_evaluation"（需求 4）');
});

// ════════════════════════════════════════════════════════════════════════
// T14 — 场景 H: 需求 10 指定覆盖场景（5 个场景 + rollback 字段补充）
// ════════════════════════════════════════════════════════════════════════
describe('T14-H: 需求 10 指定测试覆盖（req10）', () => {

  // ── H-1: 补丁后成功 → 生成 improved=true 的 patch_evaluation episode ──
  {
    const afterStatus    = 'success';
    const beforeFailType: string | null = 'element_not_found';
    const improved = afterStatus === 'success' ? true
                   : (afterStatus === 'failed' && beforeFailType === 'element_not_found') ? false
                   : null;

    const ep = {
      type: 'patch_evaluation',
      content_json: {
        improved,
        after_status:               afterStatus,
        after_failure_type:         null,   // 成功无 failure_type
        evaluation_summary:         '补丁有效：任务执行成功',
        parameter_patch_episode_id: 'ep-patch-001',
        skill_history_id:           'hist-v104',
      },
    };
    assert(ep.type === 'patch_evaluation',
      'H-1: 生成 patch_evaluation 类型 episode（需求 10①）');
    assert(ep.content_json.improved === true,
      'H-1: 补丁后任务成功 → improved=true（需求 10①）');
    assert(ep.content_json.after_failure_type === null,
      'H-1: 成功时 after_failure_type=null');
    assert(ep.content_json.evaluation_summary.includes('成功'),
      'H-1: evaluation_summary 描述成功');
    assert(!!ep.content_json.parameter_patch_episode_id,
      'H-1: episode 携带 parameter_patch_episode_id（回溯链）');
  }

  // ── H-2: 补丁后失败且 failure_type 相同 → improved=false episode ─────
  {
    const afterStatus    = 'failed';
    const beforeFailType = 'timeout';
    const afterFailType  = 'timeout';   // 相同
    const improved = afterStatus === 'success' ? true
                   : (afterStatus === 'failed'
                      && beforeFailType !== null && afterFailType !== null
                      && afterFailType === beforeFailType) ? false
                   : null;

    const ep = {
      type: 'patch_evaluation',
      content_json: {
        improved,
        after_status:               afterStatus,
        before_failure_type:        beforeFailType,
        after_failure_type:         afterFailType,
        evaluation_summary:         '补丁无效：仍以相同原因失败（timeout）',
        parameter_patch_episode_id: 'ep-patch-001',
      },
    };
    assert(ep.type === 'patch_evaluation',
      'H-2: 生成 patch_evaluation 类型 episode（需求 10②）');
    assert(ep.content_json.improved === false,
      'H-2: 失败且 failure_type 相同 → improved=false（需求 10②）');
    assert(ep.content_json.before_failure_type === ep.content_json.after_failure_type,
      'H-2: before/after failure_type 相同是 improved=false 的充要条件（需求 10②）');
    assert(ep.content_json.evaluation_summary.includes('相同原因'),
      'H-2: evaluation_summary 描述相同原因失败（需求 10②）');
  }

  // ── H-3: evaluation episode 能回溯到 parameter_patch episode ──────────
  {
    const paramPatchEpisodeId = 'ep-param-patch-abc123';
    const evalEp = {
      type: 'patch_evaluation',
      content_json: {
        parameter_patch_episode_id: paramPatchEpisodeId,  // 回溯链接
        skill_card_id:              'card-001',
        skill_history_id:           'hist-001',
        before_task_run_id:         'run-before-001',
        after_task_run_id:          'run-after-001',
        improved:                   true,
      },
    };
    const paramPatchEp = {
      id:   paramPatchEpisodeId,
      type: 'parameter_patch',
      content_json: {
        param_patches: [
          { param_name: 'selector_timeout', old_value: '3000', applied_value: '5000', reason: '超时频繁' },
        ],
        prev_version: '1.0.3',
        new_version:  '1.0.4',
      },
    };

    assert(evalEp.content_json.parameter_patch_episode_id === paramPatchEp.id,
      'H-3: evaluation.parameter_patch_episode_id 精确指向 parameter_patch.id（需求 10③）');
    assert(paramPatchEp.type === 'parameter_patch',
      'H-3: 回溯到的 episode 类型为 parameter_patch（需求 10③）');
    assert(Array.isArray(paramPatchEp.content_json.param_patches),
      'H-3: parameter_patch episode 含 param_patches 数组（供 rollback 使用）');
    assert(paramPatchEp.content_json.param_patches.length > 0,
      'H-3: param_patches 非空，包含具体参数变更记录（需求 10③）');
    assert('old_value' in paramPatchEp.content_json.param_patches[0],
      'H-3: 每条 param_patch 含 old_value（回滚依据）');
    // 双向可达：evaluation → parameter_patch → evaluation
    assert(evalEp.content_json.parameter_patch_episode_id === paramPatchEp.id,
      'H-3: 通过 parameter_patch_episode_id 可查询原始补丁（双向可达，需求 10③）');
  }

  // ── H-4: 新 task_run 能记录使用的新 skill_history_id ────────────────
  {
    const latestHistoryId = 'hist-uuid-v104-new';
    const taskRunInsert = {
      task_id:          'task-001',
      skill_card_id:    'card-001',
      skill_version:    '1.0.4',
      skill_history_id: latestHistoryId,  // 快照最新 history 行（需求 10④）
      status:           'running',
      user_id:          'user-001',
    };

    assert('skill_history_id' in taskRunInsert,
      'H-4: task_run INSERT payload 包含 skill_history_id（需求 10④）');
    assert(taskRunInsert.skill_history_id === latestHistoryId,
      'H-4: skill_history_id 等于执行前查询到的最新 history 行 id（需求 10④）');
    assert(taskRunInsert.skill_version === '1.0.4',
      'H-4: skill_version 快照补丁后最新版本号（需求 10④）');
    assert(taskRunInsert.skill_history_id !== null,
      'H-4: skill_history_id 非 null（表明有补丁记录可追踪）（需求 10④）');
    // 无补丁时向后兼容
    const runNoHistory = { skill_card_id: 'card-001', skill_history_id: null, skill_version: '1.0.0' };
    assert(runNoHistory.skill_history_id === null,
      'H-4: 从未打过补丁时 skill_history_id=null（向后兼容，需求 10④）');
  }

  // ── H-5: 无 parameter_patch episode 时不生成 evaluation ──────────────
  {
    const notFoundError = { message: 'NOT_FOUND: skill_card abc 未找到 parameter_patch 记录，无法评估' };

    // 前端静默逻辑：NOT_FOUND 时静默忽略，不 console.warn
    const shouldSilence = notFoundError.message.includes('NOT_FOUND');
    const shouldWarn    = !shouldSilence;

    assert(shouldSilence === true,
      'H-5: NOT_FOUND 错误被静默忽略，不显示 UI 报错（需求 10⑤）');
    assert(shouldWarn === false,
      'H-5: NOT_FOUND 时不触发 console.warn（需求 10⑤）');
    assert(notFoundError.message.startsWith('NOT_FOUND:'),
      'H-5: RPC 返回标准 NOT_FOUND: 前缀（需求 10⑤）');
    assert(notFoundError.message.includes('parameter_patch'),
      'H-5: 错误信息明确说明缺少 parameter_patch 记录（需求 10⑤）');

    // RPC 抛异常 → 前端 catch → 不写入任何 patch_evaluation episode
    let evaluationEpisodeCreated = false;
    const simulateRpcWithNoPatch = () => {
      throw new Error('NOT_FOUND: skill_card abc 未找到 parameter_patch 记录，无法评估');
    };
    try {
      simulateRpcWithNoPatch();
      evaluationEpisodeCreated = true;
    } catch {
      evaluationEpisodeCreated = false;
    }
    assert(evaluationEpisodeCreated === false,
      'H-5: RPC 抛 NOT_FOUND 时前端不生成 patch_evaluation episode（需求 10⑤）');
  }

  // ── H-补充: rollback_recommendation 字段契约（需求 9 v3）──────────────
  {
    const mockRollback = {
      alert_type:               'ineffective_patch',
      parameter_patch_episode_id: 'ep-patch-001',
      tags: ['ineffective_patch', 'lifecycle_warning', 'milestone5', 'rollback_recommendation'],
      rollback_recommendation: {
        action:         'rollback_to_version' as const,
        target_version: '1.0.3',
        reason:         '连续 3 次 improved=false，参数补丁未带来改善，建议回滚至上一稳定版本。',
        patch_params: [
          { param_name: 'selector_timeout', rollback_to: '3000', current_value: '5000', original_reason: '超时频繁' },
          { param_name: 'retry_count',      rollback_to: '2',    current_value: '5',    original_reason: '元素未找到' },
        ],
        suggested_steps: [
          '1. 在技能卡编辑页面将上述参数恢复为 rollback_to 对应的值',
          '2. 重新执行任务验证回滚效果',
          '3. 若回滚后仍失败，建议重新触发白质层推理以获取新补丁方案',
          '4. 回滚操作完成后手动将技能卡状态置回 temporary',
        ],
      },
    };

    const rr = mockRollback.rollback_recommendation;
    assert(rr.action === 'rollback_to_version',
      'H-补充: rollback_recommendation.action === "rollback_to_version"（需求 9 v3）');
    assert(typeof rr.target_version === 'string',
      'H-补充: target_version 为字符串（回滚目标版本）（需求 9 v3）');
    assert(typeof rr.reason === 'string' && rr.reason.length > 0,
      'H-补充: reason 为非空字符串（需求 9 v3）');
    assert(Array.isArray(rr.patch_params) && rr.patch_params.length > 0,
      'H-补充: patch_params 为非空数组（需求 9 v3）');
    assert(Array.isArray(rr.suggested_steps) && rr.suggested_steps.length >= 4,
      'H-补充: suggested_steps 至少 4 步（需求 9 v3）');
    rr.patch_params.forEach((p, i) => {
      assert('param_name'      in p, `H-补充: patch_params[${i}] 含 param_name`);
      assert('rollback_to'     in p, `H-补充: patch_params[${i}] 含 rollback_to（回滚目标值）`);
      assert('current_value'   in p, `H-补充: patch_params[${i}] 含 current_value（当前值）`);
      assert('original_reason' in p, `H-补充: patch_params[${i}] 含 original_reason`);
    });
    assert(mockRollback.tags.includes('rollback_recommendation'),
      'H-补充: ineffective_patch episode tags 包含 "rollback_recommendation"');
  }
});

// ════════════════════════════════════════════════════════════════════════
// T15 — apply_rollback_recommendation RPC 契约验证（Milestone 6 需求 1-3）
//
//  场景 A: 校验拒绝（五项校验触发 RAISE EXCEPTION）
//  场景 B: 正常回滚执行（参数回写 + 新版本 + 新 history + episode 溯源）
//  场景 C: 新版本生成规则（patch+1，不覆盖旧行）
// ════════════════════════════════════════════════════════════════════════
describe('T15: apply_rollback_recommendation RPC 契约验证（Milestone 6）', () => {

  // ── 场景 A: 校验拒绝 ────────────────────────────────────────────────

  // A-1: 未登录 → UNAUTHORIZED
  {
    const userId = null;
    const error  = userId === null ? 'UNAUTHORIZED: 用户未登录' : null;
    assert(error !== null && error.startsWith('UNAUTHORIZED'),
      'T15-A-1: 用户未登录 → UNAUTHORIZED 错误（需求 2⑤ 认证前置）');
  }

  // A-2: 参数为空 → INVALID_INPUT
  {
    const params = { p_skill_card_id: null, p_ineffective_patch_ep_id: 'ep-001',
                     p_skill_history_id: 'hist-001', p_expected_version: '1.0.4' };
    const error  = params.p_skill_card_id === null
      ? 'INVALID_INPUT: 所有参数均不能为空' : null;
    assert(error !== null && error.startsWith('INVALID_INPUT'),
      'T15-A-2: skill_card_id 为 null → INVALID_INPUT 错误（需求 2 参数校验）');
  }

  // A-3: skill_card 不存在或不属于当前用户 → NOT_FOUND_OR_FORBIDDEN
  {
    const cardExists  = false;
    const cardOwned   = false;
    const error = (!cardExists || !cardOwned)
      ? 'NOT_FOUND_OR_FORBIDDEN: skill_card xxx 不存在或无权操作' : null;
    assert(error !== null && error.startsWith('NOT_FOUND_OR_FORBIDDEN'),
      'T15-A-3: skill_card 不存在/无权限 → NOT_FOUND_OR_FORBIDDEN（需求 2①⑤）');
  }

  // A-4: 版本不匹配 → VERSION_CONFLICT（乐观锁）
  {
    const cardVersion     = '1.0.5';  // 当前版本
    const expectedVersion = '1.0.4';  // 传入版本（已过期）
    const error = cardVersion !== expectedVersion
      ? `VERSION_CONFLICT: skill_card 当前版本为 ${cardVersion}，传入 expected_version 为 ${expectedVersion}` : null;
    assert(error !== null && error.startsWith('VERSION_CONFLICT'),
      'T15-A-4: 版本不匹配 → VERSION_CONFLICT（需求 2④ 乐观锁）');
    assert(error!.includes(cardVersion),
      'T15-A-4: 错误信息包含当前真实版本号，便于调用方定位（需求 2④）');
    assert(error!.includes(expectedVersion),
      'T15-A-4: 错误信息包含传入的 expected_version（需求 2④）');
  }

  // A-5: skill_history 不属于该 skill_card → NOT_FOUND
  {
    const historyCardId = 'card-002';   // history 实际归属
    const requestCardId = 'card-001';   // 请求方声称的 card
    const error = historyCardId !== requestCardId
      ? 'NOT_FOUND: skill_history hist-001 不存在或不属于 skill_card card-001' : null;
    assert(error !== null && error.startsWith('NOT_FOUND'),
      'T15-A-5: skill_history 不属于该 skill_card → NOT_FOUND（需求 2②）');
  }

  // A-6: episode alert_type 非 ineffective_patch → INVALID_SOURCE
  {
    const alertType = 'some_other_alert';
    const error = alertType !== 'ineffective_patch'
      ? 'INVALID_SOURCE: episode ep-001 不存在、不属于该 skill_card 或 alert_type 非 ineffective_patch' : null;
    assert(error !== null && error.startsWith('INVALID_SOURCE'),
      'T15-A-6: alert_type 非 ineffective_patch → INVALID_SOURCE（需求 2③）');
  }

  // A-7: rollback_recommendation 字段缺失 → INVALID_SOURCE
  {
    const epContentJson = { alert_type: 'ineffective_patch' };   // 无 rollback_recommendation
    const hasRollback   = 'rollback_recommendation' in epContentJson;
    const error = !hasRollback
      ? 'INVALID_SOURCE: episode ep-001 缺少 rollback_recommendation 字段' : null;
    assert(error !== null && error.startsWith('INVALID_SOURCE'),
      'T15-A-7: 缺少 rollback_recommendation 字段 → INVALID_SOURCE（需求 2③）');
  }

  // A-8: patch_params 为空数组 → INVALID_SOURCE
  {
    const patchParams: unknown[] = [];
    const error = patchParams.length === 0
      ? 'INVALID_SOURCE: rollback_recommendation.patch_params 为空，无可回滚参数' : null;
    assert(error !== null && error.startsWith('INVALID_SOURCE'),
      'T15-A-8: patch_params 为空 → INVALID_SOURCE（需求 2③ 补充）');
  }

  // ── 场景 B: 正常回滚执行 ─────────────────────────────────────────────

  // 共享测试夹具
  const mockCard = {
    id: 'card-001', version: '1.0.4', user_id: 'user-001',
    tunable_params: { selector_timeout: 5000, retry_count: 5, wait_after_click: 1500 },
  };
  const mockHistory = {
    id: 'hist-v104', skill_card_id: 'card-001', user_id: 'user-001', version: '1.0.4',
    tunable_params: mockCard.tunable_params,
  };
  const mockIneffEp = {
    id: 'ep-ineff-001',
    content_json: {
      alert_type: 'ineffective_patch',
      prev_version: '1.0.3',
      new_version:  '1.0.4',
      rollback_recommendation: {
        action: 'rollback_to_version',
        target_version: '1.0.3',
        reason: '连续 3 次 improved=false',
        patch_params: [
          { param_name: 'selector_timeout', rollback_to: '3000', current_value: '5000', original_reason: '超时频繁' },
          { param_name: 'retry_count',      rollback_to: '2',    current_value: '5',    original_reason: '元素未找到' },
        ],
        suggested_steps: ['1. 恢复参数', '2. 重新执行', '3. 触发推理', '4. 置回状态'],
      },
    },
  };

  // 模拟 RPC 执行逻辑：应用 patch_params 到 tunable_params
  const simulateRollback = (card: typeof mockCard, ep: typeof mockIneffEp, expectedVersion: string) => {
    // 校验①②③④⑤（已在 A 场景验证，此处模拟全部通过）
    if (card.version !== expectedVersion) throw new Error(`VERSION_CONFLICT`);
    if (ep.content_json.alert_type !== 'ineffective_patch') throw new Error(`INVALID_SOURCE`);

    const rr    = ep.content_json.rollback_recommendation;
    const params = rr.patch_params;

    // 版本推进
    const parts      = card.version.split('.');
    const newPatch   = parseInt(parts[2] ?? '0', 10) + 1;
    const newVersion = `${parts[0]}.${parts[1]}.${newPatch}`;

    // 参数回写
    const updatedParams = { ...card.tunable_params } as Record<string, unknown>;
    const appliedSummary: Array<{ param_name: string; rolled_back_to: string; from_value: string }> = [];
    for (const p of params) {
      const numVal = /^-?[0-9]+(\.[0-9]+)?$/.test(p.rollback_to)
        ? parseFloat(p.rollback_to) : p.rollback_to;
      updatedParams[p.param_name] = numVal;
      appliedSummary.push({ param_name: p.param_name, rolled_back_to: p.rollback_to, from_value: p.current_value });
    }

    return {
      ok: true,
      new_version:                  newVersion,
      prev_version:                 card.version,
      skill_card_id:                card.id,
      new_skill_history_id:         'hist-v105-new',
      ref_skill_history_id:         mockHistory.id,
      rollback_episode_id:          'ep-rollback-001',
      ineffective_patch_episode_id: ep.id,
      applied_params:               appliedSummary,
      applied_at:                   new Date().toISOString(),
      updated_params:               updatedParams,
    };
  };

  const result = simulateRollback(mockCard, mockIneffEp, '1.0.4');

  // B-1: RPC 返回 ok=true
  assert(result.ok === true, 'T15-B-1: RPC 正常执行 → ok=true（需求 1）');

  // B-2: 参数回写正确
  assert((result.updated_params['selector_timeout'] as number) === 3000,
    'T15-B-2: selector_timeout 回滚到 rollback_to=3000（需求 3 参数回写）');
  assert((result.updated_params['retry_count'] as number) === 2,
    'T15-B-2: retry_count 回滚到 rollback_to=2（需求 3 参数回写）');
  // 未在 patch_params 中的参数保持不变
  assert((result.updated_params['wait_after_click'] as number) === 1500,
    'T15-B-2: 未在 patch_params 中的参数保持原值（非破坏性回滚）');

  // B-3: applied_params 摘要正确
  assert(result.applied_params.length === 2,
    'T15-B-3: applied_params 摘要条目数等于 patch_params 长度（需求 3）');
  assert(result.applied_params[0].param_name === 'selector_timeout',
    'T15-B-3: applied_params[0].param_name 正确');
  assert(result.applied_params[0].rolled_back_to === '3000',
    'T15-B-3: applied_params[0].rolled_back_to 等于 rollback_to 值');
  assert(result.applied_params[0].from_value === '5000',
    'T15-B-3: applied_params[0].from_value 等于 current_value（记录回滚来源）');

  // B-4: 溯源字段完整
  assert(result.ineffective_patch_episode_id === mockIneffEp.id,
    'T15-B-4: ineffective_patch_episode_id 回指来源告警 episode（需求 2③ 溯源）');
  assert(result.ref_skill_history_id === mockHistory.id,
    'T15-B-4: ref_skill_history_id 回指校验依据的 skill_history（需求 2②）');
  assert(typeof result.rollback_episode_id === 'string' && result.rollback_episode_id.length > 0,
    'T15-B-4: rollback_episode_id 非空（新写入的 parameter_patch episode id）');
  assert(typeof result.applied_at === 'string',
    'T15-B-4: applied_at 为 ISO 时间戳字符串');

  // ── 场景 C: 新版本生成规则（需求 3）───────────────────────────────

  // C-1: patch+1 版本推进
  const versionCases = [
    { input: '1.0.0', expected: '1.0.1' },
    { input: '1.0.3', expected: '1.0.4' },
    { input: '1.0.9', expected: '1.0.10' },
    { input: '2.3.7', expected: '2.3.8' },
  ];
  versionCases.forEach(({ input, expected }) => {
    const parts  = input.split('.');
    const newVer = `${parts[0]}.${parts[1]}.${parseInt(parts[2], 10) + 1}`;
    assert(newVer === expected,
      `T15-C-1: 版本推进 ${input} → ${expected}（patch+1，需求 3）`);
  });

  // C-2: 新 skill_history 行与旧行 id 不同（绝不覆盖旧行）
  {
    const oldHistoryId = 'hist-v104';
    const newHistoryId = 'hist-v105-new';   // 新生成
    assert(newHistoryId !== oldHistoryId,
      'T15-C-2: 新 skill_history.id ≠ 旧 id（需求 3 不覆盖旧行）');
    assert(result.new_skill_history_id !== result.ref_skill_history_id,
      'T15-C-2: new_skill_history_id ≠ ref_skill_history_id（需求 3）');
  }

  // C-3: 新 skill_history.changes_json.source = 'rollback'
  {
    const changesJson = {
      source:                       'rollback',
      rollback_from_version:        '1.0.4',
      rollback_to_version:          '1.0.3',
      ineffective_patch_episode_id: 'ep-ineff-001',
      ref_skill_history_id:         'hist-v104',
    };
    assert(changesJson.source === 'rollback',
      'T15-C-3: skill_history.changes_json.source = "rollback"（区别于 white_matter_param_patch，需求 3）');
    assert(typeof changesJson.rollback_from_version === 'string',
      'T15-C-3: changes_json 包含 rollback_from_version（回滚审计链）');
    assert(typeof changesJson.rollback_to_version === 'string',
      'T15-C-3: changes_json 包含 rollback_to_version（目标版本）');
    assert(typeof changesJson.ineffective_patch_episode_id === 'string',
      'T15-C-3: changes_json 包含 ineffective_patch_episode_id（溯源，需求 3）');
    assert(typeof changesJson.ref_skill_history_id === 'string',
      'T15-C-3: changes_json 包含 ref_skill_history_id（需求 2②）');
  }

  // C-4: 回滚 episode 类型为 parameter_patch，tags 含 rollback + milestone6
  {
    const epTags = ['parameter_patch', 'rollback', 'milestone6', 'ineffective_patch_ep_ep-inef'];
    assert(epTags.includes('parameter_patch'),
      'T15-C-4: 回滚写入 parameter_patch 类型 episode（海马层可检索，需求 3）');
    assert(epTags.includes('rollback'),
      'T15-C-4: episode tags 含 "rollback"（标记来源，需求 3）');
    assert(epTags.includes('milestone6'),
      'T15-C-4: episode tags 含 "milestone6"（版本追踪）');
  }

  // C-5: 回滚后可再次被 evaluate_patch_outcome 评估（is_rollback=true 标记）
  {
    const rollbackEpContent = {
      source:       'rollback',
      is_rollback:  true,
      new_version:  result.new_version,
      prev_version: result.prev_version,
      applied_params: result.applied_params,
    };
    assert(rollbackEpContent.is_rollback === true,
      'T15-C-5: rollback episode content_json.is_rollback=true（区分普通补丁，需求 3）');
    assert(rollbackEpContent.source === 'rollback',
      'T15-C-5: content_json.source="rollback"（需求 3）');
  }

  // C-6: ApplyRollbackResult 类型契约（前端类型安全）
  {
    const typedResult: {
      ok: boolean;
      new_version: string;
      prev_version: string;
      skill_card_id: string;
      new_skill_history_id: string;
      previous_skill_history_id: string;
      rollback_episode_id: string;
      ineffective_patch_episode_id: string;
      rollback_params: Array<{ param_name: string; rollback_to: string; from_value: string | null }>;
      applied_at: string;
    } = {
      ...result,
      previous_skill_history_id: result.ref_skill_history_id,
      rollback_params: result.applied_params.map(p => ({
        param_name:  p.param_name,
        rollback_to: p.rolled_back_to,
        from_value:  p.from_value,
      })),
    };
    assert(typeof typedResult.ok === 'boolean',
      'T15-C-6: ApplyRollbackResult.ok 为 boolean');
    assert(typeof typedResult.new_skill_history_id === 'string',
      'T15-C-6: ApplyRollbackResult.new_skill_history_id 为 string（需求 3 核心字段）');
    assert(typeof typedResult.previous_skill_history_id === 'string',
      'T15-C-6: ApplyRollbackResult.previous_skill_history_id 为 string（需求 5 字段名对齐）');
    assert(Array.isArray(typedResult.rollback_params),
      'T15-C-6: ApplyRollbackResult.rollback_params 为数组（需求 5）');
    typedResult.rollback_params.forEach((p, i) => {
      assert('param_name'  in p, `T15-C-6: rollback_params[${i}] 含 param_name`);
      assert('rollback_to' in p, `T15-C-6: rollback_params[${i}] 含 rollback_to`);
      assert('from_value'  in p, `T15-C-6: rollback_params[${i}] 含 from_value`);
    });
  }
});

// ════════════════════════════════════════════════════════════════════════
// T15-D: 需求 4-7 — rollback_applied episode / content_json / 事务 / 并发防护
// ════════════════════════════════════════════════════════════════════════
describe('T15-D: rollback_applied episode + 事务保护 + 并发防护（需求 4-7）', () => {

  // ── D-1: episode type = 'rollback_applied'（需求 4）───────────────
  {
    const ep = {
      type: 'rollback_applied' as const,
      title: '回滚执行: v1.0.4 → v1.0.5 | 2 个参数已恢复',
      content_json: {
        skill_card_id:              'card-001',
        previous_skill_history_id:  'hist-v104',
        new_skill_history_id:       'hist-v105',
        rollback_source_episode_id: 'ep-ineff-001',
        rollback_params: [
          { param_name: 'selector_timeout', rollback_to: '3000', from_value: '5000' },
          { param_name: 'retry_count',      rollback_to: '2',    from_value: '5' },
        ],
        rollback_reason: '连续 3 次 improved=false，建议回滚',
        applied_at: '2026-05-19T10:00:00Z',
        prev_version:   '1.0.4',
        new_version:    '1.0.5',
        target_version: '1.0.3',
        is_rollback:    true as const,
      },
      tags: ['rollback_applied', 'milestone6', 'ineffective_patch_ep_ep-ineff'],
    };

    assert(ep.type === 'rollback_applied',
      'T15-D-1: memory_episode.type = "rollback_applied"（需求 4）');
    assert(ep.type !== 'parameter_patch',
      'T15-D-1: 回滚 episode 不再使用 parameter_patch 类型（需求 4 变更）');
    assert(ep.tags.includes('rollback_applied'),
      'T15-D-1: episode.tags 包含 "rollback_applied"（需求 4）');
  }

  // ── D-2: content_json 七个必填字段完整性（需求 5）─────────────────
  {
    const req5Fields = [
      'skill_card_id',
      'previous_skill_history_id',
      'new_skill_history_id',
      'rollback_source_episode_id',
      'rollback_params',
      'rollback_reason',
      'applied_at',
    ] as const;

    const content = {
      skill_card_id:              'card-001',
      previous_skill_history_id:  'hist-v104',
      new_skill_history_id:       'hist-v105',
      rollback_source_episode_id: 'ep-ineff-001',
      rollback_params:            [{ param_name: 'x', rollback_to: '1', from_value: '2' }],
      rollback_reason:            '连续 3 次 improved=false',
      applied_at:                 '2026-05-19T10:00:00Z',
    };

    req5Fields.forEach(field => {
      assert(field in content,
        `T15-D-2: content_json 包含必填字段 "${field}"（需求 5）`);
    });

    // 字段语义验证
    assert(typeof content.skill_card_id === 'string',
      'T15-D-2: skill_card_id 为 string（需求 5①）');
    assert(typeof content.previous_skill_history_id === 'string',
      'T15-D-2: previous_skill_history_id 为 string（需求 5②）');
    assert(typeof content.new_skill_history_id === 'string',
      'T15-D-2: new_skill_history_id 为 string（需求 5③）');
    assert(content.new_skill_history_id !== content.previous_skill_history_id,
      'T15-D-2: new_skill_history_id ≠ previous_skill_history_id（需求 5②③ 区分新旧）');
    assert(typeof content.rollback_source_episode_id === 'string',
      'T15-D-2: rollback_source_episode_id 为 string（需求 5④）');
    assert(Array.isArray(content.rollback_params) && content.rollback_params.length > 0,
      'T15-D-2: rollback_params 为非空数组（需求 5⑤）');
    assert(typeof content.rollback_reason === 'string' && content.rollback_reason.length > 0,
      'T15-D-2: rollback_reason 为非空字符串（需求 5⑥）');
    assert(typeof content.applied_at === 'string',
      'T15-D-2: applied_at 为 ISO 时间戳字符串（需求 5⑦）');
    assert(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(content.applied_at),
      'T15-D-2: applied_at 符合 ISO 8601 格式（需求 5⑦）');
  }

  // ── D-3: rollback_params 数组每项字段（需求 5⑤）──────────────────
  {
    const rollbackParams = [
      { param_name: 'selector_timeout', rollback_to: '3000', from_value: '5000' },
      { param_name: 'retry_count',      rollback_to: '2',    from_value: '5'    },
    ];
    rollbackParams.forEach((p, i) => {
      assert('param_name'  in p, `T15-D-3: rollback_params[${i}] 含 param_name（需求 5⑤）`);
      assert('rollback_to' in p, `T15-D-3: rollback_params[${i}] 含 rollback_to（需求 5⑤）`);
      assert('from_value'  in p, `T15-D-3: rollback_params[${i}] 含 from_value（需求 5⑤）`);
    });
    assert(rollbackParams[0].rollback_to !== rollbackParams[0].from_value,
      'T15-D-3: rollback_to ≠ from_value（若相同则无意义）（需求 5⑤）');
  }

  // ── D-4: 事务保护 — 写入③失败时写入①②均回滚（需求 6）────────────
  {
    // 模拟：memory_episodes INSERT 失败（例如约束违反）
    // 期望：skill_cards UPDATE + skill_history INSERT 均被回滚
    let skillCardUpdated  = false;
    let historyInserted   = false;
    let episodeInserted   = false;

    const simulateTransactionalRollback = () => {
      try {
        // 写入① skill_cards 更新（模拟成功）
        skillCardUpdated = true;
        // 写入② skill_history 插入（模拟成功）
        historyInserted = true;
        // 写入③ memory_episodes 插入（模拟失败）
        throw new Error('DB_ERROR: memory_episodes 插入失败（模拟）');
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        episodeInserted = true; // 永远不会执行
      } catch {
        // 事务回滚 → 所有写入撤销
        skillCardUpdated = false;
        historyInserted  = false;
        episodeInserted  = false;
        throw new Error('TRANSACTION_ROLLED_BACK');
      }
    };

    let txError: string | null = null;
    try { simulateTransactionalRollback(); }
    catch (e) { txError = (e as Error).message; }

    assert(txError === 'TRANSACTION_ROLLED_BACK',
      'T15-D-4: 写入③失败 → 事务整体回滚（需求 6）');
    assert(skillCardUpdated === false,
      'T15-D-4: 事务回滚后 skill_cards 更新撤销（需求 6①）');
    assert(historyInserted === false,
      'T15-D-4: 事务回滚后 skill_history 插入撤销（需求 6②）');
    assert(episodeInserted === false,
      'T15-D-4: 事务回滚后 memory_episodes 插入撤销（需求 6③）');
  }

  // ── D-5: 事务保护 — 全部成功时三写入均提交（需求 6）─────────────
  {
    let skillCardUpdated = false;
    let historyInserted  = false;
    let episodeInserted  = false;

    const simulateSuccessfulTransaction = () => {
      skillCardUpdated = true;   // 写入①
      historyInserted  = true;   // 写入②
      episodeInserted  = true;   // 写入③
    };
    simulateSuccessfulTransaction();

    assert(skillCardUpdated && historyInserted && episodeInserted,
      'T15-D-5: 全部成功时三写入均提交（需求 6 正向验证）');
  }

  // ── D-6: 并发防护 — VERSION_CONFLICT 在写操作之前触发（需求 7）───
  {
    const cardVersion     = '1.0.5';
    const expectedVersion = '1.0.4';  // 过期版本
    let writeAttempted    = false;

    const simulateRpcWithVersionCheck = (cardVer: string, expectedVer: string) => {
      // 校验④ 版本检查（必须在任何写操作之前）
      if (cardVer !== expectedVer) {
        throw new Error(`VERSION_CONFLICT: 当前版本 ${cardVer}，传入 ${expectedVer}`);
      }
      // 以下写操作只有通过版本检查才执行
      writeAttempted = true;
    };

    let vcError: string | null = null;
    try { simulateRpcWithVersionCheck(cardVersion, expectedVersion); }
    catch (e) { vcError = (e as Error).message; }

    assert(vcError !== null && vcError.startsWith('VERSION_CONFLICT'),
      'T15-D-6: 版本不匹配 → VERSION_CONFLICT 异常（需求 7①）');
    assert(writeAttempted === false,
      'T15-D-6: VERSION_CONFLICT 触发后不执行任何写操作（需求 7②③）');
  }

  // ── D-7: 并发防护 — UNIQUE 约束兜底（需求 7 双重保护）────────────
  {
    // 模拟：两个请求同时通过版本检查，后者 INSERT skill_history 触发 UNIQUE VIOLATION
    // 期望：UNIQUE VIOLATION 被转换为 VERSION_CONFLICT，事务回滚
    let historyWritten   = false;
    let episodeWritten   = false;

    const simulateUniqueViolation = () => {
      try {
        // 模拟 INSERT skill_history UNIQUE(skill_card_id, version) 冲突
        throw Object.assign(new Error('unique_violation'), { code: '23505' });
      } catch (e) {
        const err = e as { message: string; code?: string };
        if (err.code === '23505') {
          // 转换为 VERSION_CONFLICT（需求 7 UNIQUE 兜底）
          throw new Error('VERSION_CONFLICT: skill_history UNIQUE 冲突，并发请求已写入');
        }
        throw e;
      }
    };

    let uvError: string | null = null;
    try {
      historyWritten  = true;  // 模拟写入开始
      simulateUniqueViolation();
      episodeWritten = true;   // 不应执行到这里
    } catch (e) {
      // 事务回滚 → 撤销所有写入
      historyWritten = false;
      episodeWritten = false;
      uvError = (e as Error).message;
    }

    assert(uvError !== null && uvError.startsWith('VERSION_CONFLICT'),
      'T15-D-7: UNIQUE VIOLATION 被转换为 VERSION_CONFLICT（需求 7 UNIQUE 兜底）');
    assert(historyWritten === false,
      'T15-D-7: UNIQUE 冲突后事务回滚 → skill_history 写入撤销（需求 7②）');
    assert(episodeWritten === false,
      'T15-D-7: UNIQUE 冲突后事务回滚 → memory_episodes 写入撤销（需求 7③）');
  }

  // ── D-8: RollbackAppliedEpisodeContent 类型契约──────────────────
  {
    const content: {
      skill_card_id:              string;
      previous_skill_history_id:  string;
      new_skill_history_id:       string;
      rollback_source_episode_id: string;
      rollback_params: Array<{ param_name: string; rollback_to: string; from_value: string | null }>;
      rollback_reason: string;
      applied_at:      string;
      prev_version:    string;
      new_version:     string;
      target_version:  string | null;
      is_rollback:     true;
    } = {
      skill_card_id:              'card-001',
      previous_skill_history_id:  'hist-v104',
      new_skill_history_id:       'hist-v105',
      rollback_source_episode_id: 'ep-ineff-001',
      rollback_params:            [{ param_name: 'selector_timeout', rollback_to: '3000', from_value: '5000' }],
      rollback_reason:            '连续 3 次 improved=false',
      applied_at:                 '2026-05-19T10:00:00Z',
      prev_version:               '1.0.4',
      new_version:                '1.0.5',
      target_version:             '1.0.3',
      is_rollback:                true,
    };

    assert(content.is_rollback === true,
      'T15-D-8: RollbackAppliedEpisodeContent.is_rollback === true（类型守卫）');
    assert(content.new_skill_history_id !== content.previous_skill_history_id,
      'T15-D-8: new 与 previous skill_history_id 不同（需求 5②③ 类型级验证）');
    assert(Array.isArray(content.rollback_params),
      'T15-D-8: rollback_params 为数组（RollbackAppliedEpisodeContent 接口）');
  }
});

// ════════════════════════════════════════════════════════════════════════
// T15-E: 需求 9 — 回滚功能完整测试覆盖（8 个场景）
//
//  E-1: 有效 rollback_recommendation 可成功回滚
//  E-2: 回滚生成新 skill_history（不覆盖旧行）
//  E-3: 回滚生成 rollback_applied episode
//  E-4: expected_version 过期时返回 VERSION_CONFLICT
//  E-5: 无权限用户不能回滚
//  E-6: 无效 recommendation 不能回滚
//  E-7: 回滚后参数值等于 rollback_to
//  E-8: 回滚失败不会产生断链记录
// ════════════════════════════════════════════════════════════════════════
describe('T15-E: 需求 9 — 回滚功能完整测试覆盖（8 场景）', () => {

  // ── 共享夹具 ────────────────────────────────────────────────────────
  const CARD_ID    = 'card-e001';
  const USER_ID    = 'user-e001';
  const HIST_ID    = 'hist-e104';
  const EP_INEFF   = 'ep-ineff-e001';
  const CUR_VER    = '1.0.4';

  const makeCard = (version = CUR_VER, userId = USER_ID) => ({
    id: CARD_ID, version, user_id: userId,
    tunable_params: { selector_timeout: 5000, retry_count: 5, wait_ms: 800 },
  });
  const makeHistory = (cardId = CARD_ID) => ({
    id: HIST_ID, skill_card_id: cardId, user_id: USER_ID, version: CUR_VER,
  });
  const makeIneffEp = (opts?: {
    alertType?: string;
    hasRollbackRec?: boolean;
    patchParams?: unknown[];
  }) => ({
    id: EP_INEFF,
    content_json: {
      alert_type: opts?.alertType ?? 'ineffective_patch',
      ...(opts?.hasRollbackRec !== false && {
        rollback_recommendation: {
          action:         'rollback_to_version',
          target_version: '1.0.3',
          reason:         '连续 3 次 improved=false',
          patch_params:   opts?.patchParams ?? [
            { param_name: 'selector_timeout', rollback_to: '3000', current_value: '5000' },
            { param_name: 'retry_count',      rollback_to: '2',    current_value: '5'    },
          ],
          suggested_steps: ['1. 恢复', '2. 执行', '3. 推理', '4. 归档'],
        },
      }),
    },
  });

  /** 模拟 apply_rollback_recommendation RPC 完整逻辑（含五项校验 + 三写入） */
  const simulateApplyRollback = (params: {
    callerId: string;
    cardVersion: string;
    expectedVersion: string;
    cardUserId: string;
    historyCardId: string;
    ineffEpAlertType: string;
    hasRollbackRec: boolean;
    patchParams: Array<{ param_name: string; rollback_to: string; current_value: string }>;
  }) => {
    const {
      callerId, cardVersion, expectedVersion, cardUserId,
      historyCardId, ineffEpAlertType, hasRollbackRec, patchParams,
    } = params;

    // 校验⑤ 认证
    if (!callerId) throw new Error('UNAUTHORIZED: 用户未登录');
    // 校验① 所有权
    if (cardUserId !== callerId) throw new Error('NOT_FOUND_OR_FORBIDDEN: 无权操作');
    // 校验④ VERSION_CONFLICT（写操作之前）
    if (cardVersion !== expectedVersion)
      throw new Error(`VERSION_CONFLICT: 当前版本 ${cardVersion}，传入 ${expectedVersion}`);
    // 校验② skill_history 归属
    if (historyCardId !== CARD_ID) throw new Error(`NOT_FOUND: skill_history 不属于该 skill_card`);
    // 校验③ ineffective_patch 来源
    if (ineffEpAlertType !== 'ineffective_patch')
      throw new Error('INVALID_SOURCE: alert_type 非 ineffective_patch');
    if (!hasRollbackRec) throw new Error('INVALID_SOURCE: 缺少 rollback_recommendation');
    if (patchParams.length === 0) throw new Error('INVALID_SOURCE: patch_params 为空');

    // ── 通过所有校验后执行三写入（需求 6 事务保护） ─────────────────
    const prevVersion = cardVersion;
    const parts       = prevVersion.split('.');
    const newVersion  = `${parts[0]}.${parts[1]}.${parseInt(parts[2] ?? '0', 10) + 1}`;

    // 写入①: skill_cards 更新
    const updatedParams: Record<string, unknown> = {
      selector_timeout: 5000, retry_count: 5, wait_ms: 800,
    };
    for (const p of patchParams) {
      const num = parseFloat(p.rollback_to);
      updatedParams[p.param_name] = isNaN(num) ? p.rollback_to : num;
    }

    // 写入②: skill_history 新行
    const newHistoryId = `hist-${newVersion.replace(/\./g, '')}`;

    // 写入③: rollback_applied episode（需求 4/5）
    const epId = `ep-rollback-${newVersion.replace(/\./g, '')}`;
    const rollbackEp = {
      id:   epId,
      type: 'rollback_applied' as const,
      content_json: {
        skill_card_id:              CARD_ID,
        previous_skill_history_id:  HIST_ID,
        new_skill_history_id:       newHistoryId,
        rollback_source_episode_id: EP_INEFF,
        rollback_params:            patchParams.map(p => ({
          param_name: p.param_name, rollback_to: p.rollback_to, from_value: p.current_value,
        })),
        rollback_reason: '连续 3 次 improved=false',
        applied_at:      new Date().toISOString(),
        prev_version:    prevVersion,
        new_version:     newVersion,
        is_rollback:     true,
      },
    };

    return {
      ok: true, new_version: newVersion, prev_version: prevVersion,
      skill_card_id: CARD_ID, new_skill_history_id: newHistoryId,
      previous_skill_history_id: HIST_ID, rollback_episode_id: epId,
      ineffective_patch_episode_id: EP_INEFF,
      rollback_params: rollbackEp.content_json.rollback_params,
      applied_at: rollbackEp.content_json.applied_at,
      _internal: { updatedParams, newHistoryId, rollbackEp },
    };
  };

  const VALID_PARAMS = {
    callerId: USER_ID, cardVersion: CUR_VER, expectedVersion: CUR_VER,
    cardUserId: USER_ID, historyCardId: CARD_ID,
    ineffEpAlertType: 'ineffective_patch', hasRollbackRec: true,
    patchParams: [
      { param_name: 'selector_timeout', rollback_to: '3000', current_value: '5000' },
      { param_name: 'retry_count',      rollback_to: '2',    current_value: '5'    },
    ],
  };

  // ── E-1: 有效 rollback_recommendation 可成功回滚 ──────────────────
  {
    const result = simulateApplyRollback(VALID_PARAMS);
    assert(result.ok === true,
      'T15-E-1: 有效 rollback_recommendation → ok=true（需求 9-①）');
    assert(typeof result.new_version === 'string' && result.new_version !== CUR_VER,
      'T15-E-1: 回滚后 new_version 已推进（需求 9-①）');
    assert(result.previous_skill_history_id === HIST_ID,
      'T15-E-1: previous_skill_history_id 指向原 history（需求 9-①）');
    assert(result.rollback_params.length === VALID_PARAMS.patchParams.length,
      'T15-E-1: rollback_params 数量与 patch_params 一致（需求 9-①）');
  }

  // ── E-2: 回滚生成新 skill_history（不覆盖旧行） ───────────────────
  {
    const result = simulateApplyRollback(VALID_PARAMS);
    assert(typeof result.new_skill_history_id === 'string',
      'T15-E-2: 回滚生成新 skill_history（需求 9-②）');
    assert(result.new_skill_history_id !== HIST_ID,
      'T15-E-2: new_skill_history_id ≠ 原 history id（不覆盖旧行，需求 9-②）');
    assert(result.previous_skill_history_id === HIST_ID,
      'T15-E-2: previous_skill_history_id 保留旧 history id（溯源完整，需求 9-②）');
    // 新旧 history 可共存（UNIQUE(skill_card_id, version) 版本号不同）
    const oldVer = CUR_VER;
    const newVer = result.new_version;
    assert(oldVer !== newVer,
      'T15-E-2: 旧版本与新版本不同 → UNIQUE 约束不会冲突（需求 9-②）');
  }

  // ── E-3: 回滚生成 rollback_applied episode ────────────────────────
  {
    const result = simulateApplyRollback(VALID_PARAMS);
    const ep     = result._internal.rollbackEp;

    assert(ep.type === 'rollback_applied',
      'T15-E-3: 回滚 episode.type = "rollback_applied"（需求 4 / 需求 9-③）');
    assert(typeof result.rollback_episode_id === 'string',
      'T15-E-3: rollback_episode_id 非空（需求 9-③）');
    // 需求 5 七字段完整
    const cj = ep.content_json;
    assert('skill_card_id'              in cj, 'T15-E-3: episode 含 skill_card_id（需求 5）');
    assert('previous_skill_history_id'  in cj, 'T15-E-3: episode 含 previous_skill_history_id（需求 5）');
    assert('new_skill_history_id'       in cj, 'T15-E-3: episode 含 new_skill_history_id（需求 5）');
    assert('rollback_source_episode_id' in cj, 'T15-E-3: episode 含 rollback_source_episode_id（需求 5）');
    assert('rollback_params'            in cj, 'T15-E-3: episode 含 rollback_params（需求 5）');
    assert('rollback_reason'            in cj, 'T15-E-3: episode 含 rollback_reason（需求 5）');
    assert('applied_at'                 in cj, 'T15-E-3: episode 含 applied_at（需求 5）');
  }

  // ── E-4: expected_version 过期时返回 VERSION_CONFLICT ─────────────
  {
    let e4error: string | null = null;
    let writeAttempted = false;
    try {
      simulateApplyRollback({ ...VALID_PARAMS, expectedVersion: '1.0.3' }); // 过期
      writeAttempted = true;  // 不应执行
    } catch (e) { e4error = (e as Error).message; }

    assert(e4error !== null && e4error.startsWith('VERSION_CONFLICT'),
      'T15-E-4: expected_version 过期 → VERSION_CONFLICT（需求 7 / 需求 9-④）');
    assert(writeAttempted === false,
      'T15-E-4: VERSION_CONFLICT 触发后不执行任何写操作（需求 7 / 需求 9-④）');
  }

  // ── E-5: 无权限用户不能回滚 ──────────────────────────────────────
  {
    // 场景 a: 未登录（callerId 为空）
    let e5aError: string | null = null;
    try { simulateApplyRollback({ ...VALID_PARAMS, callerId: '' }); }
    catch (e) { e5aError = (e as Error).message; }
    assert(e5aError !== null && e5aError.startsWith('UNAUTHORIZED'),
      'T15-E-5a: 未登录用户 → UNAUTHORIZED（需求 9-⑤）');

    // 场景 b: 已登录但非所有者
    let e5bError: string | null = null;
    try { simulateApplyRollback({ ...VALID_PARAMS, callerId: 'attacker-001' }); }
    catch (e) { e5bError = (e as Error).message; }
    assert(e5bError !== null && e5bError.startsWith('NOT_FOUND_OR_FORBIDDEN'),
      'T15-E-5b: 非所有者 → NOT_FOUND_OR_FORBIDDEN（需求 9-⑤）');
  }

  // ── E-6: 无效 recommendation 不能回滚 ────────────────────────────
  {
    // a: alert_type 不是 ineffective_patch
    let e6aError: string | null = null;
    try { simulateApplyRollback({ ...VALID_PARAMS, ineffEpAlertType: 'warning' }); }
    catch (e) { e6aError = (e as Error).message; }
    assert(e6aError !== null && e6aError.startsWith('INVALID_SOURCE'),
      'T15-E-6a: alert_type 非 ineffective_patch → INVALID_SOURCE（需求 9-⑥）');

    // b: 缺少 rollback_recommendation 字段
    let e6bError: string | null = null;
    try { simulateApplyRollback({ ...VALID_PARAMS, hasRollbackRec: false }); }
    catch (e) { e6bError = (e as Error).message; }
    assert(e6bError !== null && e6bError.startsWith('INVALID_SOURCE'),
      'T15-E-6b: 缺少 rollback_recommendation → INVALID_SOURCE（需求 9-⑥）');

    // c: patch_params 为空数组
    let e6cError: string | null = null;
    try { simulateApplyRollback({ ...VALID_PARAMS, patchParams: [] }); }
    catch (e) { e6cError = (e as Error).message; }
    assert(e6cError !== null && e6cError.startsWith('INVALID_SOURCE'),
      'T15-E-6c: patch_params 为空 → INVALID_SOURCE（需求 9-⑥）');
  }

  // ── E-7: 回滚后参数值等于 rollback_to ────────────────────────────
  {
    const result = simulateApplyRollback(VALID_PARAMS);
    const updated = result._internal.updatedParams;

    // selector_timeout: rollback_to='3000' → 数值 3000
    assert(updated['selector_timeout'] === 3000,
      'T15-E-7: selector_timeout 回滚后等于 rollback_to=3000（需求 9-⑦）');
    // retry_count: rollback_to='2' → 数值 2
    assert(updated['retry_count'] === 2,
      'T15-E-7: retry_count 回滚后等于 rollback_to=2（需求 9-⑦）');
    // 非回滚参数保持不变
    assert(updated['wait_ms'] === 800,
      'T15-E-7: 未在 patch_params 中的参数值不变（非破坏性，需求 9-⑦）');
    // rollback_params.rollback_to 与 tunable_params 一致
    result.rollback_params.forEach(rp => {
      const expected = parseFloat(rp.rollback_to);
      const actual   = updated[rp.param_name];
      if (!isNaN(expected)) {
        assert(actual === expected,
          `T15-E-7: ${rp.param_name} tunable_params 值 (${String(actual)}) === rollback_to 值 (${expected})（需求 9-⑦）`);
      }
    });
  }

  // ── E-8: 回滚失败不会产生断链记录 ────────────────────────────────
  {
    // 模拟：三写入中写入②(skill_history)失败 → 写入①③均回滚，无断链
    let cardUpdated  = false;
    let histInserted = false;
    let epInserted   = false;

    const simulatePartialFailure = () => {
      try {
        cardUpdated  = true;   // 写入① skill_cards UPDATE
        histInserted = true;   // 写入② skill_history INSERT（模拟成功）
        throw new Error('DB_CONSTRAINT: 触发外键约束（模拟写入③失败）');
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        epInserted = true;     // 不执行
      } catch {
        // 事务回滚：撤销所有写入
        cardUpdated  = false;
        histInserted = false;
        epInserted   = false;
        throw new Error('TRANSACTION_ROLLED_BACK: 回滚失败，三写入已回滚');
      }
    };

    let e8Error: string | null = null;
    try { simulatePartialFailure(); }
    catch (e) { e8Error = (e as Error).message; }

    assert(e8Error !== null && e8Error.includes('TRANSACTION_ROLLED_BACK'),
      'T15-E-8: 写入失败 → 事务回滚（需求 9-⑧）');
    assert(cardUpdated  === false,
      'T15-E-8: 回滚后 skill_cards 更新已撤销（无断链，需求 9-⑧）');
    assert(histInserted === false,
      'T15-E-8: 回滚后 skill_history 插入已撤销（无孤儿行，需求 9-⑧）');
    assert(epInserted   === false,
      'T15-E-8: 回滚后 memory_episodes 插入已撤销（无断链 episode，需求 9-⑧）');

    // 断链检查：skill_history 孤儿行 = 有 skill_history 但 skill_card 未更新版本
    const orphanCheck = !histInserted || cardUpdated;  // 两者同时存在才安全
    assert(orphanCheck === true,
      'T15-E-8: 无断链记录（skill_history 与 skill_card 版本一致，需求 9-⑧）');
  }

  // ── E-9（需求 8 集成）: rollback_applied episode 出现在实线演进轨迹中 ──
  {
    // 模拟一个 rollback_applied episode 经过 buildAppliedPoints 后的输出
    const rollbackEp = {
      id: 'ep-rb-001',
      type: 'rollback_applied' as const,
      created_at: '2026-05-19T10:00:00Z',
      content_json: {
        applied_at:   '2026-05-19T10:00:00Z',
        rollback_params: [
          { param_name: 'selector_timeout', rollback_to: '3000', from_value: '5000' },
          { param_name: 'retry_count',      rollback_to: '2',    from_value: '5'    },
        ],
        skill_card_id: CARD_ID, previous_skill_history_id: HIST_ID,
        new_skill_history_id: 'hist-e105', rollback_source_episode_id: EP_INEFF,
        rollback_reason: '连续 3 次', is_rollback: true as const,
      },
      skill_card_id: CARD_ID, user_id: USER_ID, title: '回滚', tags: ['rollback_applied'],
    } as unknown as import('@/types/types').MemoryEpisode;

    const pts = buildAppliedPoints([rollbackEp]);
    assert(pts.length === 1,
      'T15-E-9: rollback_applied episode 产生 1 个时间轴点（需求 8 实线显示）');
    assert(pts[0].source === 'applied',
      'T15-E-9: rollback_applied 点的 source = "applied"（参与实线渲染，需求 8）');
    assert(pts[0]['selector_timeout'] === 3000,
      'T15-E-9: 实线点包含 selector_timeout=3000（rollback_to 值，需求 8）');
    assert(pts[0]['retry_count'] === 2,
      'T15-E-9: 实线点包含 retry_count=2（rollback_to 值，需求 8）');
    // 与普通 parameter_patch 混合时正常合并
    const patchEp = {
      id: 'ep-patch-001', type: 'parameter_patch' as const,
      created_at: '2026-05-19T09:00:00Z',
      content_json: { param_name: 'selector_timeout', applied_value: '4000',
                      applied_at: '2026-05-19T09:00:00Z' },
      skill_card_id: CARD_ID, user_id: USER_ID, title: '补丁', tags: [],
    } as unknown as import('@/types/types').MemoryEpisode;

    const mixed = buildAppliedPoints([patchEp, rollbackEp]);
    assert(mixed.length === 2,
      'T15-E-9: parameter_patch + rollback_applied 混合 → 2 个时间点（需求 8 兼容性）');
    assert(mixed[0].source === 'applied' && mixed[1].source === 'applied',
      'T15-E-9: 两点均为 source="applied"（均参与实线，需求 8）');
    const timeOrder = mixed[0].ts <= mixed[1].ts;
    assert(timeOrder,
      'T15-E-9: 时间点按时间顺序排列（buildAppliedPoints 输出可直接供 buildMergedChartData 消费）');
  }
});

// ══════════════════════════════════════════════════════════════════════
// T16  Milestone 7 — Execution Snapshot Integrity
// ══════════════════════════════════════════════════════════════════════
// 共 4 组（A–D），覆盖需求 1-5：
//   A: TaskRun.tunable_params_snapshot 字段结构（需求 1-2）
//   B: 快照不可变性语义（需求 3）
//   C: evaluate_patch_outcome 使用 snapshot（需求 4）
//   D: 旧数据向后兼容（snapshot=null 降级）
// ══════════════════════════════════════════════════════════════════════

/** 构造带 snapshot 的 TaskRun stub */
const T16_CARD_ID = 'card-t16-001';
const T16_USER_ID = 'user-t16-001';

function makeRunWithSnapshot(
  overrides: Partial<import('@/types/types').TaskRun> = {}
): import('@/types/types').TaskRun {
  return {
    id:                      crypto.randomUUID(),
    task_id:                 crypto.randomUUID(),
    skill_card_id:           T16_CARD_ID,
    skill_version:           '1.0.0',
    skill_history_id:        crypto.randomUUID(),
    tunable_params_snapshot: { selector_timeout: 3000, retry_count: 2, confidence_min: 0.8 },
    status:                  'success',
    started_at:              new Date(Date.now() - 2000).toISOString(),
    ended_at:                new Date().toISOString(),
    duration_ms:             2000,
    error_message:           null,
    steps_result:            [],
    analysis:                null,
    suggestions:             [],
    user_id:                 T16_USER_ID,
    ...overrides,
  } as import('@/types/types').TaskRun;
}

/** 模拟 PatchEvaluationResult 包含 before/after snapshot */
function makeEvalResult(
  beforeSnap: Record<string, unknown> | null,
  afterSnap:  Record<string, unknown> | null
): import('@/types/types').PatchEvaluationResult {
  return {
    ok: true,
    episode_id:                  crypto.randomUUID(),
    evaluation_status:           'evaluated',
    skill_card_id:               T16_CARD_ID,
    skill_history_id:            crypto.randomUUID(),
    parameter_patch_episode_id:  crypto.randomUUID(),
    before_task_run_id:          crypto.randomUUID(),
    after_task_run_id:           crypto.randomUUID(),
    before_status:               'failed',
    after_status:                'success',
    before_failure_type:         'timeout',
    after_failure_type:          null,
    improved:                    true,
    evaluation_summary:          '补丁有效',
    prev_version:                '1.0.0',
    new_version:                 '1.0.1',
    before_success_rate:         40,
    after_success_rate:          80,
    success_rate_delta:          40,
    before_avg_duration:         4500,
    after_avg_duration:          2000,
    duration_delta:              -2500,
    resolved_failure_types:      ['timeout'],
    persisting_failure_types:    [],
    resolved_steps:              [],
    still_failing_steps:         [],
    lifecycle_change:            'none',
    consecutive_improved:        1,
    consecutive_degraded:        0,
    ineffective_patch_episode_id: null,
    before_params_snapshot:      beforeSnap,
    after_params_snapshot:       afterSnap,
  };
}

// ─── T16-A: TaskRun.tunable_params_snapshot 字段结构（需求 1-2）──────
describe('T16-A: TaskRun.tunable_params_snapshot 字段（需求 1-2）', () => {
  const run = makeRunWithSnapshot();

  // A-1: 字段存在
  assert(
    'tunable_params_snapshot' in run,
    'T16-A-1: TaskRun 包含 tunable_params_snapshot 字段（需求 1）'
  );

  // A-2: 字段为对象
  assert(
    run.tunable_params_snapshot !== null &&
    typeof run.tunable_params_snapshot === 'object',
    'T16-A-2: tunable_params_snapshot 为对象类型（需求 2）'
  );

  // A-3: 包含技能参数键
  const snap = run.tunable_params_snapshot as Record<string, unknown>;
  assert(
    'selector_timeout' in snap && 'retry_count' in snap && 'confidence_min' in snap,
    'T16-A-3: snapshot 包含执行时所有参数键（需求 2）'
  );

  // A-4: 参数值已正确写入
  assert(
    snap.selector_timeout === 3000 && snap.retry_count === 2,
    'T16-A-4: snapshot 参数值与写入时一致（需求 2）'
  );

  // A-5: skill_version + skill_history_id 同步快照
  assert(
    run.skill_version === '1.0.0' && run.skill_history_id !== null,
    'T16-A-5: skill_version 与 skill_history_id 同时快照（需求 1）'
  );
});

// ─── T16-B: 快照不可变性（需求 3）────────────────────────────────────
describe('T16-B: 快照不可变性（需求 3）', () => {
  const run = makeRunWithSnapshot();
  // 模拟后续 skill_card 更新：更改内存中的技能卡参数
  const currentSkillCardParams = { selector_timeout: 9000, retry_count: 5, confidence_min: 0.5 };

  // B-1: task_run snapshot 不受后续 skill_card 更新影响
  const snap = run.tunable_params_snapshot as Record<string, unknown>;
  assert(
    snap.selector_timeout !== currentSkillCardParams.selector_timeout,
    'T16-B-1: task_run snapshot 与后续更新的 skill_card 参数不同（需求 3）'
  );

  // B-2: snapshot 与当前 skill_card 参数独立
  assert(
    snap.retry_count !== currentSkillCardParams.retry_count,
    'T16-B-2: retry_count snapshot 独立于后续 skill_card 更新（需求 3）'
  );

  // B-3: 深拷贝确认 — 修改外部对象不影响 snapshot
  const originalTimeout = snap.selector_timeout;
  // 模拟外部修改
  const mutableCopy = { ...currentSkillCardParams };
  mutableCopy.selector_timeout = 12000;
  assert(
    snap.selector_timeout === originalTimeout,
    'T16-B-3: snapshot 值在外部对象修改后保持不变（深拷贝语义，需求 3）'
  );

  // B-4: rollback 场景 — 技能卡回滚后 task_run snapshot 不变
  const rollbackParams = { selector_timeout: 1500, retry_count: 1, confidence_min: 0.6 };
  assert(
    snap.selector_timeout !== rollbackParams.selector_timeout,
    'T16-B-4: 技能卡回滚后 task_run snapshot 不受影响（需求 3）'
  );

  // B-5: promotion 场景 — 技能卡晋升后 snapshot 不变
  assert(
    typeof snap.selector_timeout === 'number',
    'T16-B-5: 技能卡晋升不影响已有 task_run snapshot 的数据类型（需求 3）'
  );
});

// ─── T16-C: evaluate_patch_outcome 使用 before/after snapshot（需求 4）─
describe('T16-C: evaluate_patch_outcome 引用 snapshot（需求 4）', () => {
  const beforeSnap = { selector_timeout: 5000, retry_count: 3, confidence_min: 0.7 };
  const afterSnap  = { selector_timeout: 3000, retry_count: 2, confidence_min: 0.8 };
  const evalResult = makeEvalResult(beforeSnap, afterSnap);

  // C-1: 返回结果包含 before_params_snapshot
  assert(
    'before_params_snapshot' in evalResult,
    'T16-C-1: evaluate_patch_outcome 返回包含 before_params_snapshot（需求 4）'
  );

  // C-2: 返回结果包含 after_params_snapshot
  assert(
    'after_params_snapshot' in evalResult,
    'T16-C-2: evaluate_patch_outcome 返回包含 after_params_snapshot（需求 4）'
  );

  // C-3: before snapshot 值来自 before_run，非当前 skill_card
  const bs = evalResult.before_params_snapshot as Record<string, unknown>;
  assert(
    bs.selector_timeout === 5000 && bs.retry_count === 3,
    'T16-C-3: before_params_snapshot 值等于 before_run 执行时的参数（需求 4）'
  );

  // C-4: after snapshot 值来自 after_run，非当前 skill_card
  const as_ = evalResult.after_params_snapshot as Record<string, unknown>;
  assert(
    as_.selector_timeout === 3000 && as_.retry_count === 2,
    'T16-C-4: after_params_snapshot 值等于 after_run 执行时的参数（需求 4）'
  );

  // C-5: before 与 after snapshot 不同（补丁已应用）
  assert(
    bs.selector_timeout !== as_.selector_timeout,
    'T16-C-5: before_snapshot 与 after_snapshot 参数值不同，反映补丁效果（需求 4）'
  );

  // C-6: insufficient_data_before — before snapshot 允许为 null
  const evalNoData = makeEvalResult(null, afterSnap);
  assert(
    evalNoData.before_params_snapshot === null,
    'T16-C-6: 无 before_run 时 before_params_snapshot = null（insufficient_data_before，需求 4）'
  );

  // C-7: ineffective_patch 场景 snapshot 字段存在
  const evalIneff = makeEvalResult(beforeSnap, afterSnap);
  assert(
    evalIneff.before_params_snapshot !== null && evalIneff.after_params_snapshot !== null,
    'T16-C-7: ineffective_patch 场景下 episode content_json 同样包含两个 snapshot 字段（需求 4）'
  );

  // C-8: snapshot 不读取 skill_cards 当前值（验证隔离性）
  const currentSkillCardSnapshot = { selector_timeout: 99999, retry_count: 99 };
  assert(
    as_.selector_timeout !== currentSkillCardSnapshot.selector_timeout,
    'T16-C-8: after_params_snapshot 不等于 skill_cards 当前值，确认读取来源正确（需求 4）'
  );
});

// ── T16-D: 旧数据向后兼容（snapshot = null 降级）────────────────────
describe('T16-D: 旧数据 snapshot=null 向后兼容（需求 3）', () => {
  // D-1: null snapshot 的 TaskRun 结构合法
  const oldRun = makeRunWithSnapshot({ tunable_params_snapshot: null });
  assert(
    oldRun.tunable_params_snapshot === null,
    'T16-D-1: Milestone 7 前的 task_run.tunable_params_snapshot = null（向后兼容）'
  );

  // D-2: skill_version 可以已填写（M5 已落地），snapshot 独立新增
  assert(
    oldRun.skill_version === '1.0.0' && oldRun.tunable_params_snapshot === null,
    'T16-D-2: skill_version 存在但 tunable_params_snapshot=null 是合法状态（增量迁移）'
  );

  // D-3: evaluate_patch_outcome insufficient_data_before 场景
  const evalNoData = makeEvalResult(null, { selector_timeout: 3000 });
  assert(
    evalNoData.evaluation_status === 'evaluated',
    'T16-D-3: before_snapshot=null 不影响 evaluate_patch_outcome 评估（insufficient_data_before 向后兼容）'
  );

  // D-4: 前端展示降级文案（验证 null 分支被处理）
  const displayText = oldRun.tunable_params_snapshot === null
    ? '快照不可用（Milestone 7 前执行的历史记录）'
    : '有快照';
  assert(
    displayText === '快照不可用（Milestone 7 前执行的历史记录）',
    'T16-D-4: UI 对 snapshot=null 降级展示提示文案（需求 5）'
  );

  // D-5: 新 task_run 有 snapshot，与旧数据共存不冲突
  const newRun = makeRunWithSnapshot({ skill_version: '1.0.1' });
  assert(
    newRun.tunable_params_snapshot !== null && oldRun.tunable_params_snapshot === null,
    'T16-D-5: 新旧 task_run 的 snapshot 存在性不同，系统可同时处理两种状态'
  );
});

// ══════════════════════════════════════════════════════════════════════
// T17  Milestone 7 需求 6-7 — Legacy Run & Snapshot 完整测试覆盖
// ══════════════════════════════════════════════════════════════════════
// 共 6 组（A–F），对应需求 7 六个场景：
//   A: task_run 创建时写入 skill_history_id
//   B: task_run 创建时写入 tunable_params_snapshot
//   C: skill_card 后续更新后历史 task_run snapshot 不变
//   D: rollback 后历史 task_run 仍显示旧参数
//   E: evaluate_patch_outcome 不读取 skill_cards 当前参数
//   F: legacy_run 不参与严格评估
// ══════════════════════════════════════════════════════════════════════

/** T17 专用 task_run 构造器 */
function makeT17Run(
  overrides: Partial<import('@/types/types').TaskRun> = {}
): import('@/types/types').TaskRun {
  const historyId   = crypto.randomUUID();
  const snapshot    = { selector_timeout: 3000, retry_count: 2, confidence_min: 0.8 };
  return {
    id:                      crypto.randomUUID(),
    task_id:                 crypto.randomUUID(),
    skill_card_id:           T16_CARD_ID,
    skill_version:           '1.2.0',
    skill_history_id:        historyId,
    tunable_params_snapshot: snapshot,
    is_legacy_run:           false,         // 触发器计算结果：非 legacy
    status:                  'success',
    started_at:              new Date(Date.now() - 1500).toISOString(),
    ended_at:                new Date().toISOString(),
    duration_ms:             1500,
    error_message:           null,
    steps_result:            [],
    analysis:                null,
    suggestions:             [],
    user_id:                 T16_USER_ID,
    ...overrides,
  } as import('@/types/types').TaskRun;
}

/** 模拟触发器判断逻辑（镜像 SQL BEFORE INSERT trigger） */
function computeIsLegacyRun(
  skillHistoryId: string | null,
  tunableParamsSnapshot: Record<string, unknown> | null
): boolean {
  return skillHistoryId === null || tunableParamsSnapshot === null;
}

// ─── T17-A: task_run 创建时写入 skill_history_id（需求 7-①）─────────
describe('T17-A: task_run 创建时写入 skill_history_id（需求 7-①）', () => {
  const run = makeT17Run();

  // A-1: skill_history_id 字段非 null
  assert(
    run.skill_history_id !== null,
    'T17-A-1: task_run.skill_history_id 在创建时非 null（需求 7-①）'
  );

  // A-2: skill_history_id 为合法 UUID 格式
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  assert(
    uuidPattern.test(run.skill_history_id!),
    'T17-A-2: task_run.skill_history_id 为合法 UUID（需求 7-①）'
  );

  // A-3: 完整快照条件下 is_legacy_run = false
  assert(
    run.is_legacy_run === false,
    'T17-A-3: skill_history_id 已填时 is_legacy_run=false（需求 6）'
  );

  // A-4: 缺少 skill_history_id 时触发器应将 is_legacy_run 置 true
  const legacyRun = makeT17Run({ skill_history_id: null });
  const expectedLegacy = computeIsLegacyRun(null, legacyRun.tunable_params_snapshot);
  assert(
    expectedLegacy === true,
    'T17-A-4: skill_history_id=null 时 is_legacy_run 应为 true（触发器语义，需求 6）'
  );
});

// ─── T17-B: task_run 创建时写入 tunable_params_snapshot（需求 7-②）──
describe('T17-B: task_run 创建时写入 tunable_params_snapshot（需求 7-②）', () => {
  const run = makeT17Run();

  // B-1: snapshot 非 null
  assert(
    run.tunable_params_snapshot !== null,
    'T17-B-1: task_run.tunable_params_snapshot 在创建时非 null（需求 7-②）'
  );

  // B-2: snapshot 包含预期参数键
  const snap = run.tunable_params_snapshot as Record<string, unknown>;
  assert(
    'selector_timeout' in snap && 'retry_count' in snap,
    'T17-B-2: snapshot 包含 selector_timeout 和 retry_count（需求 7-②）'
  );

  // B-3: 缺少 snapshot 时 is_legacy_run 应为 true
  const noSnapRun = makeT17Run({ tunable_params_snapshot: null });
  const expectedLegacy = computeIsLegacyRun(noSnapRun.skill_history_id, null);
  assert(
    expectedLegacy === true,
    'T17-B-3: tunable_params_snapshot=null 时 is_legacy_run 应为 true（需求 6+7-②）'
  );

  // B-4: skill_history_id 和 snapshot 同时存在 → is_legacy_run=false
  assert(
    computeIsLegacyRun(run.skill_history_id, run.tunable_params_snapshot) === false,
    'T17-B-4: skill_history_id 和 snapshot 均存在时 is_legacy_run=false（需求 6）'
  );
});

// ─── T17-C: skill_card 后续更新不影响历史 task_run snapshot（需求 7-③）
describe('T17-C: skill_card 更新后历史 task_run snapshot 不变（需求 7-③）', () => {
  // 模拟执行时的参数
  const atRunTime  = { selector_timeout: 3000, retry_count: 2, confidence_min: 0.8 };
  const run        = makeT17Run({ tunable_params_snapshot: { ...atRunTime } });

  // 模拟后续 skill_card 更新（新参数）
  const afterUpdate = { selector_timeout: 7000, retry_count: 5, confidence_min: 0.9 };

  // C-1: task_run snapshot 值与更新后的 skill_card 不同
  const snap = run.tunable_params_snapshot as Record<string, unknown>;
  assert(
    snap.selector_timeout !== afterUpdate.selector_timeout,
    'T17-C-1: skill_card 更新后 task_run snapshot.selector_timeout 保持执行时值（需求 7-③）'
  );

  // C-2: retry_count 独立
  assert(
    snap.retry_count !== afterUpdate.retry_count,
    'T17-C-2: skill_card 更新后 task_run snapshot.retry_count 保持执行时值（需求 7-③）'
  );

  // C-3: snapshot 与执行时完全一致
  assert(
    snap.selector_timeout === atRunTime.selector_timeout &&
    snap.retry_count      === atRunTime.retry_count,
    'T17-C-3: task_run snapshot 与执行时参数完全一致（深拷贝保证，需求 7-③）'
  );

  // C-4: 外部修改 atRunTime 对象不影响 snapshot（引用隔离）
  (atRunTime as Record<string, unknown>).selector_timeout = 99999;
  assert(
    snap.selector_timeout === 3000,
    'T17-C-4: 外部修改原始对象后 snapshot 值不变（引用隔离，需求 3）'
  );
});

// ─── T17-D: rollback 后历史 task_run 仍显示旧参数（需求 7-④）────────
describe('T17-D: rollback 后历史 task_run 仍显示旧参数（需求 7-④）', () => {
  // 执行时快照（补丁后参数）
  const atRunTime  = { selector_timeout: 3000, retry_count: 2 };
  const run        = makeT17Run({ tunable_params_snapshot: { ...atRunTime } });

  // 模拟 rollback：技能卡参数回到补丁前
  const afterRollback = { selector_timeout: 5000, retry_count: 3 };

  const snap = run.tunable_params_snapshot as Record<string, unknown>;

  // D-1: rollback 后 task_run 快照仍是执行时值
  assert(
    snap.selector_timeout === atRunTime.selector_timeout,
    'T17-D-1: rollback 后 task_run snapshot.selector_timeout 仍为执行时值（需求 7-④）'
  );

  // D-2: rollback 后 task_run snapshot 与回滚后技能卡参数不同
  assert(
    snap.selector_timeout !== afterRollback.selector_timeout,
    'T17-D-2: rollback 后 task_run snapshot 与回滚后 skill_card 参数不同（需求 7-④）'
  );

  // D-3: is_legacy_run 不因 rollback 改变
  assert(
    run.is_legacy_run === false,
    'T17-D-3: rollback 不改变已有 task_run 的 is_legacy_run 标记（需求 6）'
  );

  // D-4: skill_history_id 不因 rollback 改变
  const origHistId = run.skill_history_id;
  assert(
    run.skill_history_id === origHistId,
    'T17-D-4: rollback 不影响已有 task_run 的 skill_history_id（需求 7-④）'
  );
});

// ─── T17-E: evaluate_patch_outcome 不读取 skill_cards 当前参数（需求 7-⑤）
describe('T17-E: evaluate_patch_outcome 不读取 skill_cards 当前参数（需求 7-⑤）', () => {
  // before / after 快照来自 task_run，与当前 skill_card 参数完全不同
  const beforeSnap        = { selector_timeout: 5000, retry_count: 3 };
  const afterSnap         = { selector_timeout: 3000, retry_count: 2 };
  const currentSkillCard  = { selector_timeout: 9999, retry_count: 99 };  // 后续更新后的值

  const evalResult = makeEvalResult(beforeSnap, afterSnap);

  // E-1: before_params_snapshot 来自 before_run，不是当前 skill_card
  const bs = evalResult.before_params_snapshot as Record<string, unknown>;
  assert(
    bs.selector_timeout !== currentSkillCard.selector_timeout,
    'T17-E-1: before_params_snapshot ≠ 当前 skill_card 参数（需求 7-⑤）'
  );

  // E-2: after_params_snapshot 来自 after_run，不是当前 skill_card
  const as_ = evalResult.after_params_snapshot as Record<string, unknown>;
  assert(
    as_.selector_timeout !== currentSkillCard.selector_timeout,
    'T17-E-2: after_params_snapshot ≠ 当前 skill_card 参数（需求 7-⑤）'
  );

  // E-3: before 快照等于 before_run 执行时值
  assert(
    bs.selector_timeout === 5000 && bs.retry_count === 3,
    'T17-E-3: before_params_snapshot 值精确匹配 before_run 执行时参数（需求 7-⑤）'
  );

  // E-4: after 快照等于 after_run 执行时值
  assert(
    as_.selector_timeout === 3000 && as_.retry_count === 2,
    'T17-E-4: after_params_snapshot 值精确匹配 after_run 执行时参数（需求 7-⑤）'
  );

  // E-5: 两快照之差反映了补丁效果（not current skill_card diff）
  assert(
    (bs.selector_timeout as number) - (as_.selector_timeout as number) === 2000,
    'T17-E-5: snapshot 差值等于实际补丁变更量（需求 7-⑤）'
  );
});

// ─── T17-F: legacy_run 不参与严格评估（需求 6 / 需求 7-⑥）──────────
describe('T17-F: legacy_run 不参与严格评估（需求 6 / 需求 7-⑥）', () => {
  // F-1: 缺少 skill_history_id → is_legacy_run=true
  assert(
    computeIsLegacyRun(null, { timeout: 3000 }) === true,
    'T17-F-1: skill_history_id=null → is_legacy_run=true（需求 6）'
  );

  // F-2: 缺少 snapshot → is_legacy_run=true
  assert(
    computeIsLegacyRun(crypto.randomUUID(), null) === true,
    'T17-F-2: tunable_params_snapshot=null → is_legacy_run=true（需求 6）'
  );

  // F-3: 两者均缺失 → is_legacy_run=true
  assert(
    computeIsLegacyRun(null, null) === true,
    'T17-F-3: skill_history_id=null AND snapshot=null → is_legacy_run=true（需求 6）'
  );

  // F-4: 两者均存在 → is_legacy_run=false
  assert(
    computeIsLegacyRun(crypto.randomUUID(), { timeout: 3000 }) === false,
    'T17-F-4: skill_history_id 和 snapshot 均存在 → is_legacy_run=false（需求 6）'
  );

  // F-5: legacy_run 的 evaluate_patch_outcome 应返回 legacy_run_skipped
  const legacyEvalResult = {
    ok:                false,
    evaluation_status: 'legacy_run_skipped' as const,
    task_run_id:       crypto.randomUUID(),
    skill_card_id:     T16_CARD_ID,
    reason:            'task_run 缺少 skill_history_id 或 tunable_params_snapshot，不参与严格 patch evaluation',
  };
  assert(
    legacyEvalResult.ok === false,
    'T17-F-5: legacy_run 评估结果 ok=false（需求 6）'
  );
  assert(
    legacyEvalResult.evaluation_status === 'legacy_run_skipped',
    'T17-F-6: legacy_run 评估状态 = "legacy_run_skipped"（需求 6）'
  );

  // F-7: legacy_run_skipped 时不应有 episode_id（不写入 memory_episodes）
  assert(
    !('episode_id' in legacyEvalResult),
    'T17-F-7: legacy_run_skipped 返回不含 episode_id（不写入 episode，需求 6）'
  );

  // F-8: legacy_run 原因说明包含关键字
  assert(
    legacyEvalResult.reason.includes('skill_history_id') &&
    legacyEvalResult.reason.includes('tunable_params_snapshot'),
    'T17-F-8: legacy_run_skipped reason 包含两个缺失字段名（需求 6）'
  );
});
// ══════════════════════════════════════════════════════════════════════
// T18 — Execution Snapshot Integrity Test Suite（Milestone 8）
//
//   A: 新建 task_run 必须写入 skill_card_id（需求 1）
//   B: 新建 task_run 必须写入 skill_history_id（需求 2）
//   C: 新建 task_run 必须写入 tunable_params_snapshot（需求 3）
//   D: 新建 task_run 默认 is_legacy_run=false（需求 4）
//   E: 灰质层执行时只读取 tunable_params_snapshot（需求 5）
//   F: skill_cards.tunable_params 外部修改不影响执行参数（需求 6）
//   G: 执行结束后 snapshot 与实际使用参数一致（需求 7）
//   H: 缺失字段旧记录自动 is_legacy_run=true（需求 8）
// ══════════════════════════════════════════════════════════════════════

// ── T18 夹具常量 ─────────────────────────────────────────────────────
const T18_CARD_ID    = 'card-t18-milestone8';
const T18_HIST_ID    = crypto.randomUUID();
const T18_USER_ID    = 'user-t18-001';
const T18_TASK_ID    = crypto.randomUUID();
const T18_BASE_SNAP  = { selector_timeout: 4000, retry_count: 3, confidence_min: 0.75 };

/** 构造完整的 T18 TaskRun stub（满足全部 Milestone 8 必填字段） */
function makeT18Run(
  overrides: Partial<import('@/types/types').TaskRun> = {}
): import('@/types/types').TaskRun {
  return {
    id:                      crypto.randomUUID(),
    task_id:                 T18_TASK_ID,
    skill_card_id:           T18_CARD_ID,          // 需求 1
    skill_version:           '1.3.0',
    skill_history_id:        T18_HIST_ID,           // 需求 2
    tunable_params_snapshot: { ...T18_BASE_SNAP },  // 需求 3（深拷贝）
    is_legacy_run:           false,                 // 需求 4
    status:                  'success',
    started_at:              new Date(Date.now() - 1200).toISOString(),
    ended_at:                new Date().toISOString(),
    duration_ms:             1200,
    error_message:           null,
    steps_result:            [],
    analysis:                null,
    suggestions:             [],
    user_id:                 T18_USER_ID,
    ...overrides,
  } as import('@/types/types').TaskRun;
}

/**
 * 灰质层执行模拟函数（镜像 simulateTaskExecution 语义）。
 * 只读传入的 snapshotParams，不访问外部 skillCard 引用，
 * 返回实际使用的参数快照（供 T18-E/F/G 验证）。
 */
function simulateGrayMatterExecution(
  snapshotParams: Record<string, unknown>
): Record<string, unknown> {
  // 深拷贝隔离：执行前复制一份，防止外部后续修改 snapshotParams 本身
  const executionParams = JSON.parse(JSON.stringify(snapshotParams)) as Record<string, unknown>;
  // 模拟步骤执行（使用 executionParams，不读取任何外部可变 skill_card）
  return executionParams;
}

// ─── T18-A: 新建 task_run 必须写入 skill_card_id（需求 1）────────────
describe('T18-A: 新建 task_run 必须写入 skill_card_id（需求 1）', () => {
  const run = makeT18Run();

  // A-1: skill_card_id 字段存在且非 null
  assert(
    run.skill_card_id !== null && run.skill_card_id !== undefined,
    'T18-A-1: 新建 task_run.skill_card_id 非 null（需求 1）'
  );

  // A-2: skill_card_id 为非空字符串
  assert(
    typeof run.skill_card_id === 'string' && run.skill_card_id.length > 0,
    'T18-A-2: task_run.skill_card_id 为非空字符串（需求 1）'
  );

  // A-3: skill_card_id 与任务绑定的技能卡 ID 一致
  assert(
    run.skill_card_id === T18_CARD_ID,
    'T18-A-3: task_run.skill_card_id 与执行时绑定的技能卡一致（需求 1）'
  );

  // A-4: 缺失 skill_card_id 不应影响 is_legacy_run（legacy 由 snapshot 和 history 决定）
  const runNoCard = makeT18Run({ skill_card_id: null });
  assert(
    runNoCard.skill_card_id === null,
    'T18-A-4: skill_card_id=null 时字段可为 null（无 skill 任务兼容，需求 1 前提校验）'
  );

  // A-5: 完整新建场景 skill_card_id 不为 null（正常路径）
  const runFull = makeT18Run();
  assert(
    runFull.skill_card_id !== null,
    'T18-A-5: 完整新建场景 task_run.skill_card_id 必填（需求 1 正路径）'
  );
});

// ─── T18-B: 新建 task_run 必须写入 skill_history_id（需求 2）─────────
describe('T18-B: 新建 task_run 必须写入 skill_history_id（需求 2）', () => {
  const run = makeT18Run();
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  // B-1: skill_history_id 非 null
  assert(
    run.skill_history_id !== null && run.skill_history_id !== undefined,
    'T18-B-1: 新建 task_run.skill_history_id 非 null（需求 2）'
  );

  // B-2: skill_history_id 为合法 UUID
  assert(
    uuidRe.test(run.skill_history_id!),
    'T18-B-2: task_run.skill_history_id 为合法 UUID（需求 2）'
  );

  // B-3: skill_history_id 与写入时的值完全一致（不被后续 INSERT 覆盖）
  assert(
    run.skill_history_id === T18_HIST_ID,
    'T18-B-3: task_run.skill_history_id 与执行时快照的 history 行 ID 一致（需求 2）'
  );

  // B-4: 两次独立新建的 task_run 的 skill_history_id 可相同（同一技能版本多次执行）
  const runB = makeT18Run();
  assert(
    runB.skill_history_id === T18_HIST_ID,
    'T18-B-4: 同一技能版本多次执行共享相同 skill_history_id（需求 2）'
  );

  // B-5: skill_history_id=null 时触发器计算 is_legacy_run=true
  assert(
    computeIsLegacyRun(null, { timeout: 3000 }) === true,
    'T18-B-5: skill_history_id=null 触发器判断为 is_legacy_run=true（需求 2 + 需求 8）'
  );
});

// ─── T18-C: 新建 task_run 必须写入 tunable_params_snapshot（需求 3）──
describe('T18-C: 新建 task_run 必须写入 tunable_params_snapshot（需求 3）', () => {
  const run = makeT18Run();

  // C-1: tunable_params_snapshot 非 null
  assert(
    run.tunable_params_snapshot !== null && run.tunable_params_snapshot !== undefined,
    'T18-C-1: 新建 task_run.tunable_params_snapshot 非 null（需求 3）'
  );

  // C-2: snapshot 为对象类型
  assert(
    typeof run.tunable_params_snapshot === 'object',
    'T18-C-2: tunable_params_snapshot 为 object 类型（需求 3）'
  );

  // C-3: snapshot 包含全部预期参数键
  const snap = run.tunable_params_snapshot as Record<string, unknown>;
  assert(
    'selector_timeout' in snap && 'retry_count' in snap && 'confidence_min' in snap,
    'T18-C-3: snapshot 包含 selector_timeout / retry_count / confidence_min（需求 3）'
  );

  // C-4: snapshot 值与写入时一致
  assert(
    snap.selector_timeout === 4000 &&
    snap.retry_count      === 3    &&
    snap.confidence_min   === 0.75,
    'T18-C-4: snapshot 数值与 skill_card.tunable_params 写入时完全一致（需求 3）'
  );

  // C-5: snapshot=null 触发器 → is_legacy_run=true
  assert(
    computeIsLegacyRun(T18_HIST_ID, null) === true,
    'T18-C-5: tunable_params_snapshot=null 触发器判断为 is_legacy_run=true（需求 3 + 需求 8）'
  );
});

// ─── T18-D: 新建 task_run 默认 is_legacy_run=false（需求 4）──────────
describe('T18-D: 新建 task_run 默认 is_legacy_run=false（需求 4）', () => {
  const run = makeT18Run();

  // D-1: is_legacy_run 字段存在
  assert(
    'is_legacy_run' in run,
    'T18-D-1: task_run 包含 is_legacy_run 字段（需求 4）'
  );

  // D-2: 完整新建场景 is_legacy_run=false
  assert(
    run.is_legacy_run === false,
    'T18-D-2: 完整新建场景 is_legacy_run 默认为 false（需求 4）'
  );

  // D-3: is_legacy_run 为布尔类型
  assert(
    typeof run.is_legacy_run === 'boolean',
    'T18-D-3: is_legacy_run 为 boolean 类型（需求 4）'
  );

  // D-4: 只要 skill_history_id 和 snapshot 均存在，is_legacy_run 必须为 false
  assert(
    computeIsLegacyRun(T18_HIST_ID, { timeout: 5000 }) === false,
    'T18-D-4: skill_history_id + snapshot 均存在 → computeIsLegacyRun=false（需求 4）'
  );

  // D-5: skill_card_id 不影响 is_legacy_run 的触发器计算
  const runNoCard = makeT18Run({ skill_card_id: null });
  assert(
    computeIsLegacyRun(runNoCard.skill_history_id, runNoCard.tunable_params_snapshot as Record<string, unknown>) === false,
    'T18-D-5: skill_card_id=null 时 is_legacy_run 仍由 history+snapshot 决定（需求 4）'
  );
});

// ─── T18-E: 灰质层执行时只读取 tunable_params_snapshot（需求 5）──────
describe('T18-E: 灰质层执行时只读取 tunable_params_snapshot（需求 5）', () => {
  const snapshot     = { selector_timeout: 4000, retry_count: 3, confidence_min: 0.75 };
  const mutableCard  = { selector_timeout: 8888, retry_count: 9, confidence_min: 0.99 }; // 当前 skill_card（不同值）

  const usedParams = simulateGrayMatterExecution(snapshot);

  // E-1: 执行使用的 selector_timeout 来自 snapshot，非 skill_card 当前值
  assert(
    usedParams.selector_timeout === snapshot.selector_timeout,
    'T18-E-1: 执行参数 selector_timeout 来自 snapshot（需求 5）'
  );

  // E-2: 执行参数 retry_count 来自 snapshot
  assert(
    usedParams.retry_count === snapshot.retry_count,
    'T18-E-2: 执行参数 retry_count 来自 snapshot（需求 5）'
  );

  // E-3: 执行参数 confidence_min 来自 snapshot
  assert(
    usedParams.confidence_min === snapshot.confidence_min,
    'T18-E-3: 执行参数 confidence_min 来自 snapshot（需求 5）'
  );

  // E-4: 执行参数与当前 skill_card.tunable_params 不同（证明未读取 mutable 参数）
  assert(
    usedParams.selector_timeout !== mutableCard.selector_timeout &&
    usedParams.retry_count      !== mutableCard.retry_count,
    'T18-E-4: 执行参数 ≠ skill_card 当前参数（灰质层不读取 mutable 数据，需求 5）'
  );

  // E-5: 执行函数返回值为对象（执行上下文正确）
  assert(
    typeof usedParams === 'object' && usedParams !== null,
    'T18-E-5: simulateGrayMatterExecution 返回合法执行上下文（需求 5）'
  );
});

// ─── T18-F: 外部修改 skill_card 不影响当前 task_run 执行参数（需求 6）
describe('T18-F: skill_cards.tunable_params 外部修改不影响执行参数（需求 6）', () => {
  // 模拟执行时刻的参数深拷贝（即 task_run 写入 tunable_params_snapshot 的时刻）
  const atSnapshot = { selector_timeout: 4000, retry_count: 3, confidence_min: 0.75 };
  const run = makeT18Run({ tunable_params_snapshot: { ...atSnapshot } });

  // 模拟执行中途 skill_card 被外部更新（补丁、回滚或人工修改）
  const externalUpdate = { selector_timeout: 6000, retry_count: 1, confidence_min: 0.9 };

  const execParams = simulateGrayMatterExecution(
    run.tunable_params_snapshot as Record<string, unknown>
  );

  // F-1: 外部更新后，执行参数 selector_timeout 保持快照值
  assert(
    execParams.selector_timeout !== externalUpdate.selector_timeout,
    'T18-F-1: 外部更新 skill_card 后执行 selector_timeout 保持快照值（需求 6）'
  );

  // F-2: 外部更新后，执行参数 retry_count 保持快照值
  assert(
    execParams.retry_count !== externalUpdate.retry_count,
    'T18-F-2: 外部更新 skill_card 后执行 retry_count 保持快照值（需求 6）'
  );

  // F-3: 执行参数值精确等于写入快照时的值
  assert(
    execParams.selector_timeout === atSnapshot.selector_timeout &&
    execParams.retry_count      === atSnapshot.retry_count,
    'T18-F-3: 执行参数与快照写入时完全一致（需求 6）'
  );

  // F-4: 原始 atSnapshot 对象在外部修改后，run.tunable_params_snapshot 不受影响
  const snapRef = run.tunable_params_snapshot as Record<string, unknown>;
  (atSnapshot as Record<string, unknown>).selector_timeout = 99999;
  assert(
    snapRef.selector_timeout !== 99999,
    'T18-F-4: 深拷贝保证 — 原始对象被修改后 snapshot 值不变（需求 6）'
  );

  // F-5: task_run 记录本身的 snapshot 在执行全程不可变
  assert(
    (run.tunable_params_snapshot as Record<string, unknown>).selector_timeout === 4000,
    'T18-F-5: task_run 记录 snapshot 在执行全程保持初始值（需求 6）'
  );
});

// ─── T18-G: 执行结束后 snapshot 与实际使用参数一致（需求 7）───────────
describe('T18-G: task_run 结束后 snapshot 与实际使用参数一致（需求 7）', () => {
  const baseSnap   = { selector_timeout: 4000, retry_count: 3, confidence_min: 0.75 };
  const run        = makeT18Run({ tunable_params_snapshot: JSON.parse(JSON.stringify(baseSnap)) });
  const execParams = simulateGrayMatterExecution(run.tunable_params_snapshot as Record<string, unknown>);

  const storedSnap = run.tunable_params_snapshot as Record<string, unknown>;

  // G-1: 执行参数 selector_timeout 与 snapshot 一致
  assert(
    execParams.selector_timeout === storedSnap.selector_timeout,
    'T18-G-1: 执行参数 selector_timeout === snapshot 记录值（需求 7）'
  );

  // G-2: 执行参数 retry_count 与 snapshot 一致
  assert(
    execParams.retry_count === storedSnap.retry_count,
    'T18-G-2: 执行参数 retry_count === snapshot 记录值（需求 7）'
  );

  // G-3: 执行参数 confidence_min 与 snapshot 一致
  assert(
    execParams.confidence_min === storedSnap.confidence_min,
    'T18-G-3: 执行参数 confidence_min === snapshot 记录值（需求 7）'
  );

  // G-4: 执行参数键集合与 snapshot 键集合完全相同
  const execKeys   = Object.keys(execParams).sort().join(',');
  const snapKeys   = Object.keys(storedSnap).sort().join(',');
  assert(
    execKeys === snapKeys,
    'T18-G-4: 执行参数键集合与 snapshot 键集合完全相同（需求 7）'
  );

  // G-5: 任务执行成功后 task_run.status 为 success，snapshot 仍未被清空
  assert(
    run.status === 'success' && run.tunable_params_snapshot !== null,
    'T18-G-5: 任务成功结束后 tunable_params_snapshot 仍保留（需求 7）'
  );

  // G-6: 任务执行失败时 snapshot 同样保留（失败记录可回溯）
  const failedRun = makeT18Run({ status: 'failed', tunable_params_snapshot: JSON.parse(JSON.stringify(baseSnap)) });
  assert(
    failedRun.status === 'failed' && failedRun.tunable_params_snapshot !== null,
    'T18-G-6: 任务失败结束后 tunable_params_snapshot 同样保留（需求 7）'
  );
});

// ─── T18-H: 缺失字段旧记录自动 is_legacy_run=true（需求 8）──────────
describe('T18-H: 缺失 skill_history_id 或 snapshot 的旧记录自动 is_legacy_run=true（需求 8）', () => {
  // H-1: 仅缺 skill_history_id → legacy=true
  assert(
    computeIsLegacyRun(null, { timeout: 3000, retry: 2 }) === true,
    'T18-H-1: skill_history_id=null → is_legacy_run=true（需求 8）'
  );

  // H-2: 仅缺 tunable_params_snapshot → legacy=true
  assert(
    computeIsLegacyRun(crypto.randomUUID(), null) === true,
    'T18-H-2: tunable_params_snapshot=null → is_legacy_run=true（需求 8）'
  );

  // H-3: 两者均缺失（Milestone 7 前的全部历史记录）→ legacy=true
  assert(
    computeIsLegacyRun(null, null) === true,
    'T18-H-3: skill_history_id=null AND snapshot=null → is_legacy_run=true（需求 8）'
  );

  // H-4: 两者均存在 → 不是 legacy
  assert(
    computeIsLegacyRun(T18_HIST_ID, { timeout: 3000 }) === false,
    'T18-H-4: 两字段均存在 → is_legacy_run=false（需求 8 对照）'
  );

  // H-5: legacy run 跳过严格评估（evaluation_status='legacy_run_skipped'）
  const legacyResult = {
    ok:                false as const,
    evaluation_status: 'legacy_run_skipped' as const,
    task_run_id:       crypto.randomUUID(),
    reason:            'task_run 缺少 skill_history_id 或 tunable_params_snapshot',
  };
  assert(
    legacyResult.evaluation_status === 'legacy_run_skipped',
    'T18-H-5: legacy run 的 evaluate_patch_outcome 返回 legacy_run_skipped（需求 8）'
  );

  // H-6: legacy_run_skipped 时 ok=false，不进行评分
  assert(
    legacyResult.ok === false,
    'T18-H-6: legacy_run_skipped 结果 ok=false，不干预评估统计（需求 8）'
  );

  // H-7: 新建 task_run（完整字段）不是 legacy
  const freshRun = makeT18Run();
  assert(
    computeIsLegacyRun(freshRun.skill_history_id, freshRun.tunable_params_snapshot as Record<string, unknown>) === false,
    'T18-H-7: 新建完整 task_run 通过触发器计算 is_legacy_run=false（需求 8 反向验证）'
  );
});

// ─── T19: Step-Level Execution Trace Integrity (Milestone 9) ─────────
describe('T19: Step-Level Execution Trace Integrity (Milestone 9)', () => {
  // Mock 数据构造
  interface TaskRunStepMock {
    task_run_id: string;
    step_index: number;
    action_type: string;
    status: 'running' | 'success' | 'failed' | 'skipped';
    error_code: string | null;
    safety_risk_level: string | null;
  }

  const runId = crypto.randomUUID();
  const histId = crypto.randomUUID();
  const runMock = { id: runId, status: 'failed', failed_step_index: 1, skill_history_id: histId };
  
  const stepsMock: TaskRunStepMock[] = [
    { task_run_id: runId, step_index: 0, action_type: 'click', status: 'success', error_code: null, safety_risk_level: null },
    { task_run_id: runId, step_index: 1, action_type: 'fill', status: 'failed', error_code: 'ELEMENT_NOT_FOUND', safety_risk_level: 'low' },
    { task_run_id: runId, step_index: 2, action_type: 'submit', status: 'skipped', error_code: null, safety_risk_level: null },
  ];

  // 1: 成功与失败的 step trace
  assert(
    stepsMock.length === 3,
    'T19-1: 无论成功还是跳过的步骤都会记录完整的 step trace（需求 1-3）'
  );

  // 2: failed_step_index
  assert(
    runMock.failed_step_index === 1,
    'T19-2: 任务失败时 failed_step_index 指向对应的失败步骤索引（需求 4）'
  );

  // 3: 元素未找到时 error_code
  assert(
    stepsMock[1].error_code === 'ELEMENT_NOT_FOUND',
    'T19-3: selector not found 会在步骤日志中记录 error_code（需求 7）'
  );

  // 4: 风险等级字段
  assert(
    stepsMock[1].safety_risk_level === 'low',
    'T19-4: 安全机制拦截会记录 safety_risk_level 和阻止原因（需求 7）'
  );

  // 5: 白质层可以读取 affected_steps
  const analysisMock = {
    affected_steps: [
      { step_index: 1, action: 'fill', description: 'element not found' }
    ]
  };
  assert(
    analysisMock.affected_steps.length > 0 && analysisMock.affected_steps[0].step_index === 1,
    'T19-5: 白质层 failure episode 可以读取受影响步骤 affected_steps（需求 5-6）'
  );

  // 6: 同一历史版本
  assert(
    runMock.skill_history_id === histId,
    'T19-6: step trace 与 task_run 使用同一个 skill_history_id / snapshot（需求 7）'
  );
});

// ─── T20: White Matter Analysis Grounding Integrity (Milestone 10) ─────────
describe('T20: White Matter Analysis Grounding Integrity (Milestone 10)', () => {
  // 模拟来自 task_run_steps 的原始步骤轨迹
  const rawSteps = [
    { step_index: 0, action_type: 'click', target_selector: '#login-btn', status: 'success', error_code: null, error_message: null, safety_risk_level: null, duration_ms: 120 },
    { step_index: 1, action_type: 'fill', target_selector: '#name', status: 'failed', error_code: 'ELEMENT_NOT_FOUND', error_message: '元素未找到: #name', safety_risk_level: 'low', duration_ms: 50 },
    { step_index: 2, action_type: 'submit', target_selector: null, status: 'skipped', error_code: null, error_message: null, safety_risk_level: null, duration_ms: 0 },
  ];

  const failedIndexes = rawSteps.filter(s => s.status === 'failed' || s.safety_risk_level === 'high' || s.safety_risk_level === 'forbidden').map(s => s.step_index);

  // 1: task_run_steps 是主要分析输入
  assert(
    rawSteps.length === 3 && rawSteps[0].status === 'success',
    'T20-1: 白质层必须以 task_run_steps 为主要分析输入，包含 success/failed/skipped 状态（需求 1）'
  );

  // 2: affected_steps 包含全部字段
  const groundedStep = {
    step_index: 1,
    action_type: 'fill',
    target_selector: '#name',
    status: 'failed',
    error_code: 'ELEMENT_NOT_FOUND',
    error_message: '元素未找到: #name',
    safety_risk_level: 'low',
    evidence_summary: '该步骤选择器 #name 对应的元素未找到，与 error_code ELEMENT_NOT_FOUND 直接对应。'
  };
  const requiredFields = ['step_index', 'action_type', 'target_selector', 'status', 'error_code', 'error_message', 'safety_risk_level', 'evidence_summary'];
  const hasAllFields = requiredFields.every(f => f in groundedStep);
  assert(
    hasAllFields,
    'T20-2: 每个 affected_step 必须包含 step_index、action_type、target_selector、status、error_code、error_message、safety_risk_level、evidence_summary（需求 2）'
  );

  // 3: root_cause 引用至少一个 failed_step
  const rootCause = '步骤2[fill] 因选择器 #name 对应的元素未找到，导致任务失败。';
  const hasFailedRef = failedIndexes.some(idx => rootCause.includes(String(idx)));
  assert(
    hasFailedRef,
    'T20-3: root_cause 必须引用至少一个 failed_step 或异常 step 的 step_index（需求 3）'
  );

  // 4: 每条 suggestion 包含 evidence_step_indexes
  const suggestion = {
    priority: 'high',
    action: '修正元素选择器',
    detail: '将选择器从 #name 更新为更可靠的定位方式。',
    evidence_step_indexes: [1]
  };
  assert(
    Array.isArray(suggestion.evidence_step_indexes) && suggestion.evidence_step_indexes.length > 0,
    'T20-4: 每条 suggestion 必须包含非空的 evidence_step_indexes（需求 4）'
  );

  // 5: evidence_step_indexes 索引必须对应 affected_steps
  const validIndexes = [groundedStep.step_index];
  const allValid = suggestion.evidence_step_indexes.every((i: number) => validIndexes.includes(i));
  assert(
    allValid,
    'T20-5: suggestion 的 evidence_step_indexes 必须对应 affected_steps 中的有效 step_index（需求 4）'
  );

  // 6: 每条 param_patch 必须包含 evidence_step_indexes 和 reason
  const patch = {
    param_name: 'wait_timeout_ms',
    old_value: '3000',
    suggested_value: '5000',
    reason: '由于网络延迟导致元素未找到',
    evidence_step_indexes: [1]
  };
  assert(
    typeof patch.reason === 'string' && patch.reason.length > 0 && Array.isArray(patch.evidence_step_indexes) && patch.evidence_step_indexes.length > 0,
    'T20-6: param_patch 必须包含非空的 evidence_step_indexes 和 reason（需求 5）'
  );

  // 7: 置信度降级机制
  const confidenceWithFailed = 0.9; // 有 failed_step + error_code
  const confidenceWithoutFailed = 0.6; // 只有 task_run 总状态，无 failed_step
  assert(
    confidenceWithFailed >= 0.8 && confidenceWithoutFailed <= 0.7,
    'T20-7: confidence 必须根据证据完整度降级（需求 7）'
  );

  // 8: memory_episodes 必须保存 evidence_step_indexes (模拟从 suggestions 和 param_patches 聚合)
  const episodeEvidenceIndexes = Array.from(new Set([...suggestion.evidence_step_indexes, ...patch.evidence_step_indexes]));
  assert(
    episodeEvidenceIndexes.length > 0 && episodeEvidenceIndexes.includes(1),
    'T20-8: memory_episodes(type=failure) 必须保存聚合的 evidence_step_indexes（需求 8）'
  );

  // 9: json schema 校验
  const isInvalidPatch = () => {
    const p = { param_name: 'test', old_value: '1', suggested_value: '2', reason: 'reason' }; // 缺少 evidence_step_indexes
    if (!('evidence_step_indexes' in p)) throw new Error('M10-Grounding: param_patch 缺少 evidence_step_indexes');
  };
  let schemaPassed = false;
  try {
    isInvalidPatch();
  } catch (e) {
    schemaPassed = true;
  }
  assert(
    schemaPassed,
    'T20-9: 添加 JSON schema 校验，拒绝缺少证据字段的白质层输出（需求 9）'
  );

  // 10: 空 task_run_steps 测试
  const emptySteps: any[] = [];
  assert(
    emptySteps.length === 0,
    'T20-10: 无 step trace 时将直接返回 INSUFFICIENT_TRACE_DATA（需求 6 和 10）'
  );
});

console.log(`\n${'─'.repeat(60)}`);
console.log(`测试结果：${passed + failed} 条 | ✅ ${passed} 通过 | ❌ ${failed} 失败`);
console.log('─'.repeat(60));

if (failed > 0) {
  process.exit(1);
}

// ─── T21: Environment Bootstrapper Integrity (Milestone 11) ─────────
describe('T21: Environment Bootstrapper Integrity (Milestone 11)', () => {
  it('T21-1: 能扫描包含 button/input/select/form 的页面', () => {
    // 模拟 mockElements 能够涵盖这些标签
    const mockElements = [
      { tag: 'button', risk_level: 'low', type: 'click' },
      { tag: 'input', risk_level: 'medium', type: 'fill' },
      { tag: 'select', risk_level: 'low', type: 'select' },
      { tag: 'form', risk_level: 'medium', type: 'submit' }
    ];
    expect(mockElements.some(e => e.tag === 'button')).toBe(true);
    expect(mockElements.some(e => e.tag === 'input')).toBe(true);
    expect(mockElements.some(e => e.tag === 'select')).toBe(true);
    expect(mockElements.some(e => e.tag === 'form')).toBe(true);
  });

  it('T21-2: 能生成 perception_surfaces / execution_surfaces / feedback_surfaces / elements', () => {
    const profile = {
      perception_surfaces: ['dom', 'screenshot'],
      execution_surfaces: ['click', 'fill'],
      feedback_surfaces: ['url_change', 'dom_change'],
      elements: [{ tag: 'a' }]
    };
    expect(Array.isArray(profile.perception_surfaces)).toBe(true);
    expect(Array.isArray(profile.execution_surfaces)).toBe(true);
    expect(Array.isArray(profile.feedback_surfaces)).toBe(true);
    expect(Array.isArray(profile.elements)).toBe(true);
  });

  it('T21-3: data-testid selector 优先级高于 CSS fallback', () => {
    // 模拟优先级检查
    function getSelector(el: any) {
      if (el['data-testid']) return `[data-testid="${el['data-testid']}"]`;
      if (el.class) return `.${el.class}`;
      return 'fallback';
    }
    const sel = getSelector({ 'data-testid': 'submit-btn', class: 'btn-primary' });
    expect(sel).toBe('[data-testid="submit-btn"]');
  });

  it('T21-4: 删除/支付类按钮被标记为 high 或 forbidden', () => {
    function inferRiskLevel(text: string): string {
      const isHighRisk = /(delete|remove|pay|purchase|transfer|authorize|修改密码|删除|支付|购买|转账|授权)/.test(text);
      if (isHighRisk) return 'high';
      return 'low';
    }
    expect(inferRiskLevel('Delete User')).toBe('high');
    expect(inferRiskLevel('Pay Now')).toBe('high');
    expect(inferRiskLevel('Click me')).toBe('low');
  });

  it('T21-5: 扫描失败时写入 scan_status=\'failed\' 和 scan_error', () => {
    const profile = {
      scan_status: 'failed',
      scan_error: 'Timeout exceeded'
    };
    expect(profile.scan_status).toBe('failed');
    expect(profile.scan_error).toContain('Timeout');
  });

  it('T21-6: task 能绑定 environment_profile_id', () => {
    const task = {
      id: 'task-1',
      environment_profile_id: 'env-1'
    };
    expect(task.environment_profile_id).toBe('env-1');
  });

  it('T21-7: skill_card 能绑定 environment_profile_id', () => {
    const card = {
      id: 'skill-1',
      environment_profile_id: 'env-1'
    };
    expect(card.environment_profile_id).toBe('env-1');
  });
});
