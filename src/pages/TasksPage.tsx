import { useEffect, useState, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import AppLayout from '@/components/layouts/AppLayout';
import { supabase } from '@/db/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useRealtimeSync } from '@/hooks/use-realtime-sync';
import { useBrowserNotification } from '@/hooks/use-browser-notification';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import type { Task, TaskStep, TaskRun, ActionType, WhiteMatterAnalysis, PatchEvaluationResult, ApplyRollbackResult } from '@/types/types';
import WhiteMatterPanel from '@/components/white-matter/WhiteMatterPanel';
import { insertNotification, sendBrowserNotification } from '@/lib/notifications';
import {
  Plus, Play, Trash2, GripVertical, ExternalLink, Clock, CheckCircle,
  XCircle, Activity, ChevronDown, ChevronUp, AlertCircle, MousePointer,
  Type, Timer, Camera, MessageSquare, Globe, Search, RefreshCw, Brain, Link2,
} from 'lucide-react';

const ACTION_DEFS: Record<ActionType, { icon: React.ElementType; label: string; placeholder: string; needsSelector: boolean; needsValue: boolean }> = {
  click:         { icon: MousePointer, label: '点击', placeholder: 'CSS选择器，如 #submit-btn', needsSelector: true, needsValue: false },
  fill:          { icon: Type, label: '填写', placeholder: 'CSS选择器，如 input[name="email"]', needsSelector: true, needsValue: true },
  wait:          { icon: Timer, label: '等待', placeholder: '等待毫秒数，如 1000', needsSelector: false, needsValue: true },
  screenshot:    { icon: Camera, label: '截图', placeholder: '（可选）文件名', needsSelector: false, needsValue: false },
  handle_dialog: { icon: MessageSquare, label: '处理弹窗', placeholder: '接受(accept)或关闭(dismiss)', needsSelector: false, needsValue: true },
  navigate:      { icon: Globe, label: '导航', placeholder: '目标URL', needsSelector: false, needsValue: true },
  extract:       { icon: Search, label: '提取数据', placeholder: 'CSS选择器', needsSelector: true, needsValue: false },
};

const TASK_STATUS_MAP = {
  pending:  { label: '等待', icon: Clock, cls: 'task-pending' },
  running:  { label: '运行中', icon: Activity, cls: 'task-running' },
  success:  { label: '成功', icon: CheckCircle, cls: 'task-success' },
  failed:   { label: '失败', icon: XCircle, cls: 'task-failed' },
};

async function simulateTaskExecution(
  steps: TaskStep[],
  _snapshotParams: Record<string, unknown> | null,
  runId: string,
  userId: string
): Promise<{ success: boolean; stepResults: Array<{ step_id: string; type: ActionType; description: string; status: 'success' | 'failed' | 'skipped'; duration_ms: number; error?: string }> }> {
  const stepResults: Array<{ step_id: string; type: ActionType; description: string; status: 'success' | 'failed' | 'skipped'; duration_ms: number; error?: string }> = [];
  let anyFailed = false;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    
    // 如果之前有失败步骤，后续跳过，但通常也需要记一条 skipped
    if (anyFailed) {
      const started_at = new Date().toISOString();
      await supabase.from('task_run_steps').insert({
        task_run_id: runId,
        user_id: userId,
        step_index: i,
        action_type: step.type,
        target_selector: step.selector || null,
        input_value_snapshot: step.value ? { value: step.value } : null,
        status: 'skipped',
        started_at,
        ended_at: started_at,
        duration_ms: 0,
      });

      stepResults.push({
        step_id: step.id,
        type: step.type,
        description: step.description,
        status: 'skipped',
        duration_ms: 0,
      });
      continue;
    }

    const started_at = new Date().toISOString();
    
    // 预写入 step trace running 状态
    const { data: stepTrace } = await supabase.from('task_run_steps').insert({
      task_run_id: runId,
      user_id: userId,
      step_index: i,
      action_type: step.type,
      target_selector: step.selector || null,
      input_value_snapshot: step.value ? { value: step.value } : null,
      status: 'running',
      started_at,
    }).select().maybeSingle();

    // 模拟执行耗时
    const duration_ms = Math.floor(Math.random() * 800) + 100;
    await new Promise(r => setTimeout(r, duration_ms));

    const failChance = step.type === 'fill' && !step.value ? 0.8 : 0.15;
    const failed = Math.random() < failChance;
    const status = failed ? 'failed' : 'success';
    const errorMsg = failed ? `元素未找到: ${step.selector || '未指定选择器'}` : undefined;

    const ended_at = new Date().toISOString();

    if (stepTrace) {
      await supabase.from('task_run_steps').update({
        status,
        ended_at,
        duration_ms,
        error_message: errorMsg || null,
        error_code: failed ? 'ELEMENT_NOT_FOUND' : null,
        safety_risk_level: 'low',
        dom_snapshot_ref: failed ? `dom_snap_${Date.now()}` : null,
        screenshot_ref: failed ? `screenshot_${Date.now()}` : null,
      }).eq('id', stepTrace.id);
    }

    stepResults.push({
      step_id: step.id,
      type: step.type,
      description: step.description,
      status,
      duration_ms,
      error: errorMsg,
    });

    if (failed) {
      anyFailed = true;
    }
  }

  return { success: !anyFailed, stepResults };
}

function TaskRunHistory({
  runs,
  loading,
  task,
  onRefresh,
  autoAnalyzeRunId,
  expandRunId,
  onAnalysisComplete,
}: {
  runs: TaskRun[];
  loading: boolean;
  task: Task;
  onRefresh: () => void;
  /** 需要自动触发白质层分析的 run id（失败后自动分析功能） */
  autoAnalyzeRunId?: string | null;
  /** 仅展开、不触发自动分析（通知跳转功能） */
  expandRunId?: string | null;
  /** 分析完成回调，用于触发站内通知 + 浏览器推送 */
  onAnalysisComplete?: (run: TaskRun, analysis: WhiteMatterAnalysis) => void;
}) {
  // expandRunId 优先，其次 autoAnalyzeRunId
  const [expanded, setExpanded] = useState<string | null>(expandRunId ?? autoAnalyzeRunId ?? null);

  if (loading) return <div className="space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-10 bg-muted" />)}</div>;
  if (runs.length === 0) return <p className="text-xs text-muted-foreground font-mono py-4 text-center">暂无执行记录</p>;

  return (
    <div className="space-y-1.5">
      {runs.map(run => {
        const sm = TASK_STATUS_MAP[run.status];
        const Icon = sm.icon;
        const isExpanded = expanded === run.id;
        const isFailed = run.status === 'failed';
        return (
          <div key={run.id} className="border border-border">
            <button
              className="w-full flex items-center gap-2 p-2.5 hover:bg-accent transition-colors text-left"
              onClick={() => setExpanded(isExpanded ? null : run.id)}
            >
              <Icon className={`w-3.5 h-3.5 shrink-0 ${run.status === 'success' ? 'text-primary' : run.status === 'failed' ? 'text-red-400' : run.status === 'running' ? 'text-blue-400' : 'text-muted-foreground'}`} />
              <span className="flex-1 text-xs font-mono text-foreground">
                {new Date(run.started_at).toLocaleString('zh-CN')}
              </span>
              {isFailed && run.analysis && (
                <span className="text-xs font-mono px-1 py-0.5 border border-blue-400/40 text-blue-400 shrink-0">已分析</span>
              )}
              {isFailed && !run.analysis && (
                <span className="text-xs font-mono px-1 py-0.5 border border-blue-400/30 text-blue-400/60 shrink-0 flex items-center gap-1">
                  <Brain className="w-2.5 h-2.5" />AI可分析
                </span>
              )}
              <span className={`text-xs font-mono px-1.5 py-0.5 border ${sm.cls}`}>{sm.label}</span>
              <span className="text-xs text-muted-foreground font-mono shrink-0">
                {run.duration_ms ? `${run.duration_ms}ms` : ''}
              </span>
              {isExpanded ? <ChevronUp className="w-3 h-3 text-muted-foreground shrink-0" /> : <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" />}
            </button>

            {isExpanded && (
              <div className="border-t border-border p-3 bg-muted/30 space-y-4">

                {/* ── 技能卡关联验证条 ─────────────────────────────────── */}
                <div className={`flex items-center gap-2 px-2.5 py-1.5 text-xs font-mono border ${
                  run.skill_card_id
                    ? 'border-primary/30 bg-primary/5 text-primary'
                    : 'border-yellow-500/30 bg-yellow-500/5 text-yellow-400'
                }`}>
                  <Link2 className="w-3 h-3 shrink-0" />
                  {run.skill_card_id
                    ? <>技能卡已关联 <span className="opacity-60 ml-1">{run.skill_card_id.slice(0, 8)}…</span></>
                    : '未关联技能卡（旧数据，请重新执行任务以生成关联）'
                  }
                </div>

                {/* ── Milestone 7 需求 5: 执行时刻参数快照（不可变） ─── */}
                {run.skill_card_id && (
                  <div>
                    <p className="text-xs font-mono text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                      <Camera className="w-3 h-3" />
                      执行时参数快照
                      {run.skill_version && (
                        <span className="text-primary opacity-70">v{run.skill_version}</span>
                      )}
                    </p>
                    {run.tunable_params_snapshot
                      ? (
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-1.5">
                          {Object.entries(run.tunable_params_snapshot).map(([k, v]) => (
                            <div key={k} className="flex flex-col gap-0.5 px-2 py-1.5 border border-border bg-muted/30">
                              <span className="text-[10px] font-mono text-muted-foreground truncate">{k}</span>
                              <span className="text-xs font-mono text-foreground">{String(v)}</span>
                            </div>
                          ))}
                        </div>
                      )
                      : (
                        <p className="text-xs font-mono text-muted-foreground px-2 py-1.5 border border-border bg-muted/20">
                          快照不可用（Milestone 7 前执行的历史记录）
                        </p>
                      )
                    }
                  </div>
                )}
                {/* 步骤执行结果 */}
                {run.steps_result?.length > 0 && (
                  <div>
                    <p className="text-xs font-mono text-muted-foreground mb-2">步骤执行结果</p>
                    <div className="space-y-1">
                      {run.steps_result.map((sr, idx) => (
                        <div key={idx} className={`flex items-start gap-2 p-1.5 text-xs font-mono border ${sr.status === 'success' ? 'border-primary/20 bg-primary/5' : 'border-red-400/20 bg-red-400/5'}`}>
                          {sr.status === 'success'
                            ? <CheckCircle className="w-3 h-3 text-primary shrink-0 mt-0.5" />
                            : <XCircle className="w-3 h-3 text-red-400 shrink-0 mt-0.5" />}
                          <div className="flex-1 min-w-0">
                            <span className="text-foreground">{sr.description}</span>
                            {sr.error && <p className="text-red-400 mt-0.5">{sr.error}</p>}
                          </div>
                          <span className="text-muted-foreground shrink-0">{sr.duration_ms}ms</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 白质层 AI 推理面板（仅失败任务显示）*/}
                {isFailed && (
                  <div>
                    <p className="text-xs font-mono text-muted-foreground uppercase tracking-wider mb-2">白质层推理</p>
                    <WhiteMatterPanel
                      taskRun={run}
                      task={task}
                      onAnalysisComplete={(analysis) => {
                        onRefresh();
                        onAnalysisComplete?.(run, analysis);
                      }}
                      autoStart={autoAnalyzeRunId === run.id}
                    />
                  </div>
                )}

                {/* 成功任务的简单摘要 */}
                {!isFailed && run.status === 'success' && (
                  <div className="flex items-center gap-2 p-2.5 border border-primary/20 bg-primary/5">
                    <CheckCircle className="w-3.5 h-3.5 text-primary shrink-0" />
                    <p className="text-xs font-mono text-primary">任务执行成功，所有步骤已完成</p>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function StepEditor({ steps, onChange }: { steps: TaskStep[]; onChange: (steps: TaskStep[]) => void }) {
  const addStep = (type: ActionType) => {
    const def = ACTION_DEFS[type];
    const newStep: TaskStep = {
      id: crypto.randomUUID(),
      type,
      description: `${def.label}操作`,
      selector: def.needsSelector ? '' : undefined,
      value: def.needsValue ? '' : undefined,
      order: steps.length,
    };
    onChange([...steps, newStep]);
  };

  const removeStep = (id: string) => onChange(steps.filter(s => s.id !== id));

  const updateStep = (id: string, field: keyof TaskStep, value: string) => {
    onChange(steps.map(s => s.id === id ? { ...s, [field]: value } : s));
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {(Object.keys(ACTION_DEFS) as ActionType[]).map(type => {
          const { icon: Icon, label } = ACTION_DEFS[type];
          return (
            <Button
              key={type}
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-xs font-mono gap-1.5 border-border text-muted-foreground hover:text-foreground hover:border-primary/40"
              onClick={() => addStep(type)}
            >
              <Icon className="w-3 h-3" />
              <Plus className="w-2.5 h-2.5" />
              {label}
            </Button>
          );
        })}
      </div>

      {steps.length === 0 ? (
        <div className="border border-dashed border-border p-6 text-center">
          <p className="text-xs text-muted-foreground font-mono">点击上方按钮添加操作步骤</p>
        </div>
      ) : (
        <div className="space-y-2">
          {steps.map((step, idx) => {
            const def = ACTION_DEFS[step.type];
            const StepIcon = def.icon;
            return (
              <div key={step.id} className="border border-border p-3 bg-card">
                <div className="flex items-center gap-2 mb-2">
                  <GripVertical className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <StepIcon className="w-3.5 h-3.5 text-primary shrink-0" />
                  <span className="text-xs font-mono text-muted-foreground shrink-0">#{idx + 1}</span>
                  <Input
                    value={step.description}
                    onChange={e => updateStep(step.id, 'description', e.target.value)}
                    className="h-6 text-xs font-mono bg-background border-border flex-1"
                    placeholder="步骤描述"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0 text-muted-foreground hover:text-red-400 shrink-0"
                    onClick={() => removeStep(step.id)}
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pl-8">
                  {def.needsSelector && (
                    <div>
                      <Label className="text-xs font-mono text-muted-foreground mb-1">选择器</Label>
                      <Input
                        value={step.selector || ''}
                        onChange={e => updateStep(step.id, 'selector', e.target.value)}
                        className="h-7 text-xs font-mono bg-background border-border"
                        placeholder={def.placeholder}
                      />
                    </div>
                  )}
                  {def.needsValue && (
                    <div>
                      <Label className="text-xs font-mono text-muted-foreground mb-1">
                        {step.type === 'fill' ? '填写内容' : step.type === 'wait' ? '等待时间(ms)' : '参数值'}
                      </Label>
                      <Input
                        value={step.value || ''}
                        onChange={e => updateStep(step.id, 'value', e.target.value)}
                        className="h-7 text-xs font-mono bg-background border-border"
                        placeholder={step.type === 'wait' ? '1000' : '输入值'}
                      />
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function TasksPage() {
  const { user, profile } = useAuth();
  const { notify } = useBrowserNotification();
  const [searchParams, setSearchParams] = useSearchParams();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [runs, setRuns] = useState<TaskRun[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [executing, setExecuting] = useState(false);
  /** 失败后自动分析：记录需要自动触发的 run id */
  const [autoAnalyzeRunId, setAutoAnalyzeRunId] = useState<string | null>(null);
  /** 通知跳转：仅展开目标记录，不触发 AI 分析 */
  const [expandRunId, setExpandRunId] = useState<string | null>(null);
  /** 防止 URL 参数处理重复执行 */
  const urlParamHandledRef = useRef(false);

  // 创建表单
  const [newName, setNewName] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newSteps, setNewSteps] = useState<TaskStep[]>([]);

  const fetchTasks = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data } = await supabase.from('tasks').select('*').eq('user_id', user.id).order('created_at', { ascending: false });
    setTasks(Array.isArray(data) ? data : []);
    setLoading(false);
  }, [user]);

  const fetchRuns = useCallback(async (taskId: string) => {
    setRunsLoading(true);
    const { data } = await supabase.from('task_runs').select('*').eq('task_id', taskId).order('started_at', { ascending: false }).limit(20);
    setRuns(Array.isArray(data) ? data : []);
    setRunsLoading(false);
  }, []);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);

  // Realtime：tasks 表变更 → 刷新任务列表（状态、run_count 等实时同步）
  const { lastChange: tasksChange } = useRealtimeSync({
    tables: ['tasks'],
    userId: user?.id,
  });
  useEffect(() => {
    if (tasksChange === 0) return;
    fetchTasks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasksChange]);

  // Realtime：当前选中任务的 task_runs 变更 → 刷新执行记录
  const selectedTaskIdRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    selectedTaskIdRef.current = selectedTask?.id;
  }, [selectedTask?.id]);

  const { lastChange: runsChange } = useRealtimeSync({
    tables: ['task_runs'],
    userId: user?.id,
    extraFilter: selectedTask ? { column: 'task_id', value: selectedTask.id } : undefined,
  });
  useEffect(() => {
    if (runsChange === 0 || !selectedTaskIdRef.current) return;
    fetchRuns(selectedTaskIdRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runsChange]);

  // 处理通知跳转：URL 带 task_id + run_id 时自动选中任务并展开对应记录
  useEffect(() => {
    const taskId = searchParams.get('task_id');
    const runId = searchParams.get('run_id');
    if (!taskId || loading || urlParamHandledRef.current) return;
    const target = tasks.find(t => t.id === taskId);
    if (!target) return;
    urlParamHandledRef.current = true;
    selectTask(target);
    if (runId) setExpandRunId(runId);
    // 清除 URL 参数，避免刷新时重复触发
    setSearchParams({}, { replace: true });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, loading, searchParams]);

  const selectTask = (task: Task) => {
    setSelectedTask(task);
    fetchRuns(task.id);
  };

  const createTask = async () => {
    if (!user || !newName.trim() || !newUrl.trim()) {
      toast.error('请填写任务名称和目标URL');
      return;
    }

    // 1. 插入任务（先不含 skill_card_id）
    const { data: taskData, error } = await supabase.from('tasks').insert({
      name: newName.trim(),
      target_url: newUrl.trim(),
      description: newDesc.trim() || null,
      steps_json: newSteps,
      status: 'pending',
      user_id: user.id,
    }).select('id').maybeSingle();
    if (error || !taskData) { toast.error('创建失败: ' + (error?.message ?? '未知错误')); return; }

    // 2. 自动生成候选技能卡（灰质-白质闭环：每个任务对应一张候选技能卡）
    const skillId = `skill_${newName.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '').slice(0, 30)}_${Date.now().toString(36)}`;
    const { data: cardData } = await supabase.from('skill_cards').insert({
      skill_id: skillId,
      name: `${newName.trim()} - 候选技能卡`,
      environment_type: 'web_automation',
      perception_sources: ['dom_elements', 'page_state', 'form_fields'],
      execution_surfaces: ['click', 'fill', 'select', 'wait', 'screenshot', 'press_key', 'navigate'],
      feedback_surfaces: ['page_redirect', 'element_change', 'dialog_popup'],
      tunable_params: { detection_threshold: 0.62, reaction_delay_ms: 100, retry_count: 3, timeout_ms: 5000, confidence_min: 0.7 },
      safety: { risk_level: 'low', fallback_action: 'stop', max_action_rate_per_second: 5 },
      metrics: { success_rate: 0, avg_latency_ms: 0, sample_count: 0 },
      status: 'candidate',
      version: '1.0.0',
      task_id: taskData.id,
      user_id: user.id,
    }).select('id').maybeSingle();

    // 3. 将 skill_card_id 回写到 task（外键绑定闭环）
    if (cardData?.id) {
      await supabase.from('tasks').update({ skill_card_id: cardData.id }).eq('id', taskData.id);
    }

    toast.success('任务创建成功，已自动生成候选技能卡');
    setCreateOpen(false);
    setNewName(''); setNewUrl(''); setNewDesc(''); setNewSteps([]);
    fetchTasks();
  };

  const executeTask = async (task: Task) => {
    if (!user) return;
    if (task.steps_json.length === 0) {
      toast.error('请先添加操作步骤');
      return;
    }
    setExecuting(true);
    // 创建执行记录（快照当前关联的技能卡 ID，确保 task_run 可追溯到执行时的技能版本）
    // Milestone 5 需求 1/2：同时快照 skill_version 和最新 skill_history_id
    // Milestone 7 需求 1+2：同时快照 tunable_params（不可变，后续更新/回滚不影响历史解释）
    let snapshotVersion: string | null = null;
    let snapshotHistoryId: string | null = null;
    let snapshotTunableParams: Record<string, unknown> | null = null;
    if (task.skill_card_id) {
      // 取技能卡当前版本 + tunable_params（一次查询，减少往返）
      const { data: cardSnap } = await supabase
        .from('skill_cards')
        .select('version, tunable_params')
        .eq('id', task.skill_card_id)
        .maybeSingle();
      snapshotVersion = cardSnap?.version ?? null;
      // 深拷贝 tunable_params，切断与后续 skill_card 更新的引用关系（需求 3）
      snapshotTunableParams = cardSnap?.tunable_params
        ? JSON.parse(JSON.stringify(cardSnap.tunable_params)) as Record<string, unknown>
        : null;
      // 取最新 skill_history 行
      const { data: histSnap } = await supabase
        .from('skill_history')
        .select('id')
        .eq('skill_card_id', task.skill_card_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      snapshotHistoryId = histSnap?.id ?? null;
    }

    const { data: runData, error: runError } = await supabase.from('task_runs').insert({
      task_id:                  task.id,
      skill_card_id:            task.skill_card_id ?? null,
      skill_version:            snapshotVersion,
      skill_history_id:         snapshotHistoryId,
      tunable_params_snapshot:  snapshotTunableParams,   // Milestone 7 需求 1+2
      status: 'running',
      user_id: user.id,
    }).select().maybeSingle();

    if (runError || !runData) {
      toast.error('执行初始化失败');
      setExecuting(false);
      return;
    }

    // 更新任务状态
    await supabase.from('tasks').update({ status: 'running' }).eq('id', task.id);
    if (selectedTask?.id === task.id) {
      setSelectedTask({ ...task, status: 'running' });
      fetchRuns(task.id);
    }
    toast.info('任务执行中...');

    // 模拟执行：传入快照参数，禁止读取 mutable 参数
    const result = await simulateTaskExecution(task.steps_json, snapshotTunableParams, runData.id, user.id);
    const endTime = new Date().toISOString();
    const duration = result.stepResults.reduce((a, s) => a + s.duration_ms, 0);

    // 更新执行记录
    await supabase.from('task_runs').update({
      status: result.success ? 'success' : 'failed',
      ended_at: endTime,
      duration_ms: duration,
      steps_result: result.stepResults,
      analysis: null,
      suggestions: [],
      error_message: result.success ? null : '部分步骤执行失败，请使用白质层AI推理进行根因分析',
      failed_step_index: result.success ? null : result.stepResults.findIndex(r => r.status === 'failed')
    }).eq('id', runData.id);

    // 更新任务统计
    await supabase.from('tasks').update({
      status: result.success ? 'success' : 'failed',
      last_run_at: endTime,
      run_count: task.run_count + 1,
      success_count: task.success_count + (result.success ? 1 : 0),
    }).eq('id', task.id);

    // 记录海马层
    await supabase.from('memory_episodes').insert({
      type: result.success ? 'success' : 'failure',
      title: `${task.name} - ${result.success ? '执行成功' : '执行失败'}`,
      content_json: { task_name: task.name, url: task.target_url, steps: task.steps_json.length, result },
      task_id: task.id,
      task_run_id: runData.id,
      tags: [task.status, result.success ? 'success' : 'failure'],
      user_id: user.id,
    });

    // 记录安全日志
    await supabase.from('security_logs').insert({
      action_name: `执行任务: ${task.name}`,
      action_detail: `目标: ${task.target_url}，共${task.steps_json.length}步`,
      risk_level: 'low',
      blocked: false,
      task_run_id: runData.id,
      user_id: user.id,
    });

    toast[result.success ? 'success' : 'error'](
      result.success
        ? '任务执行成功！'
        : profile?.auto_analyze_on_failure
          ? '任务执行失败，白质层 AI 正在自动分析...'
          : '任务执行失败，请查看复盘分析'
    );

    // 浏览器系统通知（页面隐藏时弹出）
    notify({
      title: result.success ? `✅ ${task.name}` : `❌ ${task.name}`,
      body: result.success
        ? `执行成功，共 ${task.steps_json.length} 步，耗时 ${(duration / 1000).toFixed(1)}s`
        : '执行失败，点击查看复盘分析',
    });

    // 失败后自动分析：若用户已开启该设置，记录 runId 触发自动推理
    if (!result.success && profile?.auto_analyze_on_failure) {
      setAutoAnalyzeRunId(runData.id);
    } else {
      setAutoAnalyzeRunId(null);
    }

    // Milestone 5 需求 3/4：任务完成后触发补丁效果评估（有技能卡时）
    // 静默执行，不影响正常执行流程
    if (task.skill_card_id) {
      supabase.rpc('evaluate_patch_outcome', {
        p_skill_card_id: task.skill_card_id,
        p_task_id:       task.id,
        p_task_run_id:   runData.id,
      }).then(({ data, error }) => {
        if (error) {
          // v6 起 NOT_FOUND 已改为优雅返回（不再抛异常），此分支仅处理真正的网络/权限错误
          console.warn('[evaluate_patch_outcome] unexpected error:', error.message);
          return;
        }
        const evalResult = data as PatchEvaluationResult | null;
        // 优雅跳过场景：无补丁记录 / legacy_run / run_not_found 等
        if (!evalResult?.ok) return;
        if (evalResult?.evaluation_status === 'evaluated') {
          const delta = evalResult.success_rate_delta ?? 0;
          // 生命周期前进提示（需求 8）
          if (evalResult.lifecycle_change.startsWith('advanced:')) {
            toast.success(`技能卡升阶：${evalResult.lifecycle_change.replace('advanced: ', '')}（连续 ${evalResult.consecutive_improved} 次有效）`);
          }
          // 无效补丁警告（需求 9）—— 触发受控回滚（Milestone 6 需求 1-3）
          else if (evalResult.lifecycle_change.startsWith('ineffective_patch:')) {
            toast.warning(`补丁无效警告：连续 ${evalResult.consecutive_degraded} 次未改善，技能卡已回退`);
            // 若本次评估产生了 ineffective_patch episode，自动触发回滚（静默执行）
            if (evalResult.ineffective_patch_episode_id && evalResult.skill_history_id) {
              supabase.rpc('apply_rollback_recommendation', {
                p_skill_card_id:           task.skill_card_id,
                p_ineffective_patch_ep_id: evalResult.ineffective_patch_episode_id,
                p_skill_history_id:        evalResult.skill_history_id,
                p_expected_version:        evalResult.new_version,
              }).then(({ data: rbData, error: rbError }) => {
                if (rbError) {
                  // VERSION_CONFLICT = 并发写入，静默忽略；其余打印 warn
                  if (!rbError.message?.includes('VERSION_CONFLICT')) {
                    console.warn('[apply_rollback_recommendation]', rbError.message);
                  }
                  return;
                }
                const rb = rbData as ApplyRollbackResult | null;
                if (rb?.ok) {
                  toast.info(`已自动回滚至 v${rb.prev_version}（新版本 v${rb.new_version}，${rb.rollback_params.length} 个参数已恢复）`);
                }
              });
            }
          }
          // 普通成功率变化提示
          else if (evalResult.improved === true && delta > 0) {
            toast.success(`补丁有效：成功率 +${delta.toFixed(1)}%（v${evalResult.prev_version} → v${evalResult.new_version}）`);
          } else if (evalResult.improved === false) {
            toast.warning(`补丁待观察：${evalResult.evaluation_summary}`);
          }
          // improved=null（部分改善）或 delta===0 静默，已写入 episode
        }
      });
    }

    setExecuting(false);
    fetchTasks();
    if (selectedTask?.id === task.id) fetchRuns(task.id);
  };

  const deleteTask = async (taskId: string) => {
    const { error } = await supabase.from('tasks').delete().eq('id', taskId);
    if (error) { toast.error('删除失败'); return; }
    toast.success('任务已删除');
    if (selectedTask?.id === taskId) setSelectedTask(null);
    fetchTasks();
  };

  return (
    <AppLayout title="任务管理">
      <div className="flex h-[calc(100vh-3rem)] overflow-hidden">
        {/* 左侧任务列表 */}
        <div className="w-full md:w-72 shrink-0 flex flex-col border-r border-border overflow-hidden">
          <div className="flex items-center justify-between p-3 border-b border-border">
            <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">任务列表</span>
            <div className="flex items-center gap-1.5">
              <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground" onClick={fetchTasks}>
                <RefreshCw className="w-3 h-3" />
              </Button>
              <Dialog open={createOpen} onOpenChange={setCreateOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" className="h-6 text-xs font-mono gap-1 bg-primary text-primary-foreground hover:bg-primary/90 px-2">
                    <Plus className="w-3 h-3" />新建
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-2xl bg-card border-border max-h-[90dvh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle className="text-sm font-mono text-foreground">创建网页自动化任务</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4 mt-2">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs font-mono text-muted-foreground">任务名称</Label>
                        <Input value={newName} onChange={e => setNewName(e.target.value)} className="h-8 text-xs font-mono bg-background border-border" placeholder="如：自动填写联系表单" />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs font-mono text-muted-foreground">目标URL</Label>
                        <Input value={newUrl} onChange={e => setNewUrl(e.target.value)} className="h-8 text-xs font-mono bg-background border-border" placeholder="https://example.com" />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-mono text-muted-foreground">描述（可选）</Label>
                      <Textarea value={newDesc} onChange={e => setNewDesc(e.target.value)} className="text-xs font-mono bg-background border-border min-h-16 resize-none" placeholder="任务用途说明" />
                    </div>
                    <Separator className="bg-border" />
                    <div>
                      <Label className="text-xs font-mono text-muted-foreground mb-3 block">操作步骤编辑器</Label>
                      <StepEditor steps={newSteps} onChange={setNewSteps} />
                    </div>
                    <div className="flex gap-2 justify-end">
                      <Button variant="outline" size="sm" className="h-8 text-xs font-mono border-border" onClick={() => setCreateOpen(false)}>取消</Button>
                      <Button size="sm" className="h-8 text-xs font-mono bg-primary text-primary-foreground hover:bg-primary/90" onClick={createTask}>
                        创建任务
                      </Button>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {loading ? (
              [...Array(4)].map((_, i) => <Skeleton key={i} className="h-16 bg-muted" />)
            ) : tasks.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-xs text-muted-foreground font-mono">暂无任务</p>
              </div>
            ) : (
              tasks.map(task => {
                const sm = TASK_STATUS_MAP[task.status];
                const Icon = sm.icon;
                const isSelected = selectedTask?.id === task.id;
                return (
                  <button
                    key={task.id}
                    className={`w-full text-left p-2.5 border transition-colors ${isSelected ? 'border-primary/60 bg-primary/5' : 'border-border hover:border-border/60 hover:bg-accent'}`}
                    onClick={() => selectTask(task)}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <Icon className={`w-3 h-3 shrink-0 ${task.status === 'success' ? 'text-primary' : task.status === 'failed' ? 'text-red-400' : task.status === 'running' ? 'text-blue-400' : 'text-muted-foreground'}`} />
                      <span className="text-xs font-semibold font-mono text-foreground flex-1 truncate">{task.name}</span>
                    </div>
                    <p className="text-xs text-muted-foreground font-mono truncate pl-5">{task.target_url}</p>
                    <div className="flex items-center gap-2 mt-1 pl-5">
                      <span className="text-xs text-muted-foreground font-mono">{task.steps_json.length}步</span>
                      <span className="text-xs text-muted-foreground font-mono">·</span>
                      <span className="text-xs text-muted-foreground font-mono">{task.run_count}次执行</span>
                      <span className="text-xs text-muted-foreground font-mono">·</span>
                      <span className={`text-xs font-mono flex items-center gap-0.5 ${task.skill_card_id ? 'text-primary/70' : 'text-yellow-500/60'}`}>
                        <Link2 className="w-2.5 h-2.5" />
                        {task.skill_card_id ? '技能卡已绑' : '无技能卡'}
                      </span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* 右侧详情 */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          {!selectedTask ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <Globe className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                <p className="text-sm font-mono text-muted-foreground">选择左侧任务查看详情</p>
                <p className="text-xs text-muted-foreground font-mono mt-1">或点击"新建"创建自动化任务</p>
              </div>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* 任务标题 */}
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h1 className="text-base font-bold font-mono text-foreground text-balance">{selectedTask.name}</h1>
                    <span className={`text-xs font-mono px-1.5 py-0.5 border task-${selectedTask.status}`}>
                      {TASK_STATUS_MAP[selectedTask.status].label}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 mt-1">
                    <ExternalLink className="w-3 h-3 text-muted-foreground" />
                    <a href={selectedTask.target_url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-400 font-mono hover:underline truncate">
                      {selectedTask.target_url}
                    </a>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    size="sm"
                    className="h-8 text-xs font-mono gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90"
                    onClick={() => executeTask(selectedTask)}
                    disabled={executing}
                  >
                    {executing ? <Activity className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                    {executing ? '执行中...' : '执行任务'}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-muted-foreground hover:text-red-400"
                    onClick={() => deleteTask(selectedTask.id)}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>

              {/* 统计 */}
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: '总执行', value: selectedTask.run_count },
                  { label: '成功', value: selectedTask.success_count },
                  { label: '成功率', value: selectedTask.run_count > 0 ? `${Math.round(selectedTask.success_count / selectedTask.run_count * 100)}%` : 'N/A' },
                ].map(({ label, value }) => (
                  <div key={label} className="bg-card border border-border p-3 text-center">
                    <div className="text-lg font-bold font-mono text-foreground">{value}</div>
                    <div className="text-xs font-mono text-muted-foreground">{label}</div>
                  </div>
                ))}
              </div>

              {/* 操作步骤 */}
              <div>
                <h3 className="text-xs font-mono text-muted-foreground uppercase tracking-wider mb-2">操作步骤（{selectedTask.steps_json.length}）</h3>
                {selectedTask.steps_json.length === 0 ? (
                  <div className="border border-dashed border-border p-4 text-center">
                    <AlertCircle className="w-5 h-5 text-muted-foreground mx-auto mb-1.5" />
                    <p className="text-xs text-muted-foreground font-mono">暂无操作步骤</p>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {selectedTask.steps_json.map((step, idx) => {
                      const def = ACTION_DEFS[step.type];
                      const StepIcon = def.icon;
                      return (
                        <div key={step.id} className="flex items-start gap-2 p-2.5 border border-border bg-card">
                          <span className="text-xs font-mono text-muted-foreground shrink-0 w-5 text-right">{idx + 1}</span>
                          <StepIcon className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-mono text-foreground">{step.description}</p>
                            {step.selector && <p className="text-xs font-mono text-muted-foreground mt-0.5">选择器: <span className="text-blue-400">{step.selector}</span></p>}
                            {step.value && <p className="text-xs font-mono text-muted-foreground mt-0.5">值: <span className="text-yellow-400">{step.value}</span></p>}
                          </div>
                          <span className="text-xs font-mono text-muted-foreground border border-border px-1.5 py-0.5 shrink-0">{def.label}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* 执行历史 */}
              <div>
                <h3 className="text-xs font-mono text-muted-foreground uppercase tracking-wider mb-2">执行历史</h3>
                <TaskRunHistory
                  runs={runs}
                  loading={runsLoading}
                  task={selectedTask}
                  onRefresh={() => fetchRuns(selectedTask.id)}
                  autoAnalyzeRunId={autoAnalyzeRunId}
                  expandRunId={expandRunId}
                  onAnalysisComplete={async (run, analysis) => {
                    if (!user) return;
                    const taskName = selectedTask.name;
                    const rootCause = analysis.root_cause ?? '请查看详细分析结果';
                    // 1. 站内通知
                    await insertNotification({
                      userId: user.id,
                      title: `「${taskName}」白质层分析完成`,
                      body: rootCause.length > 80 ? rootCause.slice(0, 80) + '…' : rootCause,
                      type: 'success',
                      taskId: run.task_id,
                      taskRunId: run.id,
                    });
                    // 2. 浏览器推送（依据偏好设置）
                    if (profile?.notify_on_analysis) {
                      sendBrowserNotification(
                        `白质层分析完成：${taskName}`,
                        rootCause.length > 100 ? rootCause.slice(0, 100) + '…' : rootCause,
                      );
                    }
                  }}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
