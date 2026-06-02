-- 1. 原始环境扫描结果表（Bootloader 产出）
CREATE TABLE public.raw_environment_scans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  url text NOT NULL,
  title text,
  dom text,
  visible_text text,
  screenshot text,
  console_errors text[] DEFAULT '{}',
  raw_elements jsonb NOT NULL DEFAULT '[]'::jsonb,
  scan_status text NOT NULL DEFAULT 'pending' CHECK (scan_status IN ('pending', 'scanning', 'success', 'failed')),
  scan_error text,
  scan_duration_ms int,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.raw_environment_scans IS 'Bootloader 产出的原始环境扫描结果，只含事实不含推理';
COMMENT ON COLUMN public.raw_environment_scans.raw_elements IS '从 DOM 中扫描出的原始元素，含 tag、text、role、name、placeholder、type、href、aria-label、data-testid 等属性';

-- 2. environment_profiles 添加 raw_scan_id 外键
ALTER TABLE public.environment_profiles
  ADD COLUMN IF NOT EXISTS raw_scan_id uuid REFERENCES public.raw_environment_scans(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.environment_profiles.raw_scan_id IS '关联的原始扫描记录';

-- 3. 启用 RLS
ALTER TABLE public.raw_environment_scans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "用户只能访问自己的原始扫描"
  ON public.raw_environment_scans
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- 4. Supabase Realtime 启用
ALTER PUBLICATION supabase_realtime ADD TABLE public.raw_environment_scans;