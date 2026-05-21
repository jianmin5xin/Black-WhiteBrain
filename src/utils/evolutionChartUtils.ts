/**
 * evolutionChartUtils — EvolutionChart 核心纯函数
 *
 * 设计契约（数据隔离规则）：
 *   - buildSuggestedPoints : 输入必须为 white_matter 类型 failure episodes
 *                            输出 sug_* 系列（虚线），绝不混入 applied 数据
 *   - buildAppliedPoints   : 输入必须为 parameter_patch 类型 applied episodes
 *                            输出 app_* 系列（实线），绝不混入 suggestion 数据
 *   - buildMergedChartData : 以 sug_/app_ 前缀严格区分两路数据，
 *                            两路数据 null 相互独立，connectNulls 无法跨路连线
 *
 * 这三条规则是"建议未应用不出现实线"的核心保证，单元测试基于此验证。
 */

import type { MemoryEpisode, WhiteMatterEpisodeContent, ParamPatch } from '@/types/types';

// ── 类型 ──────────────────────────────────────────────────────────────
export interface ParamPoint {
  ts: number;
  label: string;
  timeStr: string;
  source: 'suggested' | 'applied';
  [key: string]: number | string;
}

export type MergedRow = Record<string, number | string | null>;

// ── 版本号工具 ─────────────────────────────────────────────────────────
/**
 * 将 semver patch 段 +1，返回新版本字符串。
 * 用于 handleApplyPatch 生成 newVersion。
 *
 * @example
 * bumpPatchVersion('1.0.3') // → '1.0.4'
 * bumpPatchVersion('2.5')   // → '2.5.1'
 * bumpPatchVersion('')      // → '1.0.1'
 */
export function bumpPatchVersion(version: string): string {
  const parts = (version || '1.0.0').split('.');
  const newPatch = (parseInt(parts[2] || '0', 10) + 1).toString();
  return `${parts[0] ?? '1'}.${parts[1] ?? '0'}.${newPatch}`;
}

// ── 提取白质层分析内容 ─────────────────────────────────────────────────
export function extractWhiteMatterContent(ep: MemoryEpisode): WhiteMatterEpisodeContent | null {
  try {
    const c = ep.content_json as Record<string, unknown>;
    if (c && typeof c.confidence === 'number' && Array.isArray(c.param_patches)) {
      return c as unknown as WhiteMatterEpisodeContent;
    }
    if (c?.analysis) {
      return c.analysis as WhiteMatterEpisodeContent;
    }
    return null;
  } catch {
    return null;
  }
}

// ── 建议值时间序列（虚线数据源）─────────────────────────────────────────
/**
 * 从 failure/white_matter episodes 提取建议参数值时间序列。
 *
 * 数据隔离保证：
 *   - 输入 failureEpisodes 必须由调用方保证全部为 white_matter 类型
 *   - 输出 source='suggested'，仅参与 sug_* dataKey 渲染（虚线）
 *   - 绝不读取任何 applied_value、applied_at 字段
 */
export function buildSuggestedPoints(
  failureEpisodes: MemoryEpisode[],
  resolveParamName: (name: string) => string = n => n,
): ParamPoint[] {
  return [...failureEpisodes]
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    .map(ep => {
      const c = extractWhiteMatterContent(ep);
      const ts = new Date(ep.created_at).getTime();
      const point: ParamPoint = {
        ts,
        label: new Date(ts).toLocaleString('zh-CN', {
          month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
        }),
        timeStr: new Date(ts).toLocaleString('zh-CN'),
        source: 'suggested',
        confidence: c ? Math.round(c.confidence * 100) : 0,
      };
      c?.param_patches.forEach((p: ParamPatch) => {
        const canonicalName = resolveParamName(p.param_name);
        const num = parseFloat(p.suggested_value);
        if (!isNaN(num)) point[canonicalName] = num;
      });
      return point;
    });
}

// ── 已应用值时间序列（实线数据源）─────────────────────────────────────────
/**
 * 从 memory_episodes(type=parameter_patch | rollback_applied) 提取已应用参数值时间序列。
 *
 * 数据隔离保证：
 *   - 输入 appliedPatches 必须由调用方保证全部为 parameter_patch 或 rollback_applied 类型
 *   - 输出 source='applied'，仅参与 app_* dataKey 渲染（实线）
 *   - 绝不读取 failure episode 中的任何字段
 *
 * 两种 episode 的字段读取规则（需求 8）：
 *   parameter_patch  → content_json.param_name + applied_value（优先）/ suggested_value（回退兼容）
 *   rollback_applied → content_json.rollback_params[].{param_name, rollback_to}
 *                      rollback_to 即回滚后的落地值，在实线上显示（需求 8）
 *
 * 时间轴优先级：
 *   applied_at（精确落地时间）→ created_at（回退）
 */
export function buildAppliedPoints(
  appliedPatches: MemoryEpisode[],
  resolveParamName: (name: string) => string = n => n,
): ParamPoint[] {
  const points: ParamPoint[] = [];

  for (const ep of appliedPatches) {
    const c = ep.content_json as Record<string, unknown>;
    const appliedAt = (c.applied_at as string | undefined) ?? ep.created_at;
    const ts = new Date(appliedAt).getTime();
    const basePoint: ParamPoint = {
      ts,
      label: new Date(ts).toLocaleString('zh-CN', {
        month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
      }),
      timeStr: new Date(ts).toLocaleString('zh-CN'),
      source: 'applied',
    };

    if (ep.type === 'rollback_applied') {
      // 需求 8: 回滚 episode — 从 rollback_params[] 提取所有回滚后的落地值
      // 每个 rollback_applied episode 产生一个时间点，携带所有参数的 rollback_to 值
      const rollbackParams = c.rollback_params as Array<{
        param_name: string;
        rollback_to: string;
        from_value?: string | null;
      }> | undefined;

      if (Array.isArray(rollbackParams) && rollbackParams.length > 0) {
        const point = { ...basePoint };
        for (const rp of rollbackParams) {
          if (!rp.param_name || rp.rollback_to === undefined) continue;
          const canonicalName = resolveParamName(rp.param_name);
          const num = parseFloat(String(rp.rollback_to));
          if (!isNaN(num)) point[canonicalName] = num;
        }
        points.push(point);
      }
    } else {
      // parameter_patch: 原有逻辑（单参数，applied_value / suggested_value 回退兼容）
      const point = { ...basePoint };
      const rawParamName = c.param_name as string | undefined;
      const canonicalName = rawParamName ? resolveParamName(rawParamName) : undefined;
      const landedValue = (c.applied_value ?? c.suggested_value) as string | undefined;
      if (canonicalName && landedValue !== undefined) {
        const num = parseFloat(String(landedValue));
        if (!isNaN(num)) point[canonicalName] = num;
      }
      points.push(point);
    }
  }

  return points;
}

// ── 合并为 recharts 可消费的时间轴数据 ────────────────────────────────
/**
 * 将建议点与已应用点合并为统一时间轴，每行按 sug_/app_ 前缀双轨存储。
 *
 * 数据隔离保证：
 *   - sug_<param> 列仅由 suggestedPoints 填充（null 表示该时间点无建议）
 *   - app_<param> 列仅由 appliedPoints  填充（null 表示该时间点无落地）
 *   - 两列不会互相写入，连线（connectNulls）在两路之间不跨轨
 */
export function buildMergedChartData(
  suggestedPoints: ParamPoint[],
  appliedPoints: ParamPoint[],
  allParamOptions: string[],
): MergedRow[] {
  const merged = [
    ...suggestedPoints.map(p => ({ ts: p.ts, label: p.label })),
    ...appliedPoints.map(p => ({ ts: p.ts, label: p.label })),
  ];
  const seen = new Set<number>();
  const allTimestamps = merged
    .filter(p => { if (seen.has(p.ts)) return false; seen.add(p.ts); return true; })
    .sort((a, b) => a.ts - b.ts);

  return allTimestamps.map(({ ts, label }) => {
    const sg = suggestedPoints.find(p => p.ts === ts);
    const ap = appliedPoints.find(p => p.ts === ts);
    const base: MergedRow = { ts, label };
    allParamOptions.forEach(param => {
      // sug_ 前缀只从建议数据填充
      base[`sug_${param}`] = sg?.[param] !== undefined ? (sg[param] as number) : null;
      // app_ 前缀只从已应用数据填充
      base[`app_${param}`] = ap?.[param] !== undefined ? (ap[param] as number) : null;
    });
    return base;
  });
}

// ── param_name 归一化 ──────────────────────────────────────────────────
/**
 * 在给定技能卡 tunable_params 键列表和 alias map 中查找规范参数名。
 *
 * 优先级：① 精确匹配现有键 → ② alias map 查找 → ③ 回退原名
 *
 * @returns [canonicalName, normalizationNote]
 *   normalizationNote 为 null 时代表精确匹配，有值时代表别名解析或新参数警告
 */
export function resolveCanonicalParamName(
  paramName: string,
  existingKeys: string[],
  aliasMap: Record<string, string>,
): [string, string | null] {
  if (existingKeys.includes(paramName)) {
    return [paramName, null];
  }
  if (aliasMap[paramName]) {
    const canonical = aliasMap[paramName];
    return [canonical, `参数名已通过别名映射归一化：${paramName} → ${canonical}`];
  }
  return [
    paramName,
    `参数名 "${paramName}" 未在技能卡中找到精确匹配，已作为新参数写入。如需归一化，请在 param_alias_map 中配置别名。`,
  ];
}
