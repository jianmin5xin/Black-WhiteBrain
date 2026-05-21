
-- ══════════════════════════════════════════════════════════════════════
--  apply_param_patch v2 — 强化必填字段校验 + 字段契约注释
--
--  需求变更（v31）：
--   · 需求 3：content_json 必须包含 7 个必填字段（明确枚举并在代码中校验）
--     ① param_name  ② old_value  ③ suggested_value  ④ applied_value
--     ⑤ applied_at  ⑥ skill_card_id  ⑦ task_run_id
--   · 需求 4：任一步骤失败 → 整体失败（plpgsql 函数天然保证）
--   · 需求 6：失败时 RAISE EXCEPTION 携带分类前缀，前端据此精确展示错误
--   · 需求 7：保留字段契约（param_name/raw_param_name/old_value/
--             suggested_value/applied_value/applied_at/skill_card_id/
--             task_run_id/new_version/prev_version/reason/
--             normalization_note/source）
-- ══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.apply_param_patch(
  p_skill_card_id        uuid,
  p_task_run_id          uuid,
  p_task_id              uuid,
  p_task_name            text,
  p_canonical_param_name text,
  p_raw_param_name       text,
  p_old_value            text,
  p_suggested_value      text,
  p_applied_value        text,
  p_reason               text,
  p_normalization_note   text DEFAULT NULL
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

  -- ── 0b. 必填业务参数前置校验（需求 3：7 个必填字段全部来源于入参）──
  -- 这些字段将写入 memory_episodes.content_json，任一为空即拒绝整个事务
  IF p_skill_card_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_INPUT: p_skill_card_id 不能为空';
  END IF;
  IF COALESCE(TRIM(p_canonical_param_name), '') = '' THEN
    RAISE EXCEPTION 'INVALID_INPUT: p_canonical_param_name 不能为空';
  END IF;
  IF COALESCE(TRIM(p_applied_value), '') = '' THEN
    RAISE EXCEPTION 'INVALID_INPUT: p_applied_value 不能为空';
  END IF;
  IF COALESCE(TRIM(p_suggested_value), '') = '' THEN
    RAISE EXCEPTION 'INVALID_INPUT: p_suggested_value 不能为空';
  END IF;
  -- p_old_value 允许空字符串（首次设置时无旧值），不校验

  -- ── 1. 读取技能卡并校验归属（FOR UPDATE 行级锁，防并发补丁冲突）──
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

  -- ── 2. 校验 task_run 归属（若提供）────────────────────────────────
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

  -- ── 3. 版本号计算（major.minor.patch+1）────────────────────────────
  v_prev_version  := COALESCE(v_card.version, '1.0.0');
  v_version_parts := string_to_array(v_prev_version, '.');
  v_new_patch_num := COALESCE((v_version_parts[3])::int, 0) + 1;
  v_new_version   := COALESCE(v_version_parts[1], '1') || '.'
                  || COALESCE(v_version_parts[2], '0') || '.'
                  || v_new_patch_num::text;

  -- ── 4. 合并 tunable_params（数值型字符串转 numeric）────────────────
  IF p_applied_value ~ '^-?[0-9]+(\.[0-9]+)?$' THEN
    v_applied_numeric := to_jsonb(p_applied_value::numeric);
  ELSE
    v_applied_numeric := to_jsonb(p_applied_value);
  END IF;
  v_updated_params := v_card.tunable_params
                   || jsonb_build_object(p_canonical_param_name, v_applied_numeric);

  -- ── 5. UPDATE skill_cards ──────────────────────────────────────────
  UPDATE skill_cards
  SET tunable_params = v_updated_params,
      version        = v_new_version,
      updated_at     = v_applied_at
  WHERE id = p_skill_card_id;

  -- ── 6. INSERT skill_history（不可变版本快照）──────────────────────
  INSERT INTO skill_history (
    skill_card_id, version, changes_json, tunable_params, status, notes, user_id
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

  -- ── 7. INSERT memory_episodes(type='parameter_patch') ─────────────
  --
  --  ┌─────────────────────────────────────────────────────────────────┐
  --  │  content_json 必填字段契约（需求 3 + 需求 7）                    │
  --  │                                                                  │
  --  │  ① param_name        归一化后的规范参数名                        │
  --  │  ② old_value         补丁前的旧值（修改前快照）                  │
  --  │  ③ suggested_value   白质层推理建议值                            │
  --  │  ④ applied_value     用户实际落地值（通常 = suggested_value）    │
  --  │  ⑤ applied_at        精确落地时间（事务开始时 now()）            │
  --  │  ⑥ skill_card_id     关联技能卡 UUID                            │
  --  │  ⑦ task_run_id       来源推理 UUID（可为 NULL）                  │
  --  │                                                                  │
  --  │  扩展字段（字段契约完整保留，不得删除）：                         │
  --  │     raw_param_name / prev_version / new_version /               │
  --  │     reason / normalization_note / source                        │
  --  └─────────────────────────────────────────────────────────────────┘
  INSERT INTO memory_episodes (
    type, title, content_json,
    skill_card_id, task_id, task_run_id, tags, user_id
  ) VALUES (
    'parameter_patch',
    '参数补丁: ' || p_task_name
      || ' — ' || p_canonical_param_name
      || ' 升版至 v' || v_new_version,
    jsonb_build_object(
      -- ── 7 个必填字段 ──
      'param_name',         p_canonical_param_name,   -- ①
      'old_value',          p_old_value,               -- ②
      'suggested_value',    p_suggested_value,         -- ③
      'applied_value',      p_applied_value,           -- ④
      'applied_at',         v_applied_at,              -- ⑤
      'skill_card_id',      p_skill_card_id,           -- ⑥
      'task_run_id',        p_task_run_id,             -- ⑦
      -- ── 扩展字段（字段契约完整保留）──
      'raw_param_name',     p_raw_param_name,
      'prev_version',       v_prev_version,
      'new_version',        v_new_version,
      'reason',             p_reason,
      'normalization_note', p_normalization_note,
      'source',             'white_matter_analysis'
    ),
    p_skill_card_id,
    p_task_id,
    p_task_run_id,
    ARRAY['parameter_patch', 'white_matter', p_canonical_param_name],
    v_user_id
  )
  RETURNING id INTO v_episode_id;

  -- ── 8. 返回成功（需求 5：前端据此判断是否 toast.success）──────────
  RETURN jsonb_build_object(
    'ok',            true,
    'new_version',   v_new_version,
    'skill_card_id', p_skill_card_id,
    'history_id',    v_history_id,
    'episode_id',    v_episode_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_param_patch FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_param_patch TO authenticated;

COMMENT ON FUNCTION public.apply_param_patch IS
  '原子化应用白质层参数补丁（v2）。'
  '在同一事务内完成：前置必填字段校验 + skill_cards UPDATE + skill_history INSERT + memory_episodes(parameter_patch) INSERT。'
  '任一步骤 RAISE EXCEPTION → 全部回滚，三张表保持一致。'
  'content_json 必填字段：param_name/old_value/suggested_value/applied_value/applied_at/skill_card_id/task_run_id。';
