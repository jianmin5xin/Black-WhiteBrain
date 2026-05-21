// 白质层推理对比视图组件
// 功能：对比卡片列表、并排差异高亮、演进轨迹折线图
import { useState, useMemo } from 'react';
import { supabase } from '@/db/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer,
} from 'recharts';
import type { MemoryEpisode, WhiteMatterEpisodeContent, FailureType, WhiteMatterSuggestion, ParamPatch } from '@/types/types';
import {
  buildSuggestedPoints, buildAppliedPoints, buildMergedChartData,
  type ParamPoint,
} from '@/utils/evolutionChartUtils';
import {
  Brain, Search, RefreshCw, GitCompare, TrendingUp,
  CheckSquare, Square, AlertTriangle, ChevronRight,
  ArrowRight, Plus, Minus, Edit3, Loader2,
} from 'lucide-react';

// ---- 失败类型映射 ----
const FAILURE_TYPE_LABELS: Record<FailureType, string> = {
  element_not_found: '元素未找到',
  timeout: '执行超时',
  assertion_failed: '断言失败',
  navigation_error: '导航错误',
  permission_denied: '权限拒绝',
  unknown: '未知',
};

const FAILURE_TYPE_COLORS: Record<FailureType, string> = {
  element_not_found: 'text-orange-400 border-orange-400/40',
  timeout: 'text-yellow-400 border-yellow-400/40',
  assertion_failed: 'text-red-400 border-red-400/40',
  navigation_error: 'text-blue-400 border-blue-400/40',
  permission_denied: 'text-purple-400 border-purple-400/40',
  unknown: 'text-muted-foreground border-border',
};

// 从 episode 安全提取 content
function extractContent(ep: MemoryEpisode): WhiteMatterEpisodeContent | null {
  const c = ep.content_json as Partial<WhiteMatterEpisodeContent>;
  if (!c || typeof c.root_cause !== 'string') return null;
  return {
    task_run_id: c.task_run_id ?? '',
    root_cause: c.root_cause ?? '',
    failure_type: (c.failure_type as FailureType) ?? 'unknown',
    affected_steps: c.affected_steps ?? [],
    suggestions: c.suggestions ?? [],
    param_patches: c.param_patches ?? [],
    confidence: typeof c.confidence === 'number' ? c.confidence : 0,
    reasoning_summary: c.reasoning_summary ?? '',
  };
}

// ---- 差异计算工具 ----
type DiffTag = 'added' | 'removed' | 'changed' | 'same';

interface SuggestionDiff {
  tag: DiffTag;
  action: string;
  detailA?: string;
  detailB?: string;
  priority?: string;
}

interface PatchDiff {
  tag: DiffTag;
  param_name: string;
  valueA?: string;
  valueB?: string;
}

function diffSuggestions(
  a: WhiteMatterSuggestion[],
  b: WhiteMatterSuggestion[]
): SuggestionDiff[] {
  const mapA = new Map(a.map(s => [s.action, s]));
  const mapB = new Map(b.map(s => [s.action, s]));
  const allActions = [...new Set([...mapA.keys(), ...mapB.keys()])];
  return allActions.map(action => {
    const sa = mapA.get(action);
    const sb = mapB.get(action);
    if (sa && sb) {
      const changed = sa.detail !== sb.detail || sa.priority !== sb.priority;
      return { tag: changed ? 'changed' : 'same', action, detailA: sa.detail, detailB: sb.detail, priority: sb.priority };
    }
    if (sa) return { tag: 'removed', action, detailA: sa.detail, priority: sa.priority };
    return { tag: 'added', action, detailB: sb!.detail, priority: sb!.priority };
  });
}

function diffPatches(a: ParamPatch[], b: ParamPatch[]): PatchDiff[] {
  const mapA = new Map(a.map(p => [p.param_name, p]));
  const mapB = new Map(b.map(p => [p.param_name, p]));
  const allParams = [...new Set([...mapA.keys(), ...mapB.keys()])];
  return allParams.map(param_name => {
    const pa = mapA.get(param_name);
    const pb = mapB.get(param_name);
    if (pa && pb) {
      const changed = pa.suggested_value !== pb.suggested_value;
      return { tag: changed ? 'changed' : 'same', param_name, valueA: pa.suggested_value, valueB: pb.suggested_value };
    }
    if (pa) return { tag: 'removed', param_name, valueA: pa.suggested_value };
    return { tag: 'added', param_name, valueB: pb!.suggested_value };
  });
}

const DIFF_STYLES: Record<DiffTag, { bg: string; border: string; icon: React.ElementType | null; iconColor: string }> = {
  added:   { bg: 'bg-primary/8',    border: 'border-primary/40',    icon: Plus,    iconColor: 'text-primary' },
  removed: { bg: 'bg-red-400/8',    border: 'border-red-400/40',    icon: Minus,   iconColor: 'text-red-400' },
  changed: { bg: 'bg-yellow-400/8', border: 'border-yellow-400/40', icon: Edit3,   iconColor: 'text-yellow-400' },
  same:    { bg: 'bg-transparent',  border: 'border-border/40',     icon: null,    iconColor: '' },
};

