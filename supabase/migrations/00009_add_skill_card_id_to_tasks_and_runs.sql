-- tasks 表绑定候选技能卡
ALTER TABLE public.tasks
  ADD COLUMN skill_card_id uuid REFERENCES public.skill_cards(id) ON DELETE SET NULL;

-- task_runs 表记录执行时使用的技能卡版本快照
ALTER TABLE public.task_runs
  ADD COLUMN skill_card_id uuid REFERENCES public.skill_cards(id) ON DELETE SET NULL;

-- 加索引加速反查
CREATE INDEX idx_tasks_skill_card_id     ON public.tasks(skill_card_id);
CREATE INDEX idx_task_runs_skill_card_id ON public.task_runs(skill_card_id);
