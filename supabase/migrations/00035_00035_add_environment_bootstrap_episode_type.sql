-- 扩展 episode_type 枚举，添加 environment_bootstrap
-- 注意：PostgreSQL 不支持在事务中 ALTER TYPE ADD VALUE
-- 使用非事务方式执行

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum 
    WHERE enumtypid = 'public.episode_type'::regtype 
    AND enumlabel = 'environment_bootstrap'
  ) THEN
    ALTER TYPE public.episode_type ADD VALUE 'environment_bootstrap';
  END IF;
END $$;