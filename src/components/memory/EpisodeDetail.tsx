// 海马层经验记录详情组件
// 根据 episode type / tags 渲染不同的结构化视图：
//   failure + white_matter → 失败片段详情（根本原因、受影响步骤、建议、参数补丁）
//   success               → 成功轨迹回放（操作序列逐步展示）
//   parameter_patch       → 参数补丁详情
//   episode + env_profile → 环境能力画像
//   其他                  → 原始 JSON fallback
import { useState } from 'react';
import { Progress } from '@/components/ui/progress';
import type {
  MemoryEpisode,
  WhiteMatterEpisodeContent,
  FailureType,
  AffectedStep,
  WhiteMatterSuggestion,
  ParamPatch,
  StepResult,
} from '@/types/types';
import {
  AlertTriangle, CheckCircle, XCircle, ArrowRight,
  Activity, Layers, Eye, Zap, MessageSquare, Wrench,
  ChevronRight, Clock, Tag,
} from 'lucide-react';

// ── 常量映射 ──────────────────────────────────────────────
const FAILURE_TYPE_LABELS: Record<FailureType, string> = {
  element_not_found: '元素未找到',
  timeout: '执行超时',
  assertion_failed: '断言失败',
  navigation_error: '导航错误',
  permission_denied: '权限拒绝',
  unknown: '未知',
};

const FAILURE_TYPE_COLORS: Record<FailureType, string> = {
  element_not_found: 'text-orange-400 border-orange-400/40 bg-orange-400/5',
  timeout:           'text-yellow-400 border-yellow-400/40 bg-yellow-400/5',
  assertion_failed:  'text-red-400 border-red-400/40 bg-red-400/5',
  navigation_error:  'text-blue-400 border-blue-400/40 bg-blue-400/5',
  permission_denied: 'text-purple-400 border-purple-400/40 bg-purple-400/5',
  unknown:           'text-muted-foreground border-border bg-card/50',
};

const PRIORITY_STYLES = {
  high:   'text-red-400 border-red-400/40 bg-red-400/5',
  medium: 'text-yellow-400 border-yellow-400/40 bg-yellow-400/5',
  low:    'text-muted-foreground border-border',
};

const PRIORITY_LABELS = { high: '高', medium: '中', low: '低' };

const STEP_STATUS_ICON = {
  success: CheckCircle,
  failed:  XCircle,
  skipped: Clock,
};

const STEP_STATUS_COLOR = {
  success: 'text-primary',
  failed:  'text-red-400',
  skipped: 'text-muted-foreground',
};

// ── 工具：安全提取字段 ────────────────────────────────────
function safeStr(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}
function safeNum(v: unknown, fallback = 0): number {
  return typeof v === 'number' ? v : fallback;
}
function safeArr<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

