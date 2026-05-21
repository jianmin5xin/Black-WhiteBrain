-- ══════════════════════════════════════════════════════════════════════
-- Milestone 9 需求 4: task_runs.failed_step_index
-- 任务失败时，必须指向失败步骤的索引
-- ══════════════════════════════════════════════════════════════════════

ALTER TABLE public.task_runs
  ADD COLUMN IF NOT EXISTS failed_step_index integer;

COMMENT ON COLUMN public.task_runs.failed_step_index IS
  'Milestone 9 需求 4: 任务失败时，指向第一个失败步骤的 step_index（从 0 开始）。'
  '成功任务为 NULL。';
