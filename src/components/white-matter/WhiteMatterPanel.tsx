// 白质层 AI 推理面板组件
// 支持流式展示推理过程、结构化结果卡片、参数补丁应用
import { useState, useRef, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/db/supabase';
import { sendStreamRequest } from '@/lib/sse';
import type {
  TaskRun,
  Task,
  WhiteMatterAnalysis,
  WhiteMatterSuggestion,
  ParamPatch,
  FailureType,
} from '@/types/types';
import { resolveCanonicalParamName } from '@/utils/evolutionChartUtils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import {
  Brain,
  AlertTriangle,
  CheckCircle,
  XCircle,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Wrench,
  Target,
  Loader2,
  Cpu,
} from 'lucide-react';

// ---- 失败类型映射 ----
const FAILURE_TYPE_MAP: Record<FailureType, { label: string; color: string }> = {
  element_not_found: { label: '元素未找到', color: 'text-orange-400' },
  timeout: { label: '执行超时', color: 'text-yellow-400' },
  assertion_failed: { label: '断言失败', color: 'text-red-400' },
  navigation_error: { label: '页面导航错误', color: 'text-blue-400' },
  permission_denied: { label: '权限被拒绝', color: 'text-purple-400' },
  unknown: { label: '未知错误', color: 'text-muted-foreground' },
};

const PRIORITY_MAP = {
  high: { label: '高优先级', color: 'text-red-400', border: 'border-red-400/40' },
  medium: { label: '中优先级', color: 'text-yellow-400', border: 'border-yellow-400/40' },
  low: { label: '低优先级', color: 'text-muted-foreground', border: 'border-border' },
};

// ---- 子组件：流式打字机光标 ----
function TypingCursor() {
  return (
    <span className="inline-block w-2 h-3.5 bg-primary ml-0.5 align-middle animate-[blink_1s_step-end_infinite]" />
  );
}

// ---- 子组件：建议卡片 ----
function SuggestionCard({ suggestion, idx }: { suggestion: WhiteMatterSuggestion; idx: number }) {
  const p = PRIORITY_MAP[suggestion.priority];
  return (
    <div className={`border ${p.border} p-3 space-y-1`}>
      <div className="flex items-center gap-2">
        <span className={`text-xs font-mono font-bold ${p.color}`}>{String(idx + 1).padStart(2, '0')}</span>
        <span className={`text-xs font-mono px-1.5 py-0.5 border ${p.border} ${p.color}`}>{p.label}</span>
        <span className="text-xs font-mono text-foreground font-semibold flex-1 min-w-0">{suggestion.action}</span>
      </div>
      <p className="text-xs font-mono text-muted-foreground leading-relaxed pl-6">{suggestion.detail}</p>
    </div>
  );
}

// ---- 子组件：参数补丁卡片 ----
function ParamPatchCard({
  patch,
  onApply,
  applying,
}: {
  patch: ParamPatch;
  onApply: (patch: ParamPatch) => void;
  applying: boolean;
}) {
  return (
    <div className="border border-primary/30 bg-primary/5 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Wrench className="w-3.5 h-3.5 text-primary shrink-0" />
          <span className="text-xs font-mono text-primary font-bold truncate">{patch.param_name}</span>
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-xs font-mono border border-primary/40 text-primary hover:bg-primary/10 shrink-0"
          onClick={() => onApply(patch)}
          disabled={applying}
        >
          {applying ? <Loader2 className="w-3 h-3 animate-spin" /> : '应用补丁'}
        </Button>
      </div>
      <div className="flex items-center gap-3 pl-5">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-mono text-muted-foreground">修改前:</span>
          <code className="text-xs font-mono text-red-400 bg-red-400/10 px-1">{patch.old_value}</code>
        </div>
        <span className="text-muted-foreground font-mono text-xs">→</span>
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-mono text-muted-foreground">建议:</span>
          <code className="text-xs font-mono text-primary bg-primary/10 px-1">{patch.suggested_value}</code>
        </div>
      </div>
      <p className="text-xs font-mono text-muted-foreground pl-5">{patch.reason}</p>
    </div>
  );
}

// ---- 子组件：分析结果面板 ----
function AnalysisResult({
  analysis,
  taskRun,
  onApplyPatch,
}: {
  analysis: WhiteMatterAnalysis;
  taskRun: TaskRun;
  onApplyPatch: (patch: ParamPatch) => Promise<void>;
}) {
  const [applyingPatch, setApplyingPatch] = useState<string | null>(null);
  const [showSteps, setShowSteps] = useState(false);
  const ft = FAILURE_TYPE_MAP[analysis.failure_type] ?? FAILURE_TYPE_MAP.unknown;
  const confidence = Math.round(analysis.confidence * 100);

  const handleApply = async (patch: ParamPatch) => {
    setApplyingPatch(patch.param_name);
    try {
      await onApplyPatch(patch);
    } finally {
      // 无论成功、失败、异常，loading 状态必须清除（需求 6：失败时不更新本地 UI 状态）
      setApplyingPatch(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* 根本原因 + 置信度 */}
      <div className="border border-border p-4 space-y-3">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 flex items-center justify-center border border-red-400/40 bg-red-400/10 shrink-0">
            <AlertTriangle className="w-4 h-4 text-red-400" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="text-xs font-mono font-bold text-foreground">根本原因</span>
              <span className={`text-xs font-mono px-1.5 py-0.5 border border-current/30 ${ft.color}`}>
                {ft.label}
              </span>
            </div>
            <p className="text-sm font-mono text-foreground leading-relaxed text-pretty">{analysis.root_cause}</p>
          </div>
        </div>

        {/* 置信度 */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono text-muted-foreground">推理置信度</span>
            <span className={`text-xs font-mono font-bold ${confidence >= 75 ? 'text-primary' : confidence >= 50 ? 'text-yellow-400' : 'text-red-400'}`}>
              {confidence}%
            </span>
          </div>
          <Progress value={confidence} className="h-1.5" />
        </div>
      </div>

      {/* 推理摘要 */}
      <div className="border border-border bg-card/50 p-3">
        <div className="flex items-center gap-2 mb-2">
          <Brain className="w-3.5 h-3.5 text-blue-400" />
          <span className="text-xs font-mono font-bold text-blue-400">推理摘要</span>
        </div>
        <p className="text-xs font-mono text-muted-foreground leading-relaxed text-pretty pl-5">
          {analysis.reasoning_summary}
        </p>
      </div>

      {/* 受影响步骤（可折叠） */}
      {analysis.affected_steps.length > 0 && (
        <div className="border border-border">
          <button
            className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-muted/50 transition-colors"
            onClick={() => setShowSteps(!showSteps)}
          >
            <div className="flex items-center gap-2">
              <XCircle className="w-3.5 h-3.5 text-red-400" />
              <span className="text-xs font-mono font-bold text-foreground">
                受影响步骤 ({analysis.affected_steps.length})
              </span>
            </div>
            {showSteps ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
          </button>
          {showSteps && (
            <div className="border-t border-border p-3 space-y-2">
              {analysis.affected_steps.map((s) => (
                <div key={s.step_index} className="flex items-start gap-2">
                  <span className="text-xs font-mono text-muted-foreground w-12 shrink-0">步骤{s.step_index + 1}</span>
                  <code className="text-xs font-mono text-orange-400 shrink-0">[{s.action}]</code>
                  <span className="text-xs font-mono text-muted-foreground">{s.description}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 优化建议 */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Target className="w-3.5 h-3.5 text-yellow-400" />
          <span className="text-xs font-mono font-bold text-yellow-400">
            优化建议 ({analysis.suggestions.length})
          </span>
        </div>
        {analysis.suggestions.map((s, i) => (
          <SuggestionCard key={i} suggestion={s} idx={i} />
        ))}
      </div>

      {/* 参数补丁 */}
      {analysis.param_patches.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Wrench className="w-3.5 h-3.5 text-primary" />
            <span className="text-xs font-mono font-bold text-primary">
              参数补丁 ({analysis.param_patches.length})
            </span>
          </div>
          {analysis.param_patches.map((p) => (
            <ParamPatchCard
              key={p.param_name}
              patch={p}
              onApply={handleApply}
              applying={applyingPatch === p.param_name}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---- 主组件 ----
interface WhiteMatterPanelProps {
  taskRun: TaskRun;
  task: Task;
  onAnalysisComplete?: (analysis: WhiteMatterAnalysis) => void;
  /** 自动启动分析（用于「失败后自动分析」功能） */
  autoStart?: boolean;
}

type PanelState = 'idle' | 'streaming' | 'done' | 'error';

export default function WhiteMatterPanel({ taskRun, task, onAnalysisComplete, autoStart }: WhiteMatterPanelProps) {
  const [state, setState] = useState<PanelState>(() => {
    // 如果已有分析结果，直接显示
    if (taskRun.analysis && typeof taskRun.analysis === 'object') return 'done';
    return 'idle';
  });
  const [streamText, setStreamText] = useState('');
  const [analysis, setAnalysis] = useState<WhiteMatterAnalysis | null>(
    taskRun.analysis && typeof taskRun.analysis === 'object'
      ? taskRun.analysis as WhiteMatterAnalysis
      : null
  );
  const [errorMsg, setErrorMsg] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const fullContentRef = useRef('');
  // 防止 autoStart 重复触发
  const autoStartFiredRef = useRef(false);

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

  // 构建步骤结果的简化版本传给 Edge Function
  const buildStepsResult = useCallback(() => {
    return taskRun.steps_result.map((r, i) => ({
      step_index: i,
      action: r.type,
      status: r.status,
      duration_ms: r.duration_ms,
      error: r.error,
    }));
  }, [taskRun.steps_result]);

  const buildSteps = useCallback(() => {
    return task.steps_json.map((s) => ({
      action: s.type,
      selector: s.selector,
      value: s.value,
    }));
  }, [task.steps_json]);

  const startAnalysis = async () => {
    // 获取当前用户会话 JWT，用于 Edge Function 身份验证
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) {
      setErrorMsg('未登录或会话已过期，请重新登录');
      setState('error');
      return;
    }

    setState('streaming');
    setStreamText('');
    setErrorMsg('');
    fullContentRef.current = '';
    abortRef.current = new AbortController();

    await sendStreamRequest({
      functionUrl: `${supabaseUrl}/functions/v1/white-matter-analyze`,
      authToken: session.access_token,
      supabaseAnonKey,
      requestBody: {
        task_run_id: taskRun.id,
        task_id: task.id,
        task_name: task.name,
        target_url: task.target_url,
        // 需求 3：param_patches 默认作用于 task_run.skill_card_id
        // 传入 Edge Function 使 failure episode 记录完整绑定（需求 5）
        skill_card_id: taskRun.skill_card_id ?? null,
        steps: buildSteps(),
        steps_result: buildStepsResult(),
        error_message: taskRun.error_message,
      },
      onData: (data) => {
        if (data === '[DONE]') return;
        try {
          const parsed = JSON.parse(data);
          const chunk = parsed.choices?.[0]?.delta?.content ?? '';
          if (chunk) {
            fullContentRef.current += chunk;
            setStreamText(fullContentRef.current);
          }
        } catch {
          // 忽略无法解析的帧
        }
      },
      onComplete: () => {
        // 解析最终 JSON
        try {
          const cleaned = fullContentRef.current
            .replace(/^```json\s*/i, '')
            .replace(/^```\s*/i, '')
            .replace(/\s*```\s*$/i, '')
            .trim();
          const result = JSON.parse(cleaned) as WhiteMatterAnalysis;
          setAnalysis(result);
          setState('done');
          onAnalysisComplete?.(result);
        } catch {
          // JSON 未完整 — 尝试提取可用内容
          setState('done');
          toast.warning('推理结果解析部分失败，已显示原始输出');
        }
      },
      onError: (error) => {
        console.error('白质层推理错误:', error);
        setState('error');
        setErrorMsg(error.message || '推理请求失败，请重试');
        toast.error('白质层推理失败');
      },
      signal: abortRef.current.signal,
    });
  };

  const handleAbort = () => {
    abortRef.current?.abort();
    setState('idle');
    setStreamText('');
  };

  // 应用参数补丁到技能卡（原子 RPC 版）
  //
  // 架构说明：
  //   前端负责：① 查找关联技能卡  ② 归一化 param_name（需读取 tunable_params）
  //   后端 RPC 负责（单一事务）：
  //     ③ 权限校验  ④ 计算 newVersion  ⑤ UPDATE skill_cards
  //     ⑥ INSERT skill_history  ⑦ INSERT memory_episodes(type=parameter_patch)
  //   任一后端步骤失败 → 事务回滚，三张表保持一致，前端收到错误响应。
  const handleApplyPatch = async (patch: ParamPatch) => {
    try {
      // ── 1. 查找关联技能卡 ─────────────────────────────────────────────
      let card: { id: string; tunable_params: Record<string, unknown>; version: string; status: string } | null = null;

      if (taskRun.skill_card_id) {
        const { data } = await supabase
          .from('skill_cards')
          .select('id, tunable_params, version, status')
          .eq('id', taskRun.skill_card_id)
          .maybeSingle();
        card = data;
      }

      if (!card && task.id) {
        const { data } = await supabase
          .from('skill_cards')
          .select('id, tunable_params, version, status')
          .eq('task_id', task.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        card = data;
      }

      if (!card) {
        toast.error('未找到关联技能卡，无法应用补丁（请先创建任务时自动生成技能卡）');
        return;
      }

      // ── 2. 归一化 param_name（前端负责，需读取当前 tunable_params）────
      const existingKeys = Object.keys(card.tunable_params || {}).filter(k => k !== 'param_alias_map');
      const aliasMap = (card.tunable_params?.param_alias_map ?? {}) as Record<string, string>;
      const [canonicalParamName, normalizationNote] = resolveCanonicalParamName(
        patch.param_name, existingKeys, aliasMap,
      );

      if (normalizationNote) {
        console.warn('[WhiteMatterPanel] 参数名归一化:', normalizationNote);
      }

      // ── 3. 调用后端原子 RPC（skill_cards + skill_history + memory_episodes 三写在同一事务）
      const { data: rpcResult, error: rpcError } = await supabase.rpc('apply_param_patch', {
        p_skill_card_id:        card.id,
        p_task_run_id:          taskRun.id ?? null,
        p_task_id:              task.id,
        p_task_name:            task.name,
        p_canonical_param_name: canonicalParamName,
        p_raw_param_name:       patch.param_name,
        p_old_value:            patch.old_value ?? '',
        p_suggested_value:      patch.suggested_value,
        p_applied_value:        patch.suggested_value,
        p_reason:               patch.reason ?? '',
        p_normalization_note:   normalizationNote ?? null,
        // Milestone 4：传入客户端已知版本，触发乐观锁校验（VERSION_CONFLICT）
        p_expected_version:     card.version ?? null,
      });

      if (rpcError) {
        // RPC 层错误（网络/权限/数据完整性）——前端不更新任何本地状态
        const msg = rpcError.message || '未知错误';
        console.error('[handleApplyPatch] RPC 错误:', msg);
        if (msg.includes('FORBIDDEN')) {
          toast.error('权限不足，无法操作该技能卡');
        } else if (msg.includes('VERSION_CONFLICT')) {
          // Milestone 4：并发冲突，客户端版本已过期
          toast.error('版本冲突：技能卡已被其他操作更新，请刷新后重试');
        } else if (msg.includes('MISSING_SKILL_CARD')) {
          // 需求 7：task_run 未绑定技能卡，不允许应用补丁
          toast.error('该推理记录尚未关联技能卡，无法应用参数补丁。请先为任务创建技能卡。');
        } else if (msg.includes('BINDING_MISMATCH')) {
          // 需求 4：task_run 绑定的技能卡与当前技能卡不一致
          toast.error('绑定不一致：该推理记录关联的技能卡与当前卡不同，请刷新后重试');
        } else if (msg.includes('NOT_FOUND')) {
          toast.error('技能卡或推理记录不存在，请刷新后重试');
        } else if (msg.includes('UNAUTHORIZED')) {
          toast.error('请先登录后再应用补丁');
        } else {
          toast.error(`应用失败：${msg}`);
        }
        return;
      }

      // 需求 5：只有后端明确返回 ok===true 时才 toast.success
      const result = rpcResult as { ok: boolean; new_version: string } | null;
      if (result?.ok === true) {
        toast.success(`参数补丁已应用，技能卡升级至 v${result.new_version}，经验已存入海马层`);
        return;
      }

      // ok===false 或 result 为 null：后端未抛异常但操作未成功（防御性分支）
      console.error('[handleApplyPatch] RPC 返回非成功结果:', result);
      toast.error('操作未能完成，请刷新后重试');
    } catch (e) {
      console.error('应用参数补丁失败:', e);
      toast.error('应用失败，请重试');
    }
  };

  // autoStart：仅当 state=idle（无已有分析）时触发一次
  useEffect(() => {
    if (autoStart && state === 'idle' && !autoStartFiredRef.current) {
      autoStartFiredRef.current = true;
      startAnalysis();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart]);

  // ---- idle 状态 ----
  if (state === 'idle') {
    return (
      <div className="border border-blue-400/30 bg-blue-400/5 p-4 space-y-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 flex items-center justify-center border border-blue-400/40 bg-blue-400/10 shrink-0">
            <Brain className="w-4 h-4 text-blue-400" />
          </div>
          <div>
            <h4 className="text-sm font-semibold font-mono text-blue-400">白质层 — 根因推理引擎</h4>
            <p className="text-xs font-mono text-muted-foreground">慢速推理系统：分析失败原因，生成优化建议与参数补丁</p>
          </div>
        </div>
        <Button
          onClick={startAnalysis}
          className="w-full bg-blue-500 hover:bg-blue-400 text-white font-mono text-xs h-8"
        >
          <Cpu className="w-3.5 h-3.5 mr-1.5" />
          启动白质层 AI 推理
        </Button>
      </div>
    );
  }

  // ---- streaming 状态 ----
  if (state === 'streaming') {
    return (
      <div className="border border-blue-400/30 bg-blue-400/5 space-y-0">
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-blue-400/20">
          <div className="flex items-center gap-2">
            <Loader2 className="w-3.5 h-3.5 text-blue-400 animate-spin" />
            <span className="text-xs font-mono text-blue-400 font-bold">白质层推理中...</span>
          </div>
          <button
            onClick={handleAbort}
            className="text-xs font-mono text-muted-foreground hover:text-foreground transition-colors"
          >
            中断
          </button>
        </div>

        {/* 终端输出区 */}
        <div className="bg-background/80 p-4 min-h-32 max-h-64 overflow-y-auto">
          <div className="flex items-start gap-2">
            <span className="text-xs font-mono text-primary shrink-0 select-none">&gt;&gt;&gt;</span>
            <div className="flex-1 min-w-0">
              {streamText ? (
                <p className="text-xs font-mono text-foreground whitespace-pre-wrap break-words leading-relaxed">
                  {streamText}
                  <TypingCursor />
                </p>
              ) : (
                <div className="space-y-2">
                  <Skeleton className="h-3 w-3/4 bg-muted" />
                  <Skeleton className="h-3 w-full bg-muted" />
                  <Skeleton className="h-3 w-2/3 bg-muted" />
                  <TypingCursor />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ---- error 状态 ----
  if (state === 'error') {
    return (
      <div className="border border-red-400/30 bg-red-400/5 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <XCircle className="w-4 h-4 text-red-400" />
          <span className="text-xs font-mono font-bold text-red-400">推理失败</span>
        </div>
        <p className="text-xs font-mono text-muted-foreground">{errorMsg}</p>
        <Button
          variant="ghost"
          size="sm"
          className="border border-red-400/40 text-red-400 hover:bg-red-400/10 font-mono text-xs h-7"
          onClick={() => { setState('idle'); setStreamText(''); }}
        >
          <RefreshCw className="w-3 h-3 mr-1.5" />
          重试
        </Button>
      </div>
    );
  }

  // ---- done 状态 ----
  return (
    <div className="space-y-3">
      {/* 标题栏 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CheckCircle className="w-4 h-4 text-primary" />
          <span className="text-xs font-mono font-bold text-primary">白质层分析完成</span>
          {analysis && (
            <Badge variant="outline" className="text-xs font-mono border-primary/40 text-primary">
              置信度 {Math.round(analysis.confidence * 100)}%
            </Badge>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-xs font-mono text-muted-foreground hover:text-foreground border border-border"
          onClick={() => { setState('idle'); setAnalysis(null); setStreamText(''); fullContentRef.current = ''; }}
        >
          <RefreshCw className="w-3 h-3 mr-1" />
          重新分析
        </Button>
      </div>

      {/* 如果有结构化结果 */}
      {analysis ? (
        <AnalysisResult
          analysis={analysis}
          taskRun={taskRun}
          onApplyPatch={handleApplyPatch}
        />
      ) : (
        // 降级展示原始文本
        <div className="border border-border bg-background/80 p-4">
          <pre className="text-xs font-mono text-foreground whitespace-pre-wrap break-words leading-relaxed overflow-auto max-h-64">
            {streamText || '（无内容）'}
          </pre>
        </div>
      )}
    </div>
  );
}
