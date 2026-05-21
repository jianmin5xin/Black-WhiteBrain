
-- 开启 RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.skill_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.skill_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memory_episodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.environment_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.security_logs ENABLE ROW LEVEL SECURITY;

-- profiles policies
CREATE POLICY "管理员完全访问profiles" ON public.profiles
  FOR ALL TO authenticated USING (public.get_user_role(auth.uid()) = 'admin'::user_role);

CREATE POLICY "用户查看自己的profile" ON public.profiles
  FOR SELECT TO authenticated USING (auth.uid() = id);

CREATE POLICY "用户更新自己的profile" ON public.profiles
  FOR UPDATE TO authenticated USING (auth.uid() = id)
  WITH CHECK (role IS NOT DISTINCT FROM public.get_user_role(auth.uid()));

-- tasks policies
CREATE POLICY "用户管理自己的任务" ON public.tasks
  FOR ALL TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "管理员查看所有任务" ON public.tasks
  FOR SELECT TO authenticated USING (public.get_user_role(auth.uid()) = 'admin'::user_role);

-- task_runs policies
CREATE POLICY "用户管理自己的任务执行" ON public.task_runs
  FOR ALL TO authenticated USING (auth.uid() = user_id);

-- skill_cards policies
CREATE POLICY "用户管理自己的技能卡" ON public.skill_cards
  FOR ALL TO authenticated USING (auth.uid() = user_id);

-- skill_history policies
CREATE POLICY "用户管理自己的技能历史" ON public.skill_history
  FOR ALL TO authenticated USING (auth.uid() = user_id);

-- memory_episodes policies
CREATE POLICY "用户管理自己的记忆记录" ON public.memory_episodes
  FOR ALL TO authenticated USING (auth.uid() = user_id);

-- environment_profiles policies
CREATE POLICY "用户管理自己的环境画像" ON public.environment_profiles
  FOR ALL TO authenticated USING (auth.uid() = user_id);

-- security_logs policies
CREATE POLICY "用户查看自己的安全日志" ON public.security_logs
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "用户写入安全日志" ON public.security_logs
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- public_profiles 视图
CREATE VIEW public.public_profiles AS
  SELECT id, role FROM public.profiles;

-- Realtime for task_runs
ALTER PUBLICATION supabase_realtime ADD TABLE public.task_runs;
ALTER PUBLICATION supabase_realtime ADD TABLE public.tasks;
