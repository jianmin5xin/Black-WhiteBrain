
-- ══════════════════════════════════════════════════════════════════════
--  Milestone 3 – Task-Skill Binding Integrity
--  需求 6：memory_episodes(type=parameter_patch) 必须记录 skill_history_id
-- ══════════════════════════════════════════════════════════════════════

ALTER TABLE public.memory_episodes
  ADD COLUMN skill_history_id uuid
    REFERENCES public.skill_history(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.memory_episodes.skill_history_id IS
  '关联 skill_history 行 ID。parameter_patch 类型的 episode 必须填充此字段，
   记录产生本次参数变更的具体版本快照。ON DELETE SET NULL 保证 history 删除后
   episode 记录不丢失。';

CREATE INDEX idx_memory_episodes_skill_history_id
  ON public.memory_episodes (skill_history_id)
  WHERE skill_history_id IS NOT NULL;
