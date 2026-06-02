-- Drop the old status check constraint if it exists
DO $$ 
BEGIN
  ALTER TABLE public.task_run_steps DROP CONSTRAINT IF EXISTS task_run_steps_status_check;
EXCEPTION
  WHEN undefined_object THEN
    NULL;
END $$;

-- Add the new check constraint
ALTER TABLE public.task_run_steps ADD CONSTRAINT task_run_steps_status_check CHECK (status IN ('running', 'success', 'failed', 'skipped', 'blocked'));

-- Add new columns for SafetyGate
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'task_run_steps' AND column_name = 'blocked_reason') THEN
    ALTER TABLE public.task_run_steps ADD COLUMN blocked_reason text;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'task_run_steps' AND column_name = 'matched_rule') THEN
    ALTER TABLE public.task_run_steps ADD COLUMN matched_rule text;
  END IF;
END $$;