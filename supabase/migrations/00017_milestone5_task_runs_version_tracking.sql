
-- ══════════════════════════════════════════════════════════════════════
--  Milestone 5 – Patch Outcome Evaluation
--  Step 1: task_runs 执行版本追踪 + episode_type 枚举扩展
-- ══════════════════════════════════════════════════════════════════════

-- 需求 1: task_run 记录执行时使用的技能版本快照
ALTER TABLE public.task_runs
  ADD COLUMN skill_version    text,
  ADD COLUMN skill_history_id uuid
    REFERENCES public.skill_history(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.task_runs.skill_version IS
  '执行开始时快照的技能卡版本号（如 1.0.3），随 skill_card.version 一起写入，'
  '便于补丁前后对比时定位该次执行使用了哪个版本（Milestone 5 需求 1/2）。';

COMMENT ON COLUMN public.task_runs.skill_history_id IS
  '执行开始时关联的最新 skill_history 行 ID，精确追踪到哪次补丁生效（Milestone 5 需求 1/2）。';

CREATE INDEX idx_task_runs_skill_version     ON public.task_runs(skill_card_id, skill_version);
CREATE INDEX idx_task_runs_skill_history_id  ON public.task_runs(skill_history_id);

-- 需求 4: 新增 patch_evaluation 类型到 episode_type 枚举
ALTER TYPE public.episode_type ADD VALUE 'patch_evaluation';

COMMENT ON TYPE public.episode_type IS
  '记忆片段类型枚举。patch_evaluation（Milestone 5）：记录参数补丁应用后的效果评估结果，'
  '包含四维对比（成功率、耗时、失败类型、受影响步骤）。';