// ---- 子组件：推理记录选择卡片 ----
function EpisodeCard({
  episode,
  selected,
  selectable,
  onToggle,
}: {
  episode: MemoryEpisode;
  selected: boolean;
  selectable: boolean;
  onToggle: () => void;
}) {
  const content = extractContent(episode);
  if (!content) return null;
  const ftColor = FAILURE_TYPE_COLORS[content.failure_type] ?? FAILURE_TYPE_COLORS.unknown;
  const confidence = Math.round(content.confidence * 100);

  return (
    <button
      onClick={onToggle}
      disabled={!selectable && !selected}
      className={`w-full text-left border p-3 transition-colors space-y-2
        ${selected
          ? 'border-primary/70 bg-primary/8'
          : selectable
            ? 'border-border hover:border-primary/40 hover:bg-accent'
            : 'border-border/30 opacity-40 cursor-not-allowed'
        }`}
    >
      {/* 标题行 */}
      <div className="flex items-start gap-2">
        {selected
          ? <CheckSquare className="w-4 h-4 text-primary shrink-0 mt-0.5" />
          : <Square className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />}
        <div className="flex-1 min-w-0">
          <p className="text-xs font-mono font-semibold text-foreground leading-relaxed text-balance">
            {episode.title.replace('[白质分析] ', '')}
          </p>
          <p className="text-xs font-mono text-muted-foreground mt-0.5">
            {new Date(episode.created_at).toLocaleString('zh-CN', {
              month: 'numeric', day: 'numeric',
              hour: '2-digit', minute: '2-digit',
            })}
          </p>
        </div>
      </div>

      {/* 失败类型 + 置信度 */}
      <div className="flex items-center gap-2 pl-6 flex-wrap">
        <span className={`text-xs font-mono px-1.5 py-0.5 border ${ftColor}`}>
          {FAILURE_TYPE_LABELS[content.failure_type]}
        </span>
        <span className="text-xs font-mono text-muted-foreground">
          建议 {content.suggestions.length} 条
        </span>
        <span className="text-xs font-mono text-muted-foreground">
          补丁 {content.param_patches.length} 项
        </span>
      </div>

      {/* 置信度条 */}
      <div className="pl-6 space-y-0.5">
        <div className="flex justify-between">
          <span className="text-xs font-mono text-muted-foreground">置信度</span>
          <span className={`text-xs font-mono font-bold ${confidence >= 75 ? 'text-primary' : confidence >= 50 ? 'text-yellow-400' : 'text-red-400'}`}>
            {confidence}%
          </span>
        </div>
        <Progress value={confidence} className="h-1" />
      </div>
    </button>
  );
}

