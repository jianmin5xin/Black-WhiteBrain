// ========== 枚举类型 ==========
export type UserRole = 'user' | 'admin';
export type SkillStatus = 'candidate' | 'temporary' | 'sandbox' | 'gray_matter' | 'mature' | 'universal' | 'deprecated';
export type RiskLevel = 'low' | 'medium' | 'high' | 'forbidden';
export type TaskStatus = 'pending' | 'running' | 'success' | 'failed';
export type EpisodeType = 'episode' | 'failure' | 'success' | 'parameter_patch' | 'patch_evaluation' | 'rollback_applied';
export type ActionType = 'click' | 'fill' | 'wait' | 'screenshot' | 'handle_dialog' | 'navigate' | 'extract';

// ========== 用户档案 ==========
export interface Profile {
  id: string;
  email: string | null;
  phone: string | null;
  username: string | null;
  role: UserRole;
  // 系统偏好设置
  auto_analyze_on_failure: boolean;  // 任务失败后自动触发白质层AI推理
  notify_on_analysis: boolean;       // 分析完成后发送浏览器推送通知
  created_at: string;
  updated_at: string;
}

// ========== 任务操作步骤 ==========
export interface TaskStep {
  id: string;
  type: ActionType;
  description: string;
  selector?: string;
  value?: string;
  wait_ms?: number;
  order: number;
}

// ========== 任务 ==========
export interface Task {
  id: string;
  name: string;
  target_url: string;
  description: string | null;
  steps_json: TaskStep[];
  status: TaskStatus;
  last_run_at: string | null;
  run_count: number;
  success_count: number;
  /** 创建任务时自动生成的候选技能卡 ID */
  skill_card_id: string | null;
  user_id: string;
  created_at: string;
  updated_at: string;
}

// ========== 任务执行记录 ==========
export interface StepResult {
  step_id: string;
  type: ActionType;
  description: string;
  status: 'success' | 'failed' | 'skipped';
  duration_ms: number;
  error?: string;
  screenshot?: string;
}

export interface TaskRunStep {
  id: string;
  task_run_id: string;
  user_id: string;
  step_index: number;
  action_type: string;
  target_selector: string | null;
  input_value_snapshot: Record<string, unknown> | null;
  status: 'running' | 'success' | 'failed' | 'skipped';
  started_at: string;
  ended_at: string | null;
  duration_ms: number | null;
  error_code: string | null;
  error_message: string | null;
  safety_risk_level: RiskLevel | null;
  screenshot_ref: string | null;
  dom_snapshot_ref: string | null;
  created_at: string;
}

export interface TaskRun {
  id: string;
  task_id: string;
  /** 执行时使用的技能卡 ID（从 task.skill_card_id 快照） */
  skill_card_id: string | null;
  /** 执行开始时的技能卡版本号快照（Milestone 5 需求 1/2） */
  skill_version: string | null;
  /** 执行开始时对应的 skill_history 行 ID（Milestone 5 需求 1/2） */
  skill_history_id: string | null;
  /**
   * 执行开始时 skill_card.tunable_params 的不可变深拷贝（Milestone 7 需求 1-3）。
   * - INSERT 时一次性写入，永不 UPDATE
   * - null = 旧数据（M7 前执行的 run），降级显示提示
   * - 后续 skill_card 更新/rollback/promotion 不影响此字段
   */
  tunable_params_snapshot: Record<string, unknown> | null;
  /**
   * Milestone 7 需求 6：skill_history_id IS NULL OR tunable_params_snapshot IS NULL 时为 true。
   * - 由 BEFORE INSERT 触发器自动计算，不可手动修改
   * - legacy_run 不参与严格 patch evaluation（evaluate_patch_outcome 返回 legacy_run_skipped）
   */
  is_legacy_run: boolean;
  failed_step_index: number | null;
  status: TaskStatus;
  started_at: string;
  ended_at: string | null;
  duration_ms: number | null;
  error_message: string | null;
  steps_result: StepResult[];
  analysis: WhiteMatterAnalysis | null;
  suggestions: WhiteMatterSuggestion[];
  user_id: string;
  task?: Task;
}

// ========== 白质层 AI 推理结果 ==========
export type FailureType =
  | 'element_not_found'
  | 'timeout'
  | 'assertion_failed'
  | 'navigation_error'
  | 'permission_denied'
  | 'unknown';

/** Milestone 10: 白质层分析基于 task_run_steps 的 Grounded Affected Step */
export interface AffectedStep {
  step_index: number;
  action_type: string;
  target_selector: string | null;
  status: string;
  error_code: string | null;
  error_message: string | null;
  safety_risk_level: string | null;
  evidence_summary: string;
}

export interface WhiteMatterSuggestion {
  priority: 'high' | 'medium' | 'low';
  action: string;
  detail: string;
  /** Milestone 10: 每条建议必须附有证据步骤索引 */
  evidence_step_indexes: number[];
}

