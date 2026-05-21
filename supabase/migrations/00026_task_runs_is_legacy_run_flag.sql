
-- ══════════════════════════════════════════════════════════════════════
--  Milestone 7 需求 6: task_runs.is_legacy_run 标记列 + 自动触发器
--
--  定义：
--    is_legacy_run = TRUE  当且仅当 skill_history_id IS NULL
--                                  OR tunable_params_snapshot IS NULL
--
--  语义：
--    legacy_run 不具备完整执行时刻快照，不参与严格 patch evaluation。
--    evaluate_patch_outcome v5 遇到 legacy after_run 时返回
--    evaluation_status = 'legacy_run_skipped'。
--
--  触发器规则：
--    · BEFORE INSERT：根据插入值计算并写入 is_legacy_run
--    · 不提供 UPDATE 路径（快照不可变，legacy 标记亦不可变）
--
--  向后兼容：
--    DEFAULT TRUE — 旧行（M7 前）缺少 snapshot，默认视为 legacy。
--    新执行由触发器在插入时精确判断。
-- ══════════════════════════════════════════════════════════════════════

-- 1. 新增列（旧行默认 TRUE = legacy）
ALTER TABLE public.task_runs
  ADD COLUMN is_legacy_run boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.task_runs.is_legacy_run IS
  'Milestone 7 需求 6: skill_history_id IS NULL OR tunable_params_snapshot IS NULL 时为 TRUE。'
  '该标记由 BEFORE INSERT 触发器自动计算，不可手动 UPDATE。'
  'legacy_run 不参与严格 patch evaluation。';

-- 2. 触发器函数
CREATE FUNCTION public.trg_task_runs_set_legacy_run()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- is_legacy_run = TRUE 当 skill_history_id 或 tunable_params_snapshot 任一缺失
  NEW.is_legacy_run := (NEW.skill_history_id IS NULL OR NEW.tunable_params_snapshot IS NULL);
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.trg_task_runs_set_legacy_run() IS
  'BEFORE INSERT 触发器：根据 skill_history_id / tunable_params_snapshot 自动计算 is_legacy_run。';

-- 3. 绑定触发器（BEFORE INSERT，每行执行一次）
CREATE TRIGGER task_runs_set_legacy_run
  BEFORE INSERT ON public.task_runs
  FOR EACH ROW EXECUTE FUNCTION public.trg_task_runs_set_legacy_run();

-- 4. 回填已有行（M7 前的 task_runs 缺少 snapshot，均标记为 legacy）
UPDATE public.task_runs
SET is_legacy_run = (skill_history_id IS NULL OR tunable_params_snapshot IS NULL)
WHERE is_legacy_run = true;  -- 仅更新默认值行，避免误覆盖触发器已计算的新行