// ---- 子组件：并排对比面板 ----
function ComparePanel({ episodeA, episodeB }: { episodeA: MemoryEpisode; episodeB: MemoryEpisode }) {
  const contentA = extractContent(episodeA)!;
  const contentB = extractContent(episodeB)!;
  const suggestionDiffs = diffSuggestions(contentA.suggestions, contentB.suggestions);
  const patchDiffs = diffPatches(contentA.param_patches, contentB.param_patches);

  const confA = Math.round(contentA.confidence * 100);
  const confB = Math.round(contentB.confidence * 100);
  const confDiff = confB - confA;

  return (
    <div className="space-y-4">
      {/* 对比标题 */}
      <div className="grid grid-cols-2 gap-3">
        {[episodeA, episodeB].map((ep, i) => (
          <div key={ep.id} className={`border p-2.5 ${i === 0 ? 'border-blue-400/40 bg-blue-400/5' : 'border-primary/40 bg-primary/5'}`}>
            <div className="flex items-center gap-2 mb-1">
              <span className={`text-xs font-mono font-bold px-1.5 border ${i === 0 ? 'text-blue-400 border-blue-400/40' : 'text-primary border-primary/40'}`}>
                {i === 0 ? '版本 A' : '版本 B'}
              </span>
            </div>
            <p className="text-xs font-mono text-muted-foreground">
              {new Date(ep.created_at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </p>
          </div>
        ))}
      </div>

      {/* 根本原因对比 */}
      <div className="space-y-1.5">
        <h4 className="text-xs font-mono font-bold text-foreground uppercase tracking-wider flex items-center gap-2">
          <AlertTriangle className="w-3.5 h-3.5 text-orange-400" />根本原因
        </h4>
        <div className="grid grid-cols-2 gap-2">
          <div className="border border-blue-400/30 bg-blue-400/5 p-2.5">
            <p className="text-xs font-mono text-foreground leading-relaxed text-pretty">{contentA.root_cause}</p>
          </div>
          <div className={`border p-2.5 ${contentA.root_cause === contentB.root_cause ? 'border-border bg-card/50' : 'border-primary/30 bg-primary/5'}`}>
            <p className="text-xs font-mono text-foreground leading-relaxed text-pretty">{contentB.root_cause}</p>
          </div>
        </div>
      </div>

      {/* 置信度对比 */}
      <div className="space-y-1.5">
        <h4 className="text-xs font-mono font-bold text-foreground uppercase tracking-wider">置信度变化</h4>
        <div className="flex items-center gap-3 p-3 border border-border bg-card/50">
          <div className="flex-1 space-y-1">
            <div className="flex justify-between">
              <span className="text-xs font-mono text-blue-400">版本 A</span>
              <span className="text-xs font-mono font-bold text-blue-400">{confA}%</span>
            </div>
            <Progress value={confA} className="h-1.5" />
          </div>
          <div className={`flex items-center gap-1 shrink-0 px-2 py-1 border text-xs font-mono font-bold
            ${confDiff > 0 ? 'text-primary border-primary/40 bg-primary/8' : confDiff < 0 ? 'text-red-400 border-red-400/40 bg-red-400/8' : 'text-muted-foreground border-border'}`}>
            {confDiff > 0 ? '+' : ''}{confDiff}%
          </div>
          <div className="flex-1 space-y-1">
            <div className="flex justify-between">
              <span className="text-xs font-mono text-primary">版本 B</span>
              <span className="text-xs font-mono font-bold text-primary">{confB}%</span>
            </div>
            <Progress value={confB} className="h-1.5" />
          </div>
        </div>
      </div>

      {/* 建议差异 */}
      <div className="space-y-1.5">
        <h4 className="text-xs font-mono font-bold text-foreground uppercase tracking-wider flex items-center gap-2">
          <Brain className="w-3.5 h-3.5 text-yellow-400" />
          优化建议对比
          <span className="font-normal text-muted-foreground normal-case">
            ({suggestionDiffs.filter(d => d.tag !== 'same').length} 处变化)
          </span>
        </h4>
        <div className="space-y-1.5">
          {suggestionDiffs.map((diff, i) => {
            const ds = DIFF_STYLES[diff.tag];
            const DiffIcon = ds.icon;
            return (
              <div key={i} className={`border ${ds.border} ${ds.bg} p-2.5`}>
                <div className="flex items-center gap-2 mb-1">
                  {DiffIcon && <DiffIcon className={`w-3 h-3 ${ds.iconColor} shrink-0`} />}
                  <span className="text-xs font-mono font-semibold text-foreground">{diff.action}</span>
                  {diff.priority && (
                    <span className={`text-xs font-mono ml-auto ${diff.priority === 'high' ? 'text-red-400' : diff.priority === 'medium' ? 'text-yellow-400' : 'text-muted-foreground'}`}>
                      {diff.priority === 'high' ? '高' : diff.priority === 'medium' ? '中' : '低'}优先
                    </span>
                  )}
                </div>
                {diff.tag === 'changed' ? (
                  <div className="pl-5 space-y-1">
                    <p className="text-xs font-mono text-red-400/80 line-through">{diff.detailA}</p>
                    <p className="text-xs font-mono text-primary">{diff.detailB}</p>
                  </div>
                ) : (
                  <p className={`text-xs font-mono pl-5 ${diff.tag === 'added' ? 'text-primary' : diff.tag === 'removed' ? 'text-muted-foreground line-through' : 'text-muted-foreground'}`}>
                    {diff.detailA ?? diff.detailB}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* 参数补丁差异 */}
      {patchDiffs.length > 0 && (
        <div className="space-y-1.5">
          <h4 className="text-xs font-mono font-bold text-foreground uppercase tracking-wider flex items-center gap-2">
            <Edit3 className="w-3.5 h-3.5 text-primary" />
            参数补丁对比
            <span className="font-normal text-muted-foreground normal-case">
              ({patchDiffs.filter(d => d.tag !== 'same').length} 处变化)
            </span>
          </h4>
          <div className="space-y-1.5">
            {patchDiffs.map((diff, i) => {
              const ds = DIFF_STYLES[diff.tag];
              const DiffIcon = ds.icon;
              return (
                <div key={i} className={`border ${ds.border} ${ds.bg} px-3 py-2`}>
                  <div className="flex items-center gap-2 flex-wrap">
                    {DiffIcon && <DiffIcon className={`w-3 h-3 ${ds.iconColor} shrink-0`} />}
                    <code className="text-xs font-mono text-foreground font-bold">{diff.param_name}</code>
                    {diff.tag === 'changed' && (
                      <>
                        <code className="text-xs font-mono text-red-400 bg-red-400/10 px-1 line-through">{diff.valueA}</code>
                        <ArrowRight className="w-3 h-3 text-muted-foreground shrink-0" />
                        <code className="text-xs font-mono text-primary bg-primary/10 px-1">{diff.valueB}</code>
                      </>
                    )}
                    {diff.tag === 'added' && (
                      <code className="text-xs font-mono text-primary bg-primary/10 px-1">{diff.valueB}</code>
                    )}
                    {diff.tag === 'removed' && (
                      <code className="text-xs font-mono text-red-400 bg-red-400/10 px-1 line-through">{diff.valueA}</code>
                    )}
                    {diff.tag === 'same' && (
                      <>
                        <code className="text-xs font-mono text-muted-foreground px-1">{diff.valueA}</code>
                        <span className="text-xs font-mono text-muted-foreground">（未变化）</span>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 图例说明 */}
      <div className="flex items-center gap-4 pt-1 flex-wrap">
        {(['added', 'removed', 'changed', 'same'] as DiffTag[]).map(tag => {
          const ds = DIFF_STYLES[tag];
          const DiffIcon = ds.icon;
          const labels: Record<DiffTag, string> = { added: '新增', removed: '删除', changed: '修改', same: '未变化' };
          return (
            <div key={tag} className="flex items-center gap-1">
              {DiffIcon ? <DiffIcon className={`w-3 h-3 ${ds.iconColor}`} /> : <span className="w-3 h-3 inline-block border border-border/40" />}
              <span className="text-xs font-mono text-muted-foreground">{labels[tag]}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---- 子组件：演进轨迹折线图 ----
// 图表颜色池（semantic token 无法在 recharts stroke 中使用，用固定色值）
const CHART_COLORS = [
  '#00D26A', '#FFB020', '#60A5FA', '#F472B6', '#A78BFA', '#34D399', '#FB923C', '#E879F9',
];

/**
 * EvolutionChart — 参数随时间演进折线图
 *
 * 数据源双轨制（通过 evolutionChartUtils 纯函数实现）：
 *   ╔══════════════════════════════════════════════════════════════╗
 *   ║  实线（app_*）：memory_episodes(type=parameter_patch)        ║
 *   ║                仅在用户点击「应用补丁」后才有数据             ║
 *   ╠══════════════════════════════════════════════════════════════╣
 *   ║  虚线（sug_*）：failure episodes → param_patches.suggested  ║
 *   ║                白质层推理输出，尚未写入技能卡                 ║
 *   ╚══════════════════════════════════════════════════════════════╝
 *
 * 隔离契约：两路数据通过 sug_/app_ 前缀严格隔离，
 * buildMergedChartData 保证两列不会互相写入，
 * 建议值永远不会出现在实线中（见 evolutionChartUtils.test.ts 验证）。
 */
export function EvolutionChart({ taskId, failureEpisodes }: {
  taskId: string | null;
  failureEpisodes: MemoryEpisode[];
}) {
  const { user } = useAuth();

  // ── 已应用的参数补丁（从 memory_episodes type=parameter_patch 查询）────
  const [appliedPatches, setAppliedPatches] = useState<MemoryEpisode[]>([]);
  const [loadingApplied, setLoadingApplied] = useState(false);

  // ── 技能卡的 param_alias_map（用于归一化参数名）────────────────────────
  // 结构：{ 别名 → 规范名 }，例如 { "timeout": "timeout_ms", "task_timeout": "timeout_ms" }
  const [paramAliasMap, setParamAliasMap] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!user || !taskId) { setAppliedPatches([]); setParamAliasMap({}); return; }
    setLoadingApplied(true);

    // 并发查：已应用补丁 + 技能卡 alias map
    Promise.all([
      supabase
        .from('memory_episodes')
        .select('*')
        .eq('user_id', user.id)
        .eq('task_id', taskId)
        .eq('type', 'parameter_patch')
        .order('created_at', { ascending: true })
        .limit(100),
      supabase
        .from('skill_cards')
        .select('tunable_params')
        .eq('task_id', taskId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]).then(([patchRes, cardRes]) => {
      setAppliedPatches(Array.isArray(patchRes.data) ? patchRes.data : []);
      const aliasMap = (cardRes.data?.tunable_params as Record<string, unknown>)?.param_alias_map;
      setParamAliasMap(typeof aliasMap === 'object' && aliasMap !== null ? aliasMap as Record<string, string> : {});
      setLoadingApplied(false);
    });
  }, [user, taskId]);

  // ── 归一化辅助：将任意别名解析为规范参数名 ──────────────────────────
  const resolveParamName = (name: string): string => paramAliasMap[name] ?? name;

  // ── 从 failure episodes 提取建议参数值时间序列（虚线数据源）──────────
  // 数据隔离：buildSuggestedPoints 仅读 suggested_value，source='suggested'
  // 输出只参与 sug_* dataKey 渲染，不会出现在 app_* 实线中
  const suggestedPoints = useMemo<ParamPoint[]>(
    () => buildSuggestedPoints(failureEpisodes, resolveParamName),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [failureEpisodes, paramAliasMap],
  );

  // ── 从 applied episodes 提取已应用参数值时间序列（实线数据源）─────────
  // 数据隔离：buildAppliedPoints 仅读 applied_value/suggested_value（兼容），
  //           输入已由 .eq('type','parameter_patch') 过滤，source='applied'
  //           输出只参与 app_* dataKey 渲染，不会出现在 sug_* 虚线中
  const appliedPoints = useMemo<ParamPoint[]>(
    () => buildAppliedPoints(appliedPatches, resolveParamName),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [appliedPatches, paramAliasMap],
  );

  // ── 合并所有参数名 ────────────────────────────────────────────────────
  const allParams = useMemo(() => {
    const set = new Set<string>();
    [...suggestedPoints, ...appliedPoints].forEach(pt => {
      Object.keys(pt).forEach(k => {
        if (!['ts', 'label', 'timeStr', 'source', 'confidence'].includes(k)) set.add(k);
      });
    });
    return [...set];
  }, [suggestedPoints, appliedPoints]);

  // ── selectedParams：通过 useEffect 与 allParams 同步，避免 useState 初始值只读问题
  const [selectedParams, setSelectedParams] = useState<string[]>(['confidence']);
  useEffect(() => {
    setSelectedParams(prev => {
      const newDefaults = ['confidence', ...allParams.slice(0, 2)];
      // 若当前选择都还有效则保留，否则重置为默认
      const stillValid = prev.filter(p => ['confidence', ...allParams].includes(p));
      return stillValid.length > 0 ? stillValid : newDefaults;
    });
  }, [allParams]);

  const toggleParam = (param: string) => {
    setSelectedParams(prev =>
      prev.includes(param) ? prev.filter(p => p !== param) : [...prev, param]
    );
  };

  const allParamOptions = ['confidence', ...allParams];

  // ── 合并为 recharts 时间轴数据（sug_/app_ 前缀双轨隔离）────────────────
  // buildMergedChartData 保证：sug_* 只来自 suggestedPoints，app_* 只来自 appliedPoints
  const mergedChartData = useMemo(
    () => buildMergedChartData(suggestedPoints, appliedPoints, allParamOptions),
    [suggestedPoints, appliedPoints, allParamOptions],
  );

  // ── 空状态 ──────────────────────────────────────────────────────────
  const totalPoints = suggestedPoints.length + appliedPoints.length;
  if (totalPoints < 2) {
    return (
      <div className="border border-border p-8 text-center space-y-2">
        <TrendingUp className="w-8 h-8 text-muted-foreground mx-auto" />
        <p className="text-xs font-mono text-muted-foreground">
          需要至少 2 条推理或补丁记录才能显示演进轨迹
        </p>
        <p className="text-xs font-mono text-muted-foreground/60">
          当前：{suggestedPoints.length} 条推理建议 · {appliedPoints.length} 条已应用补丁
        </p>
      </div>
    );
  }

  // ── 仅有建议、尚无任何已应用补丁的参数集合（用于显示警告）──────────
  // 安全契约：app_* 系列 Line 的数据 100% 来自 appliedPoints（parameter_patch episodes）
  // suggestedPoints（failure episodes）绝对不会被渲染为实线，两套 dataKey 前缀严格隔离：
  //   sug_<param> → 虚线 · app_<param> → 实线（无数据时 null，不连线）
  const paramsWithNoApplied = useMemo(() => {
    const appliedParamNames = new Set(
      appliedPatches.flatMap(ep => {
        const c = ep.content_json as Record<string, unknown>;
        return c.param_name ? [String(c.param_name)] : [];
      })
    );
    return allParams.filter(p => !appliedParamNames.has(p));
  }, [allParams, appliedPatches]);

  return (
    <div className="space-y-3">
      {/* 图例说明 —— 明确标注实线与虚线的语义差异，避免用户混淆"建议"与"生效" */}
      <div className="border border-border bg-muted/30 px-3 py-2 flex flex-wrap items-center gap-x-5 gap-y-2">
        {/* 实线图例 */}
        <span className="flex items-center gap-2 min-w-0">
          <span className="shrink-0 flex items-center gap-1">
            <svg width="28" height="10">
              <line x1="0" y1="5" x2="28" y2="5" stroke="#00D26A" strokeWidth="2.5" />
              <circle cx="14" cy="5" r="3.5" fill="#00D26A" />
            </svg>
          </span>
          <span className="text-xs font-mono leading-snug">
            <span className="text-foreground font-semibold">实线</span>
            <span className="text-muted-foreground"> — 已应用参数值</span>
            <span className="text-muted-foreground/60 ml-1">（用户点击「应用补丁」后写入技能卡）</span>
          </span>
        </span>
        {/* 虚线图例 */}
        <span className="flex items-center gap-2 min-w-0">
          <span className="shrink-0 flex items-center gap-1">
            <svg width="28" height="10">
              <line x1="0" y1="5" x2="28" y2="5" stroke="#60A5FA" strokeWidth="1.5" strokeDasharray="5 4" />
              <circle cx="14" cy="5" r="2.5" fill="none" stroke="#60A5FA" strokeWidth="1.5" />
            </svg>
          </span>
          <span className="text-xs font-mono leading-snug">
            <span className="text-foreground font-semibold">虚线</span>
            <span className="text-muted-foreground"> — 白质层建议值</span>
            <span className="text-muted-foreground/60 ml-1">（仅推理输出，尚未写入技能卡）</span>
          </span>
        </span>
        {loadingApplied && (
          <span className="flex items-center gap-1 text-xs font-mono text-muted-foreground/60 ml-auto shrink-0">
            <Loader2 className="w-3 h-3 animate-spin" />加载补丁记录…
          </span>
        )}
      </div>

      {/* 无已应用补丁时的提示 banner */}
      {!loadingApplied && appliedPoints.length === 0 && suggestedPoints.length > 0 && (
        <div className="flex items-start gap-2 border border-yellow-400/30 bg-yellow-400/5 px-3 py-2.5">
          <AlertTriangle className="w-3.5 h-3.5 text-yellow-400 shrink-0 mt-0.5" />
          <p className="text-xs font-mono text-yellow-400/90 leading-relaxed text-pretty">
            当前任务尚无已应用的参数补丁，图中只会显示虚线（白质层建议值，未真正生效）。
            实线仅在用户点击「应用补丁」并写入技能卡后才会出现。
          </p>
        </div>
      )}

      {/* 部分参数仅有建议无落地数据时的参数级提示 */}
      {!loadingApplied && paramsWithNoApplied.length > 0 && appliedPoints.length > 0 && (
        <div className="flex items-start gap-2 border border-yellow-400/20 bg-yellow-400/5 px-3 py-2">
          <AlertTriangle className="w-3 h-3 text-yellow-400/70 shrink-0 mt-0.5" />
          <p className="text-xs font-mono text-yellow-400/70 leading-relaxed">
            以下参数仅有建议值，尚未应用到技能卡（仅显示虚线，未真正生效）：
            {paramsWithNoApplied.map(p => (
              <code key={p} className="ml-1.5 bg-yellow-400/10 px-1">{p}</code>
            ))}
          </p>
        </div>
      )}

      {/* 参数切换按钮 */}
      <div className="flex flex-wrap gap-1.5">
        {allParamOptions.map((param, i) => {
          const color = CHART_COLORS[i % CHART_COLORS.length];
          const active = selectedParams.includes(param);
          return (
            <button
              key={param}
              onClick={() => toggleParam(param)}
              className={`flex items-center gap-1.5 text-xs font-mono px-2 py-1 border transition-colors
                ${active ? 'border-current opacity-100' : 'border-border opacity-40 hover:opacity-60'}`}
              style={{ color: active ? color : undefined }}
            >
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
              {param}
            </button>
          );
        })}
      </div>

      {/* 折线图主体 */}
      <div className="w-full min-w-0 overflow-hidden border border-border bg-card/50 p-3">
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={mergedChartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 10, fontFamily: 'monospace', fill: 'hsl(var(--muted-foreground))' }}
              axisLine={{ stroke: 'hsl(var(--border))' }}
              tickLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fontSize: 10, fontFamily: 'monospace', fill: 'hsl(var(--muted-foreground))' }}
              axisLine={false}
              tickLine={false}
              width={38}
            />
            <Tooltip
              contentStyle={{
                background: 'hsl(var(--card))',
                border: '1px solid hsl(var(--border))',
                borderRadius: '0',
                fontSize: '11px',
                fontFamily: 'monospace',
              }}
              labelStyle={{ color: 'hsl(var(--foreground))', fontWeight: 700 }}
              itemStyle={{ color: 'hsl(var(--muted-foreground))' }}
              formatter={(value: unknown, name: string): [string, string] => {
                if (value === null || value === undefined) return ['-', name];
                const isApplied = name.startsWith('app_');
                const paramName = name.replace(/^(sug_|app_)/, '');
                // Tooltip 明确区分"已真正生效"与"仅建议"
                const label = isApplied
                  ? `${paramName} ——已应用参数值（已写入技能卡）`
                  : `${paramName} ——白质层建议值（未写入技能卡）`;
                return [String(value), label];
              }}
            />
            <Legend
              layout="horizontal"
              wrapperStyle={{ paddingTop: 8, fontSize: 10, fontFamily: 'monospace' }}
              formatter={(value: string) => {
                const isApplied = value.startsWith('app_');
                const paramName = value.replace(/^(sug_|app_)/, '');
                return isApplied
                  ? `${paramName}（实线·已写入技能卡）`
                  : `${paramName}（虚线·白质层建议·未生效）`;
              }}
            />
            {/* 已应用补丁：实线 */}
            {allParamOptions.map((param, i) =>
              selectedParams.includes(param) ? (
                <Line
                  key={`app_${param}`}
                  type="monotone"
                  dataKey={`app_${param}`}
                  stroke={CHART_COLORS[i % CHART_COLORS.length]}
                  strokeWidth={2.5}
                  strokeDasharray={undefined}
                  dot={{ r: 4, strokeWidth: 0, fill: CHART_COLORS[i % CHART_COLORS.length] }}
                  activeDot={{ r: 6, strokeWidth: 2, stroke: 'hsl(var(--background))' }}
                  connectNulls={false}
                />
              ) : null
            )}
            {/* 白质层建议值：虚线 */}
            {allParamOptions.map((param, i) =>
              selectedParams.includes(param) ? (
                <Line
                  key={`sug_${param}`}
                  type="monotone"
                  dataKey={`sug_${param}`}
                  stroke={CHART_COLORS[i % CHART_COLORS.length]}
                  strokeWidth={1.5}
                  strokeDasharray="5 4"
                  dot={{ r: 3, strokeWidth: 0, fill: CHART_COLORS[i % CHART_COLORS.length] }}
                  activeDot={{ r: 5 }}
                  opacity={0.7}
                  connectNulls
                />
              ) : null
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* 时间轴事件流 */}
      <div className="space-y-1">
        <p className="text-xs font-mono text-muted-foreground uppercase tracking-wider mb-1.5">事件时间线</p>
        {[...suggestedPoints.map(p => ({ ...p, kind: 'suggested' as const, _confidence: p.confidence as number | undefined })),
           ...appliedPoints.map(p => ({ ...p, kind: 'applied' as const, _confidence: undefined })),
          ].sort((a, b) => a.ts - b.ts)
           .map((pt, i) => (
          <div key={i} className={`flex items-center gap-2 text-xs font-mono px-2 py-1 border
            ${pt.kind === 'applied' ? 'border-primary/30 bg-primary/5' : 'border-border/30 bg-transparent'}`}>
            <span className={`shrink-0 px-1 py-0.5 border text-xs ${pt.kind === 'applied' ? 'text-primary border-primary/40' : 'text-blue-400 border-blue-400/40'}`}>
              {pt.kind === 'applied' ? '已应用' : '建议'}
            </span>
            <span className="text-muted-foreground shrink-0">{pt.label}</span>
            {pt.kind === 'suggested' && typeof pt._confidence === 'number' && (
              <>
                <span className="text-muted-foreground">·</span>
                <span className="text-primary">置信度 {pt._confidence}%</span>
              </>
            )}
            {pt.kind === 'applied' && (() => {
              const c = appliedPatches.find(ep => {
                const at = (ep.content_json as Record<string, unknown>).applied_at as string | undefined;
                return new Date(at ?? ep.created_at).getTime() === pt.ts;
              })?.content_json as Record<string, unknown> | undefined;
              const oldVal = c?.old_value;
              const appliedVal = c?.applied_value ?? c?.suggested_value;
              // 计算距最近一条建议的延迟
              const nearestSuggest = suggestedPoints.filter(s => s.ts <= pt.ts).slice(-1)[0];
              const delayMs = nearestSuggest ? pt.ts - nearestSuggest.ts : null;
              const delayLabel = delayMs !== null
                ? delayMs < 60_000 ? `${Math.round(delayMs / 1000)}s 后落地`
                  : delayMs < 3_600_000 ? `${Math.round(delayMs / 60_000)}min 后落地`
                  : `${Math.round(delayMs / 3_600_000)}h 后落地`
                : null;
              return c?.param_name ? (
                <>
                  <span className="text-muted-foreground">·</span>
                  <code className="text-foreground font-bold">{String(c.param_name)}</code>
                  {oldVal !== undefined && (
                    <code className="text-red-400 bg-red-400/10 px-1 line-through">{String(oldVal)}</code>
                  )}
                  <ArrowRight className="w-3 h-3 text-muted-foreground shrink-0" />
                  <code className="text-primary bg-primary/10 px-1">{String(appliedVal ?? '')}</code>
                  {delayLabel && (
                    <span className="text-yellow-400/70 ml-1">{delayLabel}</span>
                  )}
                </>
              ) : null;
            })()}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---- 主组件 ----
type ViewMode = 'list' | 'compare' | 'evolution';

export default function ReasoningCompare() {
  const { user } = useAuth();
  const [episodes, setEpisodes] = useState<MemoryEpisode[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterFailureType, setFilterFailureType] = useState<FailureType | 'all'>('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<ViewMode>('list');

  const fetchEpisodes = async () => {
    if (!user) return;
    setLoading(true);
    const { data } = await supabase
      .from('memory_episodes')
      .select('*')
      .eq('user_id', user.id)
      .eq('type', 'failure')
      .contains('tags', ['white_matter'])
      .order('created_at', { ascending: false })
      .limit(200);
    setEpisodes(Array.isArray(data) ? data : []);
    setLoading(false);
  };

  useEffect(() => { fetchEpisodes(); }, [user]);

  // 筛选
  const filtered = useMemo(() => {
    let list = episodes;
    if (filterFailureType !== 'all') {
      list = list.filter(ep => {
        const c = extractContent(ep);
        return c?.failure_type === filterFailureType;
      });
    }
    if (search) {
      const s = search.toLowerCase();
      list = list.filter(ep => ep.title.toLowerCase().includes(s));
    }
    return list;
  }, [episodes, filterFailureType, search]);

  // ── 按任务分组（用于演进轨迹）──────────────────────────────────────
  const taskGroups = useMemo(() => {
    const map = new Map<string, { taskId: string | null; label: string; episodes: MemoryEpisode[] }>();
    episodes.forEach(ep => {
      const key = ep.task_id ?? ep.title;
      if (!map.has(key)) {
        map.set(key, {
          taskId: ep.task_id,
          label: ep.title.replace('[白质分析] ', '').split(' — ')[0],
          episodes: [],
        });
      }
      map.get(key)!.episodes.push(ep);
    });
    // 只保留 ≥1 条的组（演进图会自己判断是否足够）
    return [...map.values()].filter(g => g.episodes.length >= 1);
  }, [episodes]);

  const [evolutionTaskKey, setEvolutionTaskKey] = useState<string>('');

  const evolutionGroup = useMemo(() => {
    if (!evolutionTaskKey) return taskGroups[0] ?? null;
    return taskGroups.find(g => (g.taskId ?? g.label) === evolutionTaskKey) ?? null;
  }, [evolutionTaskKey, taskGroups]);

  // 选择逻辑（最多2条）
  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else if (next.size < 2) {
        next.add(id);
      }
      return next;
    });
  };

  const selectedEpisodes = filtered.filter(ep => selectedIds.has(ep.id));
  const canCompare = selectedEpisodes.length === 2;

  // 进入对比视图
  const handleCompare = () => {
    if (canCompare) setViewMode('compare');
  };

  // 空状态
  if (!loading && episodes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 space-y-3">
        <Brain className="w-12 h-12 text-muted-foreground" />
        <p className="text-sm font-mono text-muted-foreground">暂无白质层推理记录</p>
        <p className="text-xs font-mono text-muted-foreground">
          执行任务并使用白质层 AI 推理后，记录将显示在此处
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 工具栏 */}
      <div className="flex flex-col md:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="按任务名称搜索..."
            className="h-8 text-xs font-mono bg-background border-border pl-8"
          />
        </div>
        <Select value={filterFailureType} onValueChange={v => setFilterFailureType(v as FailureType | 'all')}>
          <SelectTrigger className="h-8 w-full md:w-40 text-xs font-mono bg-background border-border">
            <SelectValue placeholder="全部失败类型" />
          </SelectTrigger>
          <SelectContent className="bg-card border-border">
            <SelectItem value="all" className="text-xs font-mono">全部失败类型</SelectItem>
            {(Object.keys(FAILURE_TYPE_LABELS) as FailureType[]).map(ft => (
              <SelectItem key={ft} value={ft} className="text-xs font-mono">{FAILURE_TYPE_LABELS[ft]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground shrink-0"
          onClick={fetchEpisodes}
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </Button>
      </div>

      {/* 视图切换标签 */}
      <div className="flex items-center gap-1 border-b border-border">
        {([
          { id: 'list', label: '记录列表', icon: Brain },
          { id: 'compare', label: '并排对比', icon: GitCompare },
          { id: 'evolution', label: '演进轨迹', icon: TrendingUp },
        ] as { id: ViewMode; label: string; icon: React.ElementType }[]).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => {
              if (id === 'compare' && !canCompare) return;
              setViewMode(id);
            }}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-mono border-b-2 transition-colors
              ${viewMode === id
                ? 'border-primary text-primary'
                : id === 'compare' && !canCompare
                  ? 'border-transparent text-muted-foreground/40 cursor-not-allowed'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
            {id === 'compare' && !canCompare && (
              <span className="text-xs text-muted-foreground/60">（选择2条）</span>
            )}
          </button>
        ))}
      </div>

      {/* ---- 列表视图 ---- */}
      {viewMode === 'list' && (
        <div className="space-y-3">
          {/* 选择提示 */}
          <div className="flex items-center justify-between">
            <p className="text-xs font-mono text-muted-foreground">
              共 {filtered.length} 条推理记录
              {selectedIds.size > 0 && (
                <span className="text-primary ml-2">· 已选 {selectedIds.size}/2</span>
              )}
            </p>
            {canCompare && (
              <Button
                size="sm"
                className="h-7 text-xs font-mono gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90"
                onClick={handleCompare}
              >
                <GitCompare className="w-3.5 h-3.5" />
                对比所选
              </Button>
            )}
          </div>

          {loading ? (
            <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 bg-muted" />)}</div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-10">
              <p className="text-xs font-mono text-muted-foreground">没有符合条件的推理记录</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {filtered.map(ep => (
                <EpisodeCard
                  key={ep.id}
                  episode={ep}
                  selected={selectedIds.has(ep.id)}
                  selectable={selectedIds.size < 2 || selectedIds.has(ep.id)}
                  onToggle={() => toggleSelect(ep.id)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ---- 对比视图 ---- */}
      {viewMode === 'compare' && canCompare && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs font-mono border border-border text-muted-foreground hover:text-foreground gap-1"
              onClick={() => setViewMode('list')}
            >
              <ChevronRight className="w-3 h-3 rotate-180" />返回列表
            </Button>
            <p className="text-xs font-mono text-muted-foreground">
              对比 {new Date(selectedEpisodes[0].created_at).toLocaleDateString('zh-CN')} 与 {new Date(selectedEpisodes[1].created_at).toLocaleDateString('zh-CN')}
            </p>
          </div>
          <ComparePanel episodeA={selectedEpisodes[0]} episodeB={selectedEpisodes[1]} />
        </div>
      )}

      {/* ---- 演进轨迹视图 ---- */}
      {viewMode === 'evolution' && (
        <div className="space-y-3">
          {taskGroups.length === 0 ? (
            <div className="border border-border p-8 text-center space-y-2">
              <TrendingUp className="w-8 h-8 text-muted-foreground mx-auto" />
              <p className="text-xs font-mono text-muted-foreground">暂无推理记录，执行任务并触发白质层分析后将显示演进轨迹</p>
            </div>
          ) : (
            <>
              {/* 任务切换 */}
              {taskGroups.length > 1 && (
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-muted-foreground shrink-0">选择任务</span>
                  <Select
                    value={evolutionTaskKey || (taskGroups[0].taskId ?? taskGroups[0].label)}
                    onValueChange={setEvolutionTaskKey}
                  >
                    <SelectTrigger className="h-8 flex-1 md:max-w-xs text-xs font-mono bg-background border-border">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-card border-border">
                      {taskGroups.map(g => (
                        <SelectItem
                          key={g.taskId ?? g.label}
                          value={g.taskId ?? g.label}
                          className="text-xs font-mono"
                        >
                          {g.label}（{g.episodes.length} 条推理）
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <EvolutionChart
                taskId={evolutionGroup?.taskId ?? null}
                failureEpisodes={evolutionGroup?.episodes ?? []}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}
