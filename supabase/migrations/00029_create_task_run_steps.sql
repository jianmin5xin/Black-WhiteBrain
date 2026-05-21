-- ══════════════════════════════════════════════════════════════════════
-- Milestone 9 需求 1-2: Step-Level Execution Trace Integrity
-- 创建 task_run_steps 表，用于记录详细的步骤级执行轨迹
-- ══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.task_run_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_run_id uuid NOT NULL REFERENCES public.task_runs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  step_index integer NOT NULL,
  action_type text NOT NULL,
  target_selector text,
  input_value_snapshot jsonb,
  status text NOT NULL CHECK (status IN ('running', 'success', 'failed', 'skipped')),
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  duration_ms integer,
  error_code text,
  error_message text,
  safety_risk_level text CHECK (safety_risk_level IN ('low', 'medium', 'high', 'forbidden')),
  screenshot_ref text,
  dom_snapshot_ref text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_task_run_steps_task_run_id ON public.task_run_steps(task_run_id);
CREATE INDEX IF NOT EXISTS idx_task_run_steps_user_id ON public.task_run_steps(user_id);

-- RLS
ALTER TABLE public.task_run_steps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert their own task run steps"
  ON public.task_run_steps
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own task run steps"
  ON public.task_run_steps
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view their own task run steps"
  ON public.task_run_steps
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);
