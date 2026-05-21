
-- 需求 4: 新增 rollback_applied 到 episode_type 枚举
ALTER TYPE public.episode_type ADD VALUE IF NOT EXISTS 'rollback_applied';

COMMENT ON TYPE public.episode_type IS
  '记忆层 episode 类型: episode(通用)/failure/success/parameter_patch/patch_evaluation/rollback_applied';