/**
 * 参数补丁统一字段契约
 * - old_value       : 修改前的原始值（来自白质层推理时的当前技能卡参数快照）
 * - suggested_value : AI 建议的目标值（白质层推理输出）
 * - applied_value   : 用户实际应用的值（写入技能卡时快照，通常 = suggested_value）
 * - applied_at      : 补丁实际落地时间（与推理时间不同，体现"建议→落地"延迟）
 */
export interface ParamPatch {
  param_name: string;
  old_value: string;
  suggested_value: string;
  reason: string;
  /** Milestone 10: 每条参数补丁必须附有证据步骤索引 */
  evidence_step_indexes: number[];
  /** 仅在 memory_episodes(type=parameter_patch) 中存在，推理输出阶段为 undefined */
  applied_value?: string;
  /** 补丁实际落地 ISO 时间戳，仅 parameter_patch 类型 episode 携带 */
  applied_at?: string;
}

export interface WhiteMatterAnalysis {
  root_cause: string;
  failure_type: FailureType;
  affected_steps: AffectedStep[];
  suggestions: WhiteMatterSuggestion[];
  param_patches: ParamPatch[];
  confidence: number;
  reasoning_summary: string;
}

// ========== 技能卡 ==========
export interface TunableParams {
  detection_threshold?: number;
  danger_threshold?: number;
  reaction_delay_ms?: number;
  aggression?: number;
  defense_bias?: number;
  retry_count?: number;
  timeout_ms?: number;
  confidence_min?: number;
  /**
   * 参数别名映射表（v0.1 预留）
   * key   = 别名（AI 可能输出的变体名，如 "timeout" / "task_timeout"）
   * value = 技能卡内部规范参数名（canonical name，如 "timeout_ms"）
   *
   * 用法：当白质层推理输出的 param_name 不精确匹配 tunable_params 键时，
   * 通过此表将别名归一化为规范名，确保同一技能卡内参数名唯一且一致。
   *
   * 未来可扩展为跨技能卡的全局别名注册表。
   */
  param_alias_map?: Record<string, string>;
  [key: string]: number | string | Record<string, string> | undefined;
}

export interface SkillSafety {
  risk_level: RiskLevel;
  fallback_action: string;
  max_action_rate_per_second: number;
}

export interface SkillMetrics {
  success_rate: number;
  avg_latency_ms: number;
  sample_count: number;
}

export interface SkillCard {
  id: string;
  skill_id: string;
  name: string;
  environment_type: string;
  perception_sources: string[];
  execution_surfaces: string[];
  feedback_surfaces: string[];
  tunable_params: TunableParams;
  safety: SkillSafety;
  metrics: SkillMetrics;
  policy: string | null;
  status: SkillStatus;
  version: string;
  task_id: string | null;
  user_id: string;
  created_at: string;
  updated_at: string;
}

// ========== 技能版本历史 ==========
export interface SkillHistory {
  id: string;
  skill_card_id: string;
  version: string;
  changes_json: Record<string, unknown>;
  tunable_params: TunableParams;
  status: SkillStatus;
  notes: string | null;
  user_id: string;
  created_at: string;
}

// ========== 海马层记忆 ==========
// 白质层分析片段的 content_json 结构
export interface WhiteMatterEpisodeContent {
  task_run_id: string;
  root_cause: string;
  failure_type: FailureType;
  affected_steps: AffectedStep[];
  suggestions: WhiteMatterSuggestion[];
  param_patches: ParamPatch[];
  confidence: number;
  reasoning_summary: string;
}

export interface MemoryEpisode {
  id: string;
  type: EpisodeType;
  title: string;
  content_json: Record<string, unknown>;
  skill_card_id: string | null;
  task_id: string | null;
  task_run_id: string | null;
  tags: string[];
  user_id: string;
  created_at: string;
  skill_card?: SkillCard;
  task?: Task;
}

// ========== Milestone 5: 补丁效果评估 ==========

/** patch_evaluation episode 四维对比结构 */
export interface PatchEvaluationWindow {
  total: number;
  success: number;
  success_rate: number | null;       // 百分比（0–100），NULL 表示无数据
  avg_duration_ms: number | null;
  failure_types: string[];
  affected_steps: string[];          // 格式 "index:action"
}

export interface PatchEvaluationDelta {
  success_rate_delta: number | null; // 正数 = 成功率提升
  duration_ms_delta: number | null;  // 负数 = 耗时缩短（改善）
  resolved_failure_types: string[];  // 补丁前有，补丁后消失
  persisting_failure_types: string[];// 两窗口均存在
  resolved_steps: string[];          // 补丁前失败，补丁后恢复
  still_failing_steps: string[];     // 两窗口均失败
}

/** ineffective_patch 告警 episode 中的回滚建议（需求 9 v3） */
export interface RollbackParamItem {
  param_name: string;
  rollback_to: string;       // 回滚目标值（补丁前的 old_value）
  current_value: string;     // 当前生效值（applied_value）
  original_reason: string;   // 补丁当时的理由
}

export interface RollbackRecommendation {
  action: 'rollback_to_version';
  target_version: string | null;
  reason: string;
  patch_params: RollbackParamItem[];
  suggested_steps: string[];
}

/** apply_rollback_recommendation RPC 返回值（Milestone 6 需求 1-3） */
export interface ApplyRollbackResult {
  ok: boolean;
  new_version: string;
  prev_version: string;
  skill_card_id: string;
  new_skill_history_id: string;
  previous_skill_history_id: string;   // 需求 5：对齐 episode content_json 字段名
  rollback_episode_id: string;
  ineffective_patch_episode_id: string;
  rollback_params: Array<{
    param_name: string;
    rollback_to: string;
    from_value: string | null;
  }>;
  applied_at: string;
}

/**
 * rollback_applied episode 的 content_json 结构（需求 4-5）
 * type = 'rollback_applied'
 */
export interface RollbackAppliedEpisodeContent {
  /** 需求 5 七个必填字段 */
  skill_card_id:              string;
  previous_skill_history_id:  string;   // 回滚依据的原 history id
  new_skill_history_id:       string;   // 本次回滚生成的新 history id
  rollback_source_episode_id: string;   // 来源 ineffective_patch episode id
  rollback_params: Array<{
    param_name:  string;
    rollback_to: string;
    from_value:  string | null;
  }>;
  rollback_reason: string;
  applied_at: string;                   // ISO 时间戳
  /** 扩展字段（审计用） */
  prev_version:    string;
  new_version:     string;
  target_version:  string | null;
  is_rollback:     true;
}

export interface PatchEvaluationResult {
  ok: boolean;
  episode_id: string;
  evaluation_status:
    | 'evaluated'
    | 'insufficient_data_before'
    | 'insufficient_data_after'
    | 'legacy_run_skipped'
    | 'no_patch_recorded'   // v6: 无 parameter_patch episode，不抛异常
    | 'run_not_found'       // v6: task_run 不存在，不抛异常
    | 'unauthorized'        // v6: 用户未登录
    | 'invalid_input';      // v6: 参数缺失
  // 需求 5：单次对比字段
  skill_card_id: string;
  skill_history_id: string | null;
  parameter_patch_episode_id: string | null;
  before_task_run_id: string | null;
  after_task_run_id: string;
  before_status: string | null;         // 'success' | 'failed' | null（无 before run）
  after_status: string;
  before_failure_type: string | null;   // 需求 7
  after_failure_type: string | null;
  improved: boolean | null;             // true(req6) / false(req7) / null(部分改善)
  evaluation_summary: string;
  // 四维聚合
  prev_version: string | null;
  new_version: string | null;
  before_success_rate: number | null;
  after_success_rate: number | null;
  success_rate_delta: number | null;
  before_avg_duration: number | null;
  after_avg_duration: number | null;
  duration_delta: number | null;
  resolved_failure_types: string[];
  persisting_failure_types: string[];
  resolved_steps: string[];
  still_failing_steps: string[];
  // 需求 8/9：生命周期引擎
  lifecycle_change: string;             // 'none' | 'advanced: X→Y' | 'ineffective_patch: X→Y'
  consecutive_improved: number;
  consecutive_degraded: number;
  ineffective_patch_episode_id: string | null;
  // Milestone 7 需求 4: before/after 执行时刻 snapshot（不读 skill_cards 当前值）
  before_params_snapshot: Record<string, unknown> | null;
  after_params_snapshot: Record<string, unknown> | null;
}

// ========== 环境画像 ==========
export interface EnvironmentProfile {
  id: string;
  url: string;
  environment_type: string;
  perception_surfaces: string[];
  execution_surfaces: string[];
  feedback_surfaces: string[];
  elements: any[];
  missing_capabilities: string[];
  recommended_adapters: string[];
  scan_status: 'pending' | 'scanning' | 'success' | 'failed';
  scan_error: string | null;
  raw_profile: Record<string, unknown>;
  user_id: string;
  created_at: string;
  updated_at: string;
}

// ========== 模型配置（BYOK）==========
export type ModelProvider = 'deepseek' | 'anthropic' | 'qwen' | 'openai';

export interface ModelConfig {
  id: string;
  user_id: string;
  provider: ModelProvider;
  api_key: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// 前端展示用（脱敏 key）
export interface ModelConfigDisplay extends Omit<ModelConfig, 'api_key'> {
  api_key_masked: string; // 如 "sk-1****abcd"
}

// ========== 安全日志 ==========
export interface SecurityLog {
  id: string;
  action_name: string;
  action_detail: string | null;
  risk_level: RiskLevel;
  blocked: boolean;
  block_reason: string | null;
  task_run_id: string | null;
  user_id: string;
  created_at: string;
}

// ========== 统计数据 ==========
export interface DashboardStats {
  total_tasks: number;
  success_tasks: number;
  total_skills: number;
  skill_status_distribution: Record<SkillStatus, number>;
  meta_goal_scores: {
    task_success_rate: number;
    efficiency: number;
    adaptability: number;
    safety: number;
  };
}

// ========== 站内通知 ==========
export type NotificationType = 'info' | 'success' | 'warning' | 'error';

export interface AppNotification {
  id: string;
  user_id: string;
  title: string;
  body: string;
  type: NotificationType;
  read: boolean;
  task_id: string | null;
  task_run_id: string | null;
  created_at: string;
}
