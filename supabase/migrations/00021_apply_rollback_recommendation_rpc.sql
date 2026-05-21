
-- ══════════════════════════════════════════════════════════════════════
--  apply_rollback_recommendation — Milestone 6 需求 1-3
--
--  将 rollback_recommendation 从"告警建议"升级为可执行的受控回滚流程。
--
--  校验（需求 2）：
--    ① skill_card_id 存在且属于当前用户
--    ② skill_history_id 存在且属于该 skill_card
--    ③ rollback_recommendation 来源于 ineffective_patch 告警 episode
--    ④ skill_card.version 与 p_expected_version 一致（乐观锁）
--    ⑤ 当前用户是 skill_card.user_id 所有者
--
--  执行（需求 3）：
--    - 将 patch_params[].rollback_to 逐条写回 skill_card.tunable_params
--    - 版本号 patch+1（与 apply_param_patch 相同策略）
--    - 插入新 skill_history 行（source='rollback'，绝不覆盖旧行）
--    - 写入 parameter_patch 类型 memory_episode（含回滚溯源字段）
-- ══════════════════════════════════════════════════════════════════════

CREATE FUNCTION public.apply_rollback_recommendation(
  p_skill_card_id              uuid,
  p_ineffective_patch_ep_id    uuid,     -- ineffective_patch 告警 episode id
  p_skill_history_id           uuid,     -- 回滚依据的 skill_history id（校验②）
  p_expected_version           text      -- 乐观锁版本（校验④）
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id          uuid := auth.uid();

  v_card             RECORD;            -- skill_cards row
  v_history          RECORD;            -- skill_history row
  v_ep               RECORD;            -- ineffective_patch episode row
  v_rollback_rec     jsonb;             -- content_json.rollback_recommendation
  v_patch_params     jsonb;             -- rollback_recommendation.patch_params

  v_prev_version     text;
  v_new_version      text;
  v_version_parts    text[];
  v_new_patch_num    int;

  v_updated_params   jsonb;
  v_new_history_id   uuid;
  v_rollback_ep_id   uuid;
  v_applied_at       timestamptz := now();

  v_param_item       jsonb;
  v_param_name       text;
  v_rollback_to      text;
  v_numeric_val      jsonb;
  v_applied_summary  jsonb := '[]'::jsonb;
BEGIN
  -- ── 0. 认证校验 ────────────────────────────────────────────────────
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: 用户未登录';
  END IF;

  IF p_skill_card_id IS NULL OR p_ineffective_patch_ep_id IS NULL
     OR p_skill_history_id IS NULL OR p_expected_version IS NULL THEN
    RAISE EXCEPTION 'INVALID_INPUT: 所有参数均不能为空';
  END IF;

  -- ── 校验① ⑤: skill_card 存在 + 属于当前用户 ──────────────────────
  SELECT * INTO v_card
  FROM skill_cards
  WHERE id = p_skill_card_id AND user_id = v_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND_OR_FORBIDDEN: skill_card % 不存在或无权操作', p_skill_card_id;
  END IF;

  -- ── 校验④: 乐观锁版本一致性 ───────────────────────────────────────
  IF v_card.version IS DISTINCT FROM p_expected_version THEN
    RAISE EXCEPTION
      'VERSION_CONFLICT: skill_card % 当前版本为 %，传入 expected_version 为 %，请刷新后重试',
      p_skill_card_id, v_card.version, p_expected_version;
  END IF;

  -- ── 校验②: skill_history 存在且属于该 skill_card ─────────────────
  SELECT * INTO v_history
  FROM skill_history
  WHERE id = p_skill_history_id
    AND skill_card_id = p_skill_card_id
    AND user_id       = v_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'NOT_FOUND: skill_history % 不存在或不属于 skill_card %',
      p_skill_history_id, p_skill_card_id;
  END IF;

  -- ── 校验③: rollback_recommendation 来源于 ineffective_patch 告警 ─
  SELECT * INTO v_ep
  FROM memory_episodes
  WHERE id          = p_ineffective_patch_ep_id
    AND skill_card_id = p_skill_card_id
    AND user_id     = v_user_id
    AND (content_json->>'alert_type') = 'ineffective_patch';

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'INVALID_SOURCE: episode % 不存在、不属于该 skill_card 或 alert_type 非 ineffective_patch',
      p_ineffective_patch_ep_id;
  END IF;

  v_rollback_rec := v_ep.content_json->'rollback_recommendation';
  IF v_rollback_rec IS NULL THEN
    RAISE EXCEPTION
      'INVALID_SOURCE: episode % 缺少 rollback_recommendation 字段', p_ineffective_patch_ep_id;
  END IF;

  v_patch_params := v_rollback_rec->'patch_params';
  IF v_patch_params IS NULL OR jsonb_array_length(v_patch_params) = 0 THEN
    RAISE EXCEPTION
      'INVALID_SOURCE: rollback_recommendation.patch_params 为空，无可回滚参数';
  END IF;

  -- ── 需求3: 版本号推进（patch+1，与 apply_param_patch 策略一致）──
  v_prev_version  := v_card.version;
  v_version_parts := string_to_array(v_prev_version, '.');
  v_new_patch_num := COALESCE((v_version_parts[3])::int, 0) + 1;
  v_new_version   := COALESCE(v_version_parts[1], '1') || '.'
                  || COALESCE(v_version_parts[2], '0') || '.'
                  || v_new_patch_num::text;

  -- ── 需求3: 将 rollback_to 逐条写回 tunable_params ────────────────
  v_updated_params := v_card.tunable_params;

  FOR v_param_item IN SELECT * FROM jsonb_array_elements(v_patch_params)
  LOOP
    v_param_name   := v_param_item->>'param_name';
    v_rollback_to  := v_param_item->>'rollback_to';

    IF v_param_name IS NULL OR v_rollback_to IS NULL THEN
      CONTINUE;  -- 跳过不合法条目
    END IF;

    -- 数值/字符串自动推断（与 apply_param_patch 一致）
    IF v_rollback_to ~ '^-?[0-9]+(\.[0-9]+)?$' THEN
      v_numeric_val := to_jsonb(v_rollback_to::numeric);
    ELSE
      v_numeric_val := to_jsonb(v_rollback_to);
    END IF;

    v_updated_params  := v_updated_params || jsonb_build_object(v_param_name, v_numeric_val);

    -- 记录摘要（用于 episode 内容）
    v_applied_summary := v_applied_summary || jsonb_build_array(
      jsonb_build_object(
        'param_name',    v_param_name,
        'rolled_back_to', v_rollback_to,
        'from_value',    v_param_item->>'current_value'
      )
    );
  END LOOP;

  -- ── 需求3: UPDATE skill_cards ─────────────────────────────────────
  UPDATE skill_cards
  SET tunable_params = v_updated_params,
      version        = v_new_version,
      updated_at     = v_applied_at
  WHERE id = p_skill_card_id;

  -- ── 需求3: INSERT 新 skill_history（绝不覆盖旧行）────────────────
  INSERT INTO skill_history (
    skill_card_id, version, changes_json, tunable_params, status, notes, user_id
  ) VALUES (
    p_skill_card_id,
    v_new_version,
    jsonb_build_object(
      'source',                       'rollback',
      'rollback_from_version',        v_prev_version,
      'rollback_to_version',          v_rollback_rec->>'target_version',
      'ineffective_patch_episode_id', p_ineffective_patch_ep_id,
      'ref_skill_history_id',         p_skill_history_id,
      'expected_version',             p_expected_version,
      'applied_params',               v_applied_summary,
      'rollback_reason',              v_rollback_rec->>'reason'
    ),
    v_updated_params,
    v_card.status,
    '回滚: v' || v_prev_version || ' → v' || v_new_version
      || '（来源: ineffective_patch 告警 ' || LEFT(p_ineffective_patch_ep_id::text, 8) || '）',
    v_user_id
  ) RETURNING id INTO v_new_history_id;

  -- ── 需求3: 写入 parameter_patch memory_episode（含回滚溯源字段）──
  INSERT INTO memory_episodes (
    type, title, content_json,
    skill_card_id, skill_history_id, tags, user_id
  ) VALUES (
    'parameter_patch',
    '回滚补丁: v' || v_prev_version || ' → v' || v_new_version
      || '（ineffective_patch 回滚）',
    jsonb_build_object(
      'source',                       'rollback',
      'skill_card_id',                p_skill_card_id,
      'skill_history_id',             v_new_history_id,
      'ineffective_patch_episode_id', p_ineffective_patch_ep_id,
      'ref_skill_history_id',         p_skill_history_id,
      'prev_version',                 v_prev_version,
      'new_version',                  v_new_version,
      'expected_version',             p_expected_version,
      'target_version',               v_rollback_rec->>'target_version',
      'applied_at',                   v_applied_at,
      'applied_params',               v_applied_summary,
      'param_patches',                v_patch_params,
      'rollback_reason',              v_rollback_rec->>'reason',
      -- param_patches 格式兼容：用 rollback_to 当作 applied_value，old_value=current_value
      'is_rollback',                  true
    ),
    p_skill_card_id,
    v_new_history_id,
    ARRAY['parameter_patch', 'rollback', 'milestone6',
          'ineffective_patch_ep_' || LEFT(p_ineffective_patch_ep_id::text, 8)],
    v_user_id
  ) RETURNING id INTO v_rollback_ep_id;

  -- ── 返回 ──────────────────────────────────────────────────────────
  RETURN jsonb_build_object(
    'ok',                           true,
    'new_version',                  v_new_version,
    'prev_version',                 v_prev_version,
    'skill_card_id',                p_skill_card_id,
    'new_skill_history_id',         v_new_history_id,
    'ref_skill_history_id',         p_skill_history_id,
    'rollback_episode_id',          v_rollback_ep_id,
    'ineffective_patch_episode_id', p_ineffective_patch_ep_id,
    'applied_params',               v_applied_summary,
    'applied_at',                   v_applied_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_rollback_recommendation(uuid, uuid, uuid, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.apply_rollback_recommendation(uuid, uuid, uuid, text) TO authenticated;

COMMENT ON FUNCTION public.apply_rollback_recommendation(uuid, uuid, uuid, text) IS
  'Milestone 6 受控回滚执行 RPC。'
  '含5项校验（存在性/所有权/来源/乐观锁），生成新 skill_history + rollback parameter_patch episode，'
  '绝不覆盖历史行。';