// ── 子组件：分节标题 ─────────────────────────────────────
function SectionTitle({ icon: Icon, children, count }: {
  icon: React.ElementType; children: React.ReactNode; count?: number;
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
      <span className="text-xs font-mono font-bold text-foreground uppercase tracking-wider">{children}</span>
      {count !== undefined && (
        <span className="text-xs font-mono text-muted-foreground normal-case font-normal">({count})</span>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// 1. 失败片段详情（type=failure + tags=white_matter）
// ══════════════════════════════════════════════════════════
function FailureDetail({ content }: { content: WhiteMatterEpisodeContent }) {
  const ft = (content.failure_type in FAILURE_TYPE_LABELS)
    ? content.failure_type
    : 'unknown';
  const ftStyle = FAILURE_TYPE_COLORS[ft];
  const confidence = Math.round(content.confidence * 100);

  return (
    <div className="space-y-4">
      {/* 失败类型 + 置信度 */}
      <div className="grid grid-cols-2 gap-3">
        <div className="border border-border bg-card/50 p-3 space-y-1">
          <p className="text-xs font-mono text-muted-foreground">失败类型</p>
          <span className={`inline-flex text-xs font-mono font-bold px-2 py-0.5 border ${ftStyle}`}>
            {FAILURE_TYPE_LABELS[ft]}
          </span>
        </div>
        <div className="border border-border bg-card/50 p-3 space-y-1.5">
          <div className="flex items-center justify-between">
            <p className="text-xs font-mono text-muted-foreground">推理置信度</p>
            <span className={`text-xs font-mono font-bold ${confidence >= 75 ? 'text-primary' : confidence >= 50 ? 'text-yellow-400' : 'text-red-400'}`}>
              {confidence}%
            </span>
          </div>
          <Progress value={confidence} className="h-1.5" />
        </div>
      </div>

      {/* 根本原因 */}
      <div className="space-y-1.5">
        <SectionTitle icon={AlertTriangle}>根本原因</SectionTitle>
        <div className="border border-orange-400/30 bg-orange-400/5 p-3">
          <p className="text-xs font-mono text-foreground leading-relaxed text-pretty">{content.root_cause}</p>
        </div>
      </div>

      {/* 推理摘要 */}
      {content.reasoning_summary && (
        <div className="space-y-1.5">
          <SectionTitle icon={MessageSquare}>推理摘要</SectionTitle>
          <div className="border border-border bg-card/50 p-3">
            <p className="text-xs font-mono text-muted-foreground leading-relaxed text-pretty">{content.reasoning_summary}</p>
          </div>
        </div>
      )}

      {/* 受影响步骤 */}
      {content.affected_steps.length > 0 && (
        <div className="space-y-1.5">
          <SectionTitle icon={Activity} count={content.affected_steps.length}>受影响步骤</SectionTitle>
          <div className="space-y-1.5">
            {content.affected_steps.map((s: AffectedStep, i: number) => {
              // Milestone 10 向后兼容
              const action = (s as unknown as Record<string,string>).action_type ?? (s as unknown as Record<string,string>).action ?? '';
              const evidence = (s as unknown as Record<string,string>).evidence_summary ?? (s as unknown as Record<string,string>).description ?? '';
              const status = (s as unknown as Record<string,string>).status;
              const errorCode = (s as unknown as Record<string,string | null>).error_code;
              const errorMsg = (s as unknown as Record<string,string | null>).error_message;
              const riskLevel = (s as unknown as Record<string,string | null>).safety_risk_level;
              const selector = (s as unknown as Record<string,string | null>).target_selector;
              return (
                <div key={i} className="flex flex-col gap-1 border border-border/60 bg-card/30 px-3 py-2">
                  <div className="flex items-start gap-2">
                    <span className="text-xs font-mono text-muted-foreground shrink-0 w-6">#{s.step_index}</span>
                    <code className="text-xs font-mono text-yellow-400 shrink-0">{action}</code>
                    {status && <span className="text-xs font-mono text-muted-foreground">[{status}]</span>}
                    {selector && <code className="text-xs font-mono text-muted-foreground truncate">{selector}</code>}
                  </div>
                  {errorCode && (
                    <div className="flex gap-2 text-xs font-mono">
                      <span className="text-red-400">{errorCode}</span>
                      {errorMsg && <span className="text-muted-foreground">{errorMsg}</span>}
                    </div>
                  )}
                  {riskLevel && riskLevel !== 'low' && (
                    <span className="text-xs font-mono text-orange-400">风险等级: {riskLevel}</span>
                  )}
                  <span className="text-xs font-mono text-muted-foreground text-pretty">{evidence}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 优化建议 */}
      {content.suggestions.length > 0 && (
        <div className="space-y-1.5">
          <SectionTitle icon={ChevronRight} count={content.suggestions.length}>优化建议</SectionTitle>
          <div className="space-y-1.5">
            {content.suggestions.map((s: WhiteMatterSuggestion, i: number) => {
              const ps = PRIORITY_STYLES[s.priority] ?? PRIORITY_STYLES.low;
              return (
                <div key={i} className="border border-border/60 bg-card/30 p-3 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-mono px-1.5 py-0.5 border ${ps}`}>
                      {PRIORITY_LABELS[s.priority] ?? s.priority}优先
                    </span>
                    <span className="text-xs font-mono font-semibold text-foreground">{s.action}</span>
                  </div>
                  <p className="text-xs font-mono text-muted-foreground pl-0.5 text-pretty">{s.detail}</p>
                  {Array.isArray((s as any).evidence_step_indexes) && ((s as any).evidence_step_indexes as number[]).length > 0 && (
                    <div className="flex items-center gap-1.5 pt-1">
                      <span className="text-[10px] font-mono text-muted-foreground">证据步骤:</span>
                      {((s as any).evidence_step_indexes as number[]).map((idx) => (
                        <span key={idx} className="text-[10px] font-mono px-1 border border-border bg-secondary/40">#{idx}</span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 参数补丁 */}
      {content.param_patches.length > 0 && (
        <div className="space-y-1.5">
          <SectionTitle icon={Wrench} count={content.param_patches.length}>参数补丁建议</SectionTitle>
          <div className="space-y-1.5">
            {content.param_patches.map((p: ParamPatch, i: number) => (
              <div key={i} className="border border-primary/20 bg-primary/5 p-3 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <code className="text-xs font-mono text-foreground font-bold">{p.param_name}</code>
                  <code className="text-xs font-mono text-red-400 bg-red-400/10 px-1 line-through">{p.old_value}</code>
                  <ArrowRight className="w-3 h-3 text-muted-foreground shrink-0" />
                  <code className="text-xs font-mono text-primary bg-primary/10 px-1">{p.suggested_value}</code>
                </div>
                <p className="text-xs font-mono text-muted-foreground text-pretty">{p.reason}</p>
                {Array.isArray(p.evidence_step_indexes) && p.evidence_step_indexes.length > 0 && (
                  <div className="flex items-center gap-1.5 pt-1">
                    <span className="text-[10px] font-mono text-muted-foreground">证据步骤:</span>
                    {p.evidence_step_indexes.map((idx) => (
                      <span key={idx} className="text-[10px] font-mono px-1 border border-border bg-secondary/40">#{idx}</span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// 2. 成功轨迹回放（type=success）
// ══════════════════════════════════════════════════════════
interface SuccessContent {
  steps_result?: StepResult[];
  target_url?: string;
  duration_ms?: number;
  task_name?: string;
  environment_type?: string;
}

function SuccessTrajectory({ content }: { content: SuccessContent }) {
  const steps = safeArr<StepResult>(content.steps_result);
  const [activeStep, setActiveStep] = useState<number | null>(null);

  return (
    <div className="space-y-4">
      {/* 概览 */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        {content.target_url && (
          <div className="border border-border bg-card/50 p-2.5 col-span-2 md:col-span-1">
            <p className="text-xs font-mono text-muted-foreground mb-0.5">目标 URL</p>
            <p className="text-xs font-mono text-foreground truncate">{content.target_url}</p>
          </div>
        )}
        {content.duration_ms !== undefined && (
          <div className="border border-border bg-card/50 p-2.5">
            <p className="text-xs font-mono text-muted-foreground mb-0.5">耗时</p>
            <p className="text-xs font-mono text-primary font-bold">{content.duration_ms} ms</p>
          </div>
        )}
        {content.environment_type && (
          <div className="border border-border bg-card/50 p-2.5">
            <p className="text-xs font-mono text-muted-foreground mb-0.5">环境类型</p>
            <p className="text-xs font-mono text-foreground">{content.environment_type}</p>
          </div>
        )}
      </div>

      {/* 操作序列 */}
      {steps.length > 0 ? (
        <div className="space-y-1.5">
          <SectionTitle icon={Activity} count={steps.length}>操作序列回放</SectionTitle>
          <div className="space-y-1">
            {steps.map((step, i) => {
              const StatusIcon = STEP_STATUS_ICON[step.status] ?? Activity;
              const statusColor = STEP_STATUS_COLOR[step.status] ?? 'text-muted-foreground';
              const isOpen = activeStep === i;
              const hasDetail = step.error || step.description;
              return (
                <div key={i} className={`border transition-colors ${step.status === 'success' ? 'border-primary/20' : step.status === 'failed' ? 'border-red-400/30' : 'border-border/50'}`}>
                  <button
                    onClick={() => hasDetail ? setActiveStep(isOpen ? null : i) : undefined}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-left ${hasDetail ? 'hover:bg-white/5 cursor-pointer' : 'cursor-default'}`}
                  >
                    {/* 步骤号 */}
                    <span className="text-xs font-mono text-muted-foreground w-5 shrink-0">#{i + 1}</span>

                    {/* 状态图标 */}
                    <StatusIcon className={`w-3.5 h-3.5 shrink-0 ${statusColor}`} />

                    {/* 动作类型 */}
                    <code className={`text-xs font-mono font-bold shrink-0 ${statusColor}`}>{step.type}</code>

                    {/* 描述 */}
                    <span className="text-xs font-mono text-muted-foreground flex-1 min-w-0 truncate">
                      {step.description}
                    </span>

                    {/* 耗时 */}
                    {step.duration_ms > 0 && (
                      <span className="text-xs font-mono text-muted-foreground/60 shrink-0">{step.duration_ms}ms</span>
                    )}

                    {/* 展开指示器 */}
                    {hasDetail && (
                      isOpen
                        ? <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0 rotate-90" />
                        : <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />
                    )}
                  </button>

                  {/* 展开详情 */}
                  {isOpen && (
                    <div className="border-t border-current/20 px-3 py-2 bg-black/10 space-y-1">
                      {step.error && (
                        <p className="text-xs font-mono text-red-400">
                          <span className="text-muted-foreground">错误：</span>{step.error}
                        </p>
                      )}
                      {step.description && (
                        <p className="text-xs font-mono text-muted-foreground">{step.description}</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {/* 成功摘要 */}
          <div className="flex items-center gap-3 border border-primary/20 bg-primary/5 px-3 py-2 mt-1">
            <CheckCircle className="w-3.5 h-3.5 text-primary shrink-0" />
            <span className="text-xs font-mono text-primary">
              全部 {steps.filter(s => s.status === 'success').length}/{steps.length} 步骤执行成功
            </span>
          </div>
        </div>
      ) : (
        <div className="border border-border bg-card/50 p-6 text-center">
          <p className="text-xs font-mono text-muted-foreground">暂无步骤详情记录</p>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// 3. 环境能力画像（episode + tags 含 env_profile）
// ══════════════════════════════════════════════════════════
interface EnvProfileContent {
  url?: string;
  target_url?: string; // 兼容旧数据
  environment_type?: string;
  perception_surfaces?: string[];
  execution_surfaces?: string[];
  feedback_surfaces?: string[];
  missing_capabilities?: string[];
  recommended_adapters?: string[];
  scan_status?: string;
  scan_error?: string | null;
  elements?: any[];
}

function EnvProfileDetail({ content }: { content: EnvProfileContent }) {
  const sections = [
    { icon: Eye, label: '感知面（Perception）', items: safeArr<string>(content.perception_surfaces), color: 'text-blue-400 border-blue-400/30' },
    { icon: Zap, label: '执行面（Execution）', items: safeArr<string>(content.execution_surfaces), color: 'text-primary border-primary/30' },
    { icon: MessageSquare, label: '反馈面（Feedback）', items: safeArr<string>(content.feedback_surfaces), color: 'text-yellow-400 border-yellow-400/30' },
  ];

  return (
    <div className="space-y-4">
      {/* URL + 环境类型 */}
      <div className="grid grid-cols-2 gap-2">
        {(content.url || content.target_url) && (
          <div className="border border-border bg-card/50 p-2.5 col-span-2">
            <p className="text-xs font-mono text-muted-foreground mb-0.5">目标 URL</p>
            <p className="text-xs font-mono text-foreground break-words">{content.url || content.target_url}</p>
          </div>
        )}
        {content.environment_type && (
          <div className="border border-border bg-card/50 p-2.5">
            <p className="text-xs font-mono text-muted-foreground mb-0.5">环境类型</p>
            <p className="text-xs font-mono text-foreground font-bold">{content.environment_type}</p>
          </div>
        )}
        {content.scan_status && (
          <div className="border border-border bg-card/50 p-2.5">
            <p className="text-xs font-mono text-muted-foreground mb-0.5">扫描状态</p>
            <p className="text-xs font-mono text-foreground capitalize">{content.scan_status}</p>
          </div>
        )}
        {content.elements !== undefined && (
          <div className="border border-border bg-card/50 p-2.5">
            <p className="text-xs font-mono text-muted-foreground mb-0.5">DOM 元素数</p>
            <p className="text-xs font-mono text-foreground">{content.elements.length}</p>
          </div>
        )}
        {content.scan_error && (
          <div className="border border-border bg-card/50 p-2.5 col-span-2">
            <p className="text-xs font-mono text-muted-foreground mb-0.5">扫描错误</p>
            <p className="text-xs font-mono text-red-400 break-words">{content.scan_error}</p>
          </div>
        )}
      </div>

      {/* 三个能力面 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {sections.map(({ icon: Icon, label, items, color }) => (
          <div key={label} className={`border ${color.split(' ')[1]} p-3 space-y-2`}>
            <div className="flex items-center gap-1.5">
              <Icon className={`w-3.5 h-3.5 ${color.split(' ')[0]}`} />
              <span className={`text-xs font-mono font-bold ${color.split(' ')[0]}`}>{label}</span>
            </div>
            {items.length > 0 ? (
              <div className="space-y-1">
                {items.map((item, i) => (
                  <div key={i} className="flex items-center gap-1.5 text-xs font-mono text-foreground">
                    <span className="w-1 h-1 rounded-full bg-current shrink-0 opacity-60" />
                    {item}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs font-mono text-muted-foreground">未检测到</p>
            )}
          </div>
        ))}
      </div>

      {/* 缺失能力 */}
      {safeArr<string>(content.missing_capabilities).length > 0 && (
        <div className="space-y-1.5">
          <SectionTitle icon={AlertTriangle}>缺失能力</SectionTitle>
          <div className="flex flex-wrap gap-1.5">
            {safeArr<string>(content.missing_capabilities).map((c, i) => (
              <span key={i} className="text-xs font-mono px-2 py-0.5 border border-red-400/30 text-red-400 bg-red-400/5">{c}</span>
            ))}
          </div>
        </div>
      )}

      {/* 推荐适配器 */}
      {safeArr<string>(content.recommended_adapters).length > 0 && (
        <div className="space-y-1.5">
          <SectionTitle icon={Layers}>推荐适配器</SectionTitle>
          <div className="flex flex-wrap gap-1.5">
            {safeArr<string>(content.recommended_adapters).map((a, i) => (
              <span key={i} className="text-xs font-mono px-2 py-0.5 border border-primary/30 text-primary bg-primary/5">{a}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// 4. 参数补丁详情（type=parameter_patch）
// ══════════════════════════════════════════════════════════
interface ParamPatchContent {
  patches?: ParamPatch[];
  source?: string;
  skill_name?: string;
  applied_at?: string;
}

function ParamPatchDetail({ content }: { content: ParamPatchContent }) {
  const patches = safeArr<ParamPatch>(content.patches);

  return (
    <div className="space-y-4">
      {/* 来源元信息 */}
      <div className="grid grid-cols-2 gap-2">
        {content.skill_name && (
          <div className="border border-border bg-card/50 p-2.5">
            <p className="text-xs font-mono text-muted-foreground mb-0.5">关联技能卡</p>
            <p className="text-xs font-mono text-foreground font-bold">{content.skill_name}</p>
          </div>
        )}
        {content.source && (
          <div className="border border-border bg-card/50 p-2.5">
            <p className="text-xs font-mono text-muted-foreground mb-0.5">来源</p>
            <p className="text-xs font-mono text-foreground">{content.source}</p>
          </div>
        )}
      </div>

      {/* 补丁列表 */}
      {patches.length > 0 ? (
        <div className="space-y-1.5">
          <SectionTitle icon={Wrench} count={patches.length}>参数变更记录</SectionTitle>
          <div className="space-y-1.5">
            {patches.map((p, i) => (
              <div key={i} className="border border-primary/20 bg-primary/5 p-3 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <code className="text-xs font-mono text-foreground font-bold">{p.param_name}</code>
                  <code className="text-xs font-mono text-red-400 bg-red-400/10 px-1 line-through">{p.old_value}</code>
                  <ArrowRight className="w-3 h-3 text-muted-foreground shrink-0" />
                  <code className="text-xs font-mono text-primary bg-primary/10 px-1">{p.suggested_value}</code>
                </div>
                <p className="text-xs font-mono text-muted-foreground text-pretty">{p.reason}</p>
                {Array.isArray(p.evidence_step_indexes) && p.evidence_step_indexes.length > 0 && (
                  <div className="flex items-center gap-1.5 pt-1">
                    <span className="text-[10px] font-mono text-muted-foreground">证据步骤:</span>
                    {p.evidence_step_indexes.map((idx) => (
                      <span key={idx} className="text-[10px] font-mono px-1 border border-border bg-secondary/40">#{idx}</span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="border border-border bg-card/50 p-6 text-center">
          <p className="text-xs font-mono text-muted-foreground">暂无参数变更详情</p>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// 主组件：根据 type + tags 路由到对应视图
// ══════════════════════════════════════════════════════════
interface Props {
  episode: MemoryEpisode;
}

export default function EpisodeDetail({ episode }: Props) {
  const { type, tags, content_json: raw } = episode;
  const isWhiteMatter = tags.includes('white_matter');
  const isEnvProfile = tags.includes('env_profile');

  // ── 路由决策 ────────────────────────────────────────────
  if (type === 'failure' && isWhiteMatter) {
    // 白质层失败分析
    const c = raw as Partial<WhiteMatterEpisodeContent>;
    if (typeof c.root_cause === 'string') {
      return <FailureDetail content={{
        task_run_id:      safeStr(c.task_run_id),
        root_cause:       safeStr(c.root_cause),
        failure_type:     (c.failure_type as FailureType) ?? 'unknown',
        affected_steps:   safeArr<AffectedStep>(c.affected_steps),
        suggestions:      safeArr<WhiteMatterSuggestion>(c.suggestions),
        param_patches:    safeArr<ParamPatch>(c.param_patches),
        confidence:       safeNum(c.confidence),
        reasoning_summary: safeStr(c.reasoning_summary),
      }} />;
    }
  }

  if (type === 'success') {
    return <SuccessTrajectory content={raw as SuccessContent} />;
  }

  if (type === 'parameter_patch') {
    return <ParamPatchDetail content={raw as ParamPatchContent} />;
  }

  if (isEnvProfile || (type === 'episode' && (raw as Record<string, unknown>).perception_surfaces)) {
    return <EnvProfileDetail content={raw as EnvProfileContent} />;
  }

  // ── Fallback：通用原始 JSON 展示（格式化可折叠） ─────────
  return <GenericDetail raw={raw} episode={episode} />;
}

// ── Fallback：通用视图 ────────────────────────────────────
function GenericDetail({ raw, episode }: { raw: Record<string, unknown>; episode: MemoryEpisode }) {
  const [showRaw, setShowRaw] = useState(false);
  const keys = Object.keys(raw);

  return (
    <div className="space-y-3">
      {/* 简单键值对预览 */}
      {keys.length > 0 && (
        <div className="space-y-1.5">
          {keys.slice(0, 8).map(k => {
            const v = raw[k];
            const display = typeof v === 'string' ? v
              : typeof v === 'number' ? String(v)
              : typeof v === 'boolean' ? (v ? '是' : '否')
              : Array.isArray(v) ? `[${v.length} 项]`
              : typeof v === 'object' ? '{对象}'
              : String(v);
            return (
              <div key={k} className="flex items-start gap-2 text-xs font-mono">
                <span className="text-muted-foreground shrink-0 min-w-[120px]">{k}</span>
                <span className="text-foreground text-pretty">{display}</span>
              </div>
            );
          })}
          {keys.length > 8 && (
            <p className="text-xs font-mono text-muted-foreground">…还有 {keys.length - 8} 个字段</p>
          )}
        </div>
      )}

      {/* 标签展示 */}
      {episode.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {episode.tags.map(tag => (
            <span key={tag} className="flex items-center gap-1 text-xs font-mono px-1.5 py-0.5 border border-border text-muted-foreground">
              <Tag className="w-2.5 h-2.5" />{tag}
            </span>
          ))}
        </div>
      )}

      {/* 完整 JSON 折叠 */}
      <button
        onClick={() => setShowRaw(v => !v)}
        className="text-xs font-mono text-muted-foreground hover:text-foreground flex items-center gap-1"
      >
        <ChevronRight className={`w-3 h-3 transition-transform ${showRaw ? 'rotate-90' : ''}`} />
        {showRaw ? '收起' : '查看'}原始 JSON
      </button>
      {showRaw && (
        <pre className="text-xs font-mono text-foreground bg-background border border-border p-3 overflow-x-auto max-h-56">
          {JSON.stringify(raw, null, 2)}
        </pre>
      )}
    </div>
  );
}
