-- 站内通知表
CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  type text NOT NULL DEFAULT 'info',   -- info | success | warning | error
  read boolean NOT NULL DEFAULT false,
  task_id uuid REFERENCES tasks(id) ON DELETE SET NULL,
  task_run_id uuid REFERENCES task_runs(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- 用户只能访问自己的通知
CREATE POLICY "users_own_notifications" ON notifications
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- 实时推送开启
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;

-- profiles 新增浏览器推送偏好列
ALTER TABLE profiles ADD COLUMN notify_on_analysis boolean NOT NULL DEFAULT true;