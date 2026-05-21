
-- ══════════════════════════════════════════════════════════════════════
--  apply_param_patch — 参数补丁原子事务 RPC
--
--  职责：
--    1. 权限校验：当前用户必须是 skill_card 的 owner
--    2. 读取 skill_card（含乐观锁校验）
--    3. 校验 task_run 属于同一用户（若提供）
--    4. 计算新版本号 (major.minor.patch+1)
--    5. UPDATE skill_cards（tunable_params + version + updated_at）
--    6. INSERT skill_history（不可变版本快照）
--    7. INSERT memory_episodes(type='parameter_patch')
--    以上 5-7 在同一隐式事务内完成，任一失败则全部回滚。
--
--  参数说明：
--    p_skill_card_id       技能卡 UUID
--    p_task_run_id         本次推理的 task_run UUID（可为 NULL）
--    p_task_id             任务 UUID
--    p_task_name           任务名称（用于 episode 标题）
--    p_canonical_param_name  归一化后的参数名（已由前端 resolveCanonicalParamName 处理）
--    p_raw_param_name      AI 原始输出的参数名（审计用）
--    p_old_value           补丁前的旧值
--    p_suggested_value     白质层建议值
--    p_applied_value       用户实际落地值（通常 = suggested_value）
--    p_reason              建议理由
--    p_normalization_note  参数名归一化备注（可为 NULL）
--
--  返回：jsonb
--    {
--      "ok": true,
--      "new_version": "1.0.4",
--      "skill_card_id": "...",
--      "history_id": "...",
--      "episode_id": "..."
--    }
--  出错时通过 RAISE EXCEPTION 抛出，由 Supabase 转为 400/422 错误。
-- ══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.apply_param_patch(
  p_skill_card_id       uuid,
  p_task_run_id         uuid,
  p_task_id             uuid,
  p_task_name           text,
  p_canonical_param_name text,
  p_raw_param_name      text,
  p_old_value           text,
  p_suggested_value     text,
  p_applied_value       text,
  p_reason              text,
  p_normalization_note  text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id         uuid := auth.uid();
  v_card            RECORD;
  v_task_run_owner  uuid;
  v_applied_numeric jsonb;
  v_updated_params  jsonb;
  v_prev_version    text;
  v_new_version     text;
  v_version_parts   text[];
  v_new_patch_num   int;
  v_history_id      uuid;
  v_episode_id      uuid;
  v_applied_at      timestamptz := now();
BEGIN
  -- ── 0. 必须已登录 ──────────────────────────────────────────────────
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: 用户未登录';
  END IF;

  -- ── 1. 读取技能卡并校验归属（行级锁，防并发补丁冲突）─────────────
  SELECT id, tunable_params, version, status, user_id
  INTO v_card
  FROM skill_cards
  WHERE id = p_skill_card_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: skill_card % 不存在', p_skill_card_id;
  END IF;

  IF v_card.user_id != v_user_id THEN
    RAISE EXCEPTION 'FORBIDDEN: 当前用户无权操作 skill_card %', p_skill_card_id;
  END IF;

  -- ── 2. 校验 task_run 归属（若提供）─────────────────────────────────
  IF p_task_run_id IS NOT NULL THEN
    SELECT user_id INTO v_task_run_owner
    FROM task_runs
    WHERE id = p_task_run_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'NOT_FOUND: task_run % 不存在', p_task_run_id;
    END IF;

    IF v_task_run_owner != v_user_id THEN
      RAISE EXCEPTION 'FORBIDDEN: 当前用户无权操作 task_run %', p_task_run_id;
    END IF;
  END IF;

  -- ── 3. 计算新版本号（major.minor.patch+1）──────────────────────────
  v_prev_version    := COALESCE(v_card.version, '1.0.0');
  v_version_parts   := string_to_array(v_prev_version, '.');
  v_new_patch_num   := COALESCE((v_version_parts[3])::int, 0) + 1;
  v_new_version     := COALESCE(v_version_parts[1], '1') || '.'
                    || COALESCE(v_version_parts[2], '0') || '.'
                    || v_new_patch_num::text;

  -- ── 4. 计算合并后的 tunable_params ─────────────────────────────────
  -- 数值型字符串转为 JSON number，否则保留 JSON string
  IF p_applied_value ~ '^-?[0-9]+(\.[0-9]+)?$' THEN
    v_applied_numeric := to_jsonb(p_applied_value::numeric);
  ELSE
    v_applied_numeric := to_jsonb(p_applied_value);
  END IF;

  v_updated_params := v_card.tunable_params || jsonb_build_object(p_canonical_param_name, v_applied_numeric);

  -- ── 5. 更新技能卡（version + tunable_params）───────────────────────
  UPDATE skill_cards
  SET
    tunable_params = v_updated_params,
    version        = v_new_version,
    updated_at     = v_applied_at
  WHERE id = p_skill_card_id;

  -- ── 6. 插入 skill_history（不可变版本快照）─────────────────────────
  INSERT INTO skill_history (
    skill_card_id,
    version,
    changes_json,
    tunable_params,
    status,
    notes,
    user_id
  ) VALUES (
    p_skill_card_id,
    v_new_version,
    jsonb_build_object(
      'source',               'white_matter_param_patch',
      'task_run_id',          p_task_run_id,
      'prev_version',         v_prev_version,
      'canonical_param_name', p_canonical_param_name,
      'raw_param_name',       p_raw_param_name,
      'old_value',            p_old_value,
      'suggested_value',      p_suggested_value,
      'applied_value',        p_applied_value,
      'reason',               p_reason,
      'normalization_note',   p_normalization_note
    ),
    v_updated_params,
    v_card.status,
    '白质层补丁: ' || p_canonical_param_name || ' '
      || p_old_value || ' → ' || p_applied_value
      || '（来自推理 ' || COALESCE(LEFT(p_task_run_id::text, 8), 'manual') || '）',
    v_user_id
  )
  RETURNING id INTO v_history_id;

  -- ── 7. 插入 memory_episodes（type=parameter_patch）─────────────────
  INSERT INTO memory_episodes (
    type,
    title,
    content_json,
    skill_card_id,
    task_id,
    task_run_id,
    tags,
    user_id
  ) VALUES (
    'parameter_patch',
    '参数补丁: ' || p_task_name || ' — ' || p_canonical_param_name || ' 升版至 v' || v_new_version,
    jsonb_build_object(
      -- 统一字段契约
      'param_name',          p_canonical_param_name,
      'raw_param_name',      p_raw_param_name,
      'old_value',           p_old_value,
      'suggested_value',     p_suggested_value,
      'applied_value',       p_applied_value,
      'applied_at',          v_applied_at,
      -- 上下文字段
      'reason',              p_reason,
      'normalization_note',  p_normalization_note,
      'skill_card_id',       p_skill_card_id,
      'prev_version',        v_prev_version,
      'new_version',         v_new_version,
      'source',              'white_matter_analysis',
      'task_run_id',         p_task_run_id
    ),
    p_skill_card_id,
    p_task_id,
    p_task_run_id,
    ARRAY['parameter_patch', 'white_matter', p_canonical_param_name],
    v_user_id
  )
  RETURNING id INTO v_episode_id;

  -- ── 8. 返回成功结果 ─────────────────────────────────────────────────
  RETURN jsonb_build_object(
    'ok',           true,
    'new_version',  v_new_version,
    'skill_card_id', p_skill_card_id,
    'history_id',   v_history_id,
    'episode_id',   v_episode_id
  );
END;
$$;

-- RLS 说明：函数以 SECURITY DEFINER 运行，内部已通过 auth.uid() 校验归属，
-- 外部不需要额外 RLS policy，只需确保已登录用户可调用。
REVOKE ALL ON FUNCTION public.apply_param_patch FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_param_patch TO authenticated;

COMMENT ON FUNCTION public.apply_param_patch IS
  '原子化应用白质层参数补丁。在同一事务内完成：skill_cards UPDATE + skill_history INSERT + memory_episodes(parameter_patch) INSERT。任一步骤失败则全部回滚。';
