-- ══════════════════════════════════════════════════════════════════════
-- Milestone 11 需求 1: Environment Bootstrapper Integrity
-- 新增或强化 environment_profiles 表
-- ══════════════════════════════════════════════════════════════════════

ALTER TABLE public.environment_profiles
  RENAME COLUMN target_url TO url;

ALTER TABLE public.environment_profiles
  ADD COLUMN IF NOT EXISTS elements jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS scan_status text NOT NULL DEFAULT 'pending' CHECK (scan_status IN ('pending', 'scanning', 'success', 'failed')),
  ADD COLUMN IF NOT EXISTS scan_error text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

COMMENT ON COLUMN public.environment_profiles.url IS '目标扫描URL';
COMMENT ON COLUMN public.environment_profiles.elements IS '扫描到的DOM元素集合';
COMMENT ON COLUMN public.environment_profiles.scan_status IS '扫描状态';
COMMENT ON COLUMN public.environment_profiles.scan_error IS '扫描失败原因';
