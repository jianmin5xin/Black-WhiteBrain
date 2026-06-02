-- Milestone 12 补充：
-- 1. skill_cards 添加 compiled_from_task_run_id 字段（跟踪编译来源）
-- 2. episode_type 枚举添加 skill_compilation

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'skill_cards'
    AND column_name = 'compiled_from_task_run_id'
  ) THEN
    ALTER TABLE public.skill_cards
    ADD COLUMN compiled_from_task_run_id uuid REFERENCES public.task_runs(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum 
    WHERE enumtypid = 'public.episode_type'::regtype 
    AND enumlabel = 'skill_compilation'
  ) THEN
    ALTER TYPE public.episode_type ADD VALUE 'skill_compilation';
  END IF;
END $$;