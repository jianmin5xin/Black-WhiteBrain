
-- 用户角色枚举
CREATE TYPE public.user_role AS ENUM ('user', 'admin');

-- 用户档案表
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  phone text,
  username text UNIQUE,
  role user_role NOT NULL DEFAULT 'user'::user_role,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 技能状态枚举
CREATE TYPE public.skill_status AS ENUM ('candidate', 'temporary', 'sandbox', 'gray_matter', 'mature', 'universal', 'deprecated');

-- 风险等级枚举
CREATE TYPE public.risk_level AS ENUM ('low', 'medium', 'high', 'forbidden');

-- 任务状态枚举
CREATE TYPE public.task_status AS ENUM ('pending', 'running', 'success', 'failed');

-- 经验记录类型
CREATE TYPE public.episode_type AS ENUM ('episode', 'failure', 'success', 'parameter_patch');

-- 动作类型枚举
CREATE TYPE public.action_type AS ENUM ('click', 'fill', 'wait', 'screenshot', 'handle_dialog', 'navigate', 'extract');

-- 任务表
CREATE TABLE public.tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  target_url text NOT NULL,
  description text,
  steps_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  status task_status NOT NULL DEFAULT 'pending',
  last_run_at timestamptz,
  run_count int NOT NULL DEFAULT 0,
  success_count int NOT NULL DEFAULT 0,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 任务执行记录表
CREATE TABLE public.task_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  status task_status NOT NULL DEFAULT 'running',
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  duration_ms int,
  error_message text,
  steps_result jsonb DEFAULT '[]'::jsonb,
  analysis text,
  suggestions jsonb DEFAULT '[]'::jsonb,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE
);

-- 技能卡表
CREATE TABLE public.skill_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_id text NOT NULL,
  name text NOT NULL,
  environment_type text NOT NULL DEFAULT 'web_automation',
  perception_sources jsonb NOT NULL DEFAULT '[]'::jsonb,
  execution_surfaces jsonb NOT NULL DEFAULT '[]'::jsonb,
  feedback_surfaces jsonb NOT NULL DEFAULT '[]'::jsonb,
  tunable_params jsonb NOT NULL DEFAULT '{}'::jsonb,
  safety jsonb NOT NULL DEFAULT '{"risk_level":"low","fallback_action":"stop","max_action_rate_per_second":5}'::jsonb,
  metrics jsonb NOT NULL DEFAULT '{"success_rate":0,"avg_latency_ms":0,"sample_count":0}'::jsonb,
  policy text,
  status skill_status NOT NULL DEFAULT 'candidate',
  version text NOT NULL DEFAULT '1.0.0',
  task_id uuid REFERENCES public.tasks(id),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 技能版本历史表
CREATE TABLE public.skill_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_card_id uuid NOT NULL REFERENCES public.skill_cards(id) ON DELETE CASCADE,
  version text NOT NULL,
  changes_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  tunable_params jsonb NOT NULL DEFAULT '{}'::jsonb,
  status skill_status NOT NULL,
  notes text,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 海马层记忆表
CREATE TABLE public.memory_episodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type episode_type NOT NULL,
  title text NOT NULL,
  content_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  skill_card_id uuid REFERENCES public.skill_cards(id) ON DELETE SET NULL,
  task_id uuid REFERENCES public.tasks(id) ON DELETE SET NULL,
  task_run_id uuid REFERENCES public.task_runs(id) ON DELETE SET NULL,
  tags text[] DEFAULT '{}',
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 环境画像表
CREATE TABLE public.environment_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_url text NOT NULL,
  environment_type text NOT NULL DEFAULT 'web_automation',
  perception_surfaces jsonb NOT NULL DEFAULT '[]'::jsonb,
  execution_surfaces jsonb NOT NULL DEFAULT '[]'::jsonb,
  feedback_surfaces jsonb NOT NULL DEFAULT '[]'::jsonb,
  missing_capabilities jsonb NOT NULL DEFAULT '[]'::jsonb,
  recommended_adapters jsonb NOT NULL DEFAULT '[]'::jsonb,
  raw_profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 安全日志表
CREATE TABLE public.security_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_name text NOT NULL,
  action_detail text,
  risk_level risk_level NOT NULL DEFAULT 'low',
  blocked boolean NOT NULL DEFAULT false,
  block_reason text,
  task_run_id uuid REFERENCES public.task_runs(id) ON DELETE SET NULL,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 自动同步新用户到profiles的触发器函数
CREATE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, phone, role)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.phone,
    'user'::public.user_role
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- 用户角色查询辅助函数
CREATE OR REPLACE FUNCTION public.get_user_role(uid uuid)
RETURNS user_role
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM profiles WHERE id = uid;
$$;

-- 更新时间戳触发器
CREATE FUNCTION public.update_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER update_tasks_updated_at BEFORE UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER update_skill_cards_updated_at BEFORE UPDATE ON public.skill_cards FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
