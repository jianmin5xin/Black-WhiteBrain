
-- ══════════════════════════════════════════════════════════════════════
--  Milestone 7 需求 1+2+3: task_runs 执行时刻不可变技能参数快照
--
--  新增列：
--    tunable_params_snapshot  JSONB  执行开始时 skill_card.tunable_params 的深拷贝
--
--  不可变性保证：
--    该列仅在 INSERT 时由前端一次性写入；不提供任何 UPDATE 接口。
--    后续 skill_card 更新、rollback、promotion 均不触及此列，
--    历史 task_run 的参数解释永远以该列为准（需求 3）。
--
--  向后兼容：
--    DEFAULT NULL — 旧 task_run 行不受影响，前端展示时降级显示提示。
-- ══════════════════════════════════════════════════════════════════════
ALTER TABLE public.task_runs
  ADD COLUMN tunable_params_snapshot jsonb DEFAULT NULL;

COMMENT ON COLUMN public.task_runs.tunable_params_snapshot IS
  'Milestone 7: 执行开始时 skill_card.tunable_params 的不可变快照。'
  '该列由 INSERT 一次性写入，不支持 UPDATE，确保历史参数解释不受后续 '
  'skill_card 更新/rollback/promotion 影响（需求 1-3）。';
