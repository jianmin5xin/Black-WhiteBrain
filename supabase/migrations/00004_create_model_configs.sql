-- 用户模型配置表（BYOK - Bring Your Own Key）
CREATE TABLE model_configs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  provider    text NOT NULL CHECK (provider IN ('deepseek', 'anthropic', 'qwen', 'openai')),
  api_key     text NOT NULL,
  is_active   boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider)
);

-- 更新时间触发器
CREATE OR REPLACE FUNCTION update_model_configs_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_model_configs_updated_at
  BEFORE UPDATE ON model_configs
  FOR EACH ROW EXECUTE FUNCTION update_model_configs_updated_at();

-- 确保同一用户只有一个激活模型的触发器
CREATE OR REPLACE FUNCTION ensure_single_active_model()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.is_active = true THEN
    UPDATE model_configs
    SET is_active = false
    WHERE user_id = NEW.user_id AND id != NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_single_active_model
  AFTER INSERT OR UPDATE ON model_configs
  FOR EACH ROW EXECUTE FUNCTION ensure_single_active_model();

-- RLS 策略
ALTER TABLE model_configs ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION can_access_model_config(config_user_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER AS $$
  SELECT auth.uid() = config_user_id;
$$;

CREATE POLICY "用户可读取自己的模型配置"
  ON model_configs FOR SELECT TO authenticated
  USING (can_access_model_config(user_id));

CREATE POLICY "用户可插入自己的模型配置"
  ON model_configs FOR INSERT TO authenticated
  WITH CHECK (can_access_model_config(user_id));

CREATE POLICY "用户可更新自己的模型配置"
  ON model_configs FOR UPDATE TO authenticated
  USING (can_access_model_config(user_id));

CREATE POLICY "用户可删除自己的模型配置"
  ON model_configs FOR DELETE TO authenticated
  USING (can_access_model_config(user_id));