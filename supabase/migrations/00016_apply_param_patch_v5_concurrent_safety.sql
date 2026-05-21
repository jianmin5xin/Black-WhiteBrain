
-- ══════════════════════════════════════════════════════════════════════
--  apply_param_patch v5 — Milestone 4: Concurrent Patch Safety
--
--  先 DROP 旧签名（11 参数），再 CREATE 新签名（12 参数，含 p_expected_version）。
--  新增参数使用 DEFAULT NULL，兼容未传版本的旧调用方式。
-- ══════════════════════════════════════════════════════════════════════

-- 1. 删除旧签名（11 参数），释放函数名供新签名接管
DROP FUNCTION IF EXISTS public.apply_param_patch(
  uuid, uuid, uuid, text, text, text, text, text, text, text, text
);

-- 2. 创建 v5（12 参数：新增 p_expected_version text DEFAULT NULL）
CREATE FUNCTION public.apply_param_patch(
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
  p_normalization_note   text DEFAULT NULL,
  p_expected_version     text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id         uuid := auth.uid();
  v_card            RECORD;
  v_task_run        RECORD;
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

  -- ── 0b. 必填业务参数前置校验 ───────────────────────────────────────
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

  -- ── 1. 读取技能卡并校验归属
  --      FOR UPDATE：悲观锁，同一时刻只有一个事务能修改此行（并发层①）
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

  -- ── 1b. 乐观锁校验（并发层②）————————————————————————————————————
  --  客户端传入 expected_version → 必须与 DB 当前版本严格匹配。
  --  不匹配说明在客户端读取之后已有其他补丁完成了版本递增，
  --  RAISE → 整个事务回滚（含 memory_episodes），不产生断链记录（需求 6）。
  IF p_expected_version IS NOT NULL
     AND v_card.version IS DISTINCT FROM p_expected_version THEN
    RAISE EXCEPTION
      'VERSION_CONFLICT: skill_card % 当前版本为 %，传入 expected_version 为 %。请刷新后重试。',
      p_skill_card_id, v_card.version, p_expected_version;
  END IF;

  -- ── 2. 校验 task_run 归属 + 绑定完整性（需求 4/7，v4 继承）────────
  IF p_task_run_id IS NOT NULL THEN
    SELECT id, user_id, skill_card_id
    INTO v_task_run
    FROM task_runs
    WHERE id = p_task_run_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'NOT_FOUND: task_run % 不存在', p_task_run_id;
    END IF;
    IF v_task_run.user_id != v_user_id THEN
      RAISE EXCEPTION 'FORBIDDEN: 当前用户无权操作 task_run %', p_task_run_id;
    END IF;
    IF v_task_run.skill_card_id IS NULL THEN
      RAISE EXCEPTION
        'MISSING_SKILL_CARD: task_run % 未关联技能卡，无法应用参数补丁。请先为该 task_run 绑定技能卡。',
        p_task_run_id;
    END IF;
    IF v_task_run.skill_card_id != p_skill_card_id THEN
      RAISE EXCEPTION
        'BINDING_MISMATCH: task_run % 绑定的 skill_card 为 %，与传入 % 不一致',
        p_task_run_id, v_task_run.skill_card_id, p_skill_card_id;
    END IF;
  END IF;

  -- ── 3. 版本号计算（major.minor.patch+1）────────────────────────────
  v_prev_version  := COALESCE(v_card.version, '1.0.0');
  v_version_parts := string_to_array(v_prev_version, '.');
  v_new_patch_num := COALESCE((v_version_parts[3])::int, 0) + 1;
  v_new_version   := COALESCE(v_version_parts[1], '1') || '.'
                  || COALESCE(v_version_parts[2], '0') || '.'
                  || v_new_patch_num::text;

  -- ── 4. 合并 tunable_params ─────────────────────────────────────────
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

  -- ── 6. INSERT skill_history（UNIQUE(skill_card_id,version) 为并发层③）
  INSERT INTO skill_history (
    skill_card_id, version, changes_json, tunable_params, status, notes, user_id
  ) VALUES (
    p_skill_card_id,
    v_new_version,
    jsonb_build_object(
      'source',               'white_matter_param_patch',
      'task_run_id',          p_task_run_id,
      'prev_version',         v_prev_version,
      'expected_version',     p_expected_version,
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

  -- ── 7. INSERT memory_episodes
  --  需求 5：绑定最终成功写入的 skill_history_id
  --  需求 6：VERSION_CONFLICT 在步骤 1b RAISE → 整个事务回滚 → 此处不执行
  INSERT INTO memory_episodes (
    type, title, content_json,
    skill_card_id, task_id, task_run_id, skill_history_id,
    tags, user_id
  ) VALUES (
    'parameter_patch',
    '参数补丁: ' || p_task_name
      || ' — ' || p_canonical_param_name
      || ' 升版至 v' || v_new_version,
    jsonb_build_object(
      'param_name',         p_canonical_param_name,
      'old_value',          p_old_value,
      'suggested_value',    p_suggested_value,
      'applied_value',      p_applied_value,
      'applied_at',         v_applied_at,
      'skill_card_id',      p_skill_card_id,
      'task_run_id',        p_task_run_id,
      'skill_history_id',   v_history_id,
      'new_version',        v_new_version,
      'prev_version',       v_prev_version,
      'expected_version',   p_expected_version,
      'raw_param_name',     p_raw_param_name,
      'reason',             p_reason,
      'normalization_note', p_normalization_note,
      'source',             'white_matter_analysis'
    ),
    p_skill_card_id,
    p_task_id,
    p_task_run_id,
    v_history_id,
    ARRAY['parameter_patch', 'white_matter', p_canonical_param_name],
    v_user_id
  )
  RETURNING id INTO v_episode_id;

  RETURN jsonb_build_object(
    'ok',              true,
    'new_version',     v_new_version,
    'prev_version',    v_prev_version,
    'skill_card_id',   p_skill_card_id,
    'history_id',      v_history_id,
    'episode_id',      v_episode_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_param_patch(
  uuid, uuid, uuid, text, text, text, text, text, text, text, text, text
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.apply_param_patch(
  uuid, uuid, uuid, text, text, text, text, text, text, text, text, text
) TO authenticated;

COMMENT ON FUNCTION public.apply_param_patch(
  uuid, uuid, uuid, text, text, text, text, text, text, text, text, text
) IS
  '原子化应用白质层参数补丁（v5 – Milestone 4 Concurrent Patch Safety）。'
  '三层并发保护：① FOR UPDATE 悲观锁；'
  '② p_expected_version 乐观锁（VERSION_CONFLICT）；'
  '③ UNIQUE(skill_card_id, version) DB 约束。'
  'VERSION_CONFLICT 时整个事务回滚，memory_episodes 不产生断链记录（需求 6）。';
