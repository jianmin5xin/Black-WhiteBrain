
-- ══════════════════════════════════════════════════════════════════════
--  apply_rollback_recommendation v2 — 需求 4-7
--
--  需求 4: memory_episode 类型改为 'rollback_applied'
--  需求 5: content_json 字段精确匹配规范
--  需求 6: 事务保护（plpgsql 单函数天然原子；EXCEPTION 块捕获任意失败
--           → 全部回滚）
--  需求 7: 并发保护
--    - VERSION_CONFLICT 在任何写操作之前 RAISE（版本检查前置）
--    - skill_history UNIQUE(skill_card_id,version) 约束兜底：
--      若两个并发请求恰好同时通过版本检查，后提交者触发 unique_violation,
--      被转换为 VERSION_CONFLICT 异常 → 整个事务回滚
--      → skill_history / memory_episodes 均无脏写
-- ══════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.apply_rollback_recommendation(uuid, uuid, uuid, text);

CREATE FUNCTION public.apply_rollback_recommendation(
  p_skill_card_id              uuid,
  p_ineffective_patch_ep_id    uuid,
  p_skill_history_id           uuid,
  p_expected_version           text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id          uuid := auth.uid();

  v_card             RECORD;
  v_history          RECORD;
  v_ep               RECORD;
  v_rollback_rec     jsonb;
  v_patch_params     jsonb;

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
  -- 需求 5: rollback_params 数组（精确字段名）
  v_rollback_params  jsonb := '[]'::jsonb;
BEGIN
  -- ── 0. 认证 ────────────────────────────────────────────────────────
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: 用户未登录';
  END IF;
  IF p_skill_card_id IS NULL OR p_ineffective_patch_ep_id IS NULL
     OR p_skill_history_id IS NULL OR p_expected_version IS NULL THEN
    RAISE EXCEPTION 'INVALID_INPUT: 所有参数均不能为空';
  END IF;

  -- ── 校验①⑤: skill_card 存在 + 归属当前用户 ──────────────────────
  SELECT * INTO v_card
  FROM skill_cards
  WHERE id = p_skill_card_id AND user_id = v_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND_OR_FORBIDDEN: skill_card % 不存在或无权操作', p_skill_card_id;
  END IF;

  -- ── 校验④: VERSION_CONFLICT 在所有写操作之前（需求 7）─────────────
  IF v_card.version IS DISTINCT FROM p_expected_version THEN
    RAISE EXCEPTION
      'VERSION_CONFLICT: skill_card % 当前版本为 %，传入 expected_version 为 %，请刷新后重试',
      p_skill_card_id, v_card.version, p_expected_version;
  END IF;

  -- ── 校验②: skill_history 存在且属于该 skill_card + 用户 ──────────
  SELECT * INTO v_history
  FROM skill_history
  WHERE id = p_skill_history_id
    AND skill_card_id = p_skill_card_id
    AND user_id       = v_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: skill_history % 不存在或不属于 skill_card %',
      p_skill_history_id, p_skill_card_id;
  END IF;

  -- ── 校验③: 来源必须是 ineffective_patch 告警 episode ─────────────
  SELECT * INTO v_ep
  FROM memory_episodes
  WHERE id            = p_ineffective_patch_ep_id
    AND skill_card_id = p_skill_card_id
    AND user_id       = v_user_id
    AND (content_json->>'alert_type') = 'ineffective_patch';
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'INVALID_SOURCE: episode % 不存在、不属于该 skill_card 或 alert_type 非 ineffective_patch',
      p_ineffective_patch_ep_id;
  END IF;

  v_rollback_rec := v_ep.content_json->'rollback_recommendation';
  IF v_rollback_rec IS NULL THEN
    RAISE EXCEPTION 'INVALID_SOURCE: episode % 缺少 rollback_recommendation 字段',
      p_ineffective_patch_ep_id;
  END IF;

  v_patch_params := v_rollback_rec->'patch_params';
  IF v_patch_params IS NULL OR jsonb_array_length(v_patch_params) = 0 THEN
    RAISE EXCEPTION 'INVALID_SOURCE: rollback_recommendation.patch_params 为空，无可回滚参数';
  END IF;

  -- ── 版本推进（patch+1） ───────────────────────────────────────────
  v_prev_version  := v_card.version;
  v_version_parts := string_to_array(v_prev_version, '.');
  v_new_patch_num := COALESCE((v_version_parts[3])::int, 0) + 1;
  v_new_version   := COALESCE(v_version_parts[1], '1') || '.'
                  || COALESCE(v_version_parts[2], '0') || '.'
                  || v_new_patch_num::text;

  -- ── 参数回写 ─────────────────────────────────────────────────────
  v_updated_params := v_card.tunable_params;
  FOR v_param_item IN SELECT * FROM jsonb_array_elements(v_patch_params) LOOP
    v_param_name  := v_param_item->>'param_name';
    v_rollback_to := v_param_item->>'rollback_to';
    CONTINUE WHEN v_param_name IS NULL OR v_rollback_to IS NULL;

    IF v_rollback_to ~ '^-?[0-9]+(\.[0-9]+)?$' THEN
      v_numeric_val := to_jsonb(v_rollback_to::numeric);
    ELSE
      v_numeric_val := to_jsonb(v_rollback_to);
    END IF;
    v_updated_params := v_updated_params || jsonb_build_object(v_param_name, v_numeric_val);

    -- 需求 5: rollback_params 精确字段
    v_rollback_params := v_rollback_params || jsonb_build_array(
      jsonb_build_object(
        'param_name',    v_param_name,
        'rollback_to',   v_rollback_to,
        'from_value',    COALESCE(v_param_item->>'current_value', v_param_item->>'applied_value')
      )
    );
  END LOOP;

  -- ══════════════════════════════════════════════════════════════════
  --  需求 6: 三写入操作在同一事务内，任一失败全部回滚
  --  需求 7: skill_history UNIQUE(skill_card_id,version) 兜底并发冲突
  --           → unique_violation 被捕获并重抛为 VERSION_CONFLICT
  -- ══════════════════════════════════════════════════════════════════
  BEGIN

    -- 写入① skill_cards 更新
    UPDATE skill_cards
    SET tunable_params = v_updated_params,
        version        = v_new_version,
        updated_at     = v_applied_at
    WHERE id = p_skill_card_id;

    -- 写入② skill_history 插入（新行，绝不覆盖旧版本）
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
        'rollback_params',              v_rollback_params,
        'rollback_reason',              v_rollback_rec->>'reason'
      ),
      v_updated_params,
      v_card.status,
      '回滚: v' || v_prev_version || ' → v' || v_new_version
        || '（来源: ineffective_patch ' || LEFT(p_ineffective_patch_ep_id::text, 8) || '）',
      v_user_id
    ) RETURNING id INTO v_new_history_id;

    -- 写入③ memory_episodes: 需求 4 type='rollback_applied'，需求 5 content_json 精确字段
    INSERT INTO memory_episodes (
      type, title, content_json,
      skill_card_id, skill_history_id, tags, user_id
    ) VALUES (
      'rollback_applied',
      '回滚执行: v' || v_prev_version || ' → v' || v_new_version
        || ' | ' || jsonb_array_length(v_rollback_params)::text || ' 个参数已恢复',
      jsonb_build_object(
        -- 需求 5: 七个必填字段（精确命名）
        'skill_card_id',              p_skill_card_id,
        'previous_skill_history_id',  p_skill_history_id,
        'new_skill_history_id',       v_new_history_id,
        'rollback_source_episode_id', p_ineffective_patch_ep_id,
        'rollback_params',            v_rollback_params,
        'rollback_reason',            v_rollback_rec->>'reason',
        'applied_at',                 v_applied_at,
        -- 扩展字段（便于审计/查询）
        'prev_version',               v_prev_version,
        'new_version',                v_new_version,
        'target_version',             v_rollback_rec->>'target_version',
        'is_rollback',                true
      ),
      p_skill_card_id,
      v_new_history_id,
      ARRAY['rollback_applied', 'milestone6',
            'ineffective_patch_ep_' || LEFT(p_ineffective_patch_ep_id::text, 8)],
      v_user_id
    ) RETURNING id INTO v_rollback_ep_id;

  EXCEPTION
    -- 需求 7: UNIQUE 约束兜底并发冲突 → 统一转为 VERSION_CONFLICT
    WHEN unique_violation THEN
      RAISE EXCEPTION
        'VERSION_CONFLICT: skill_history UNIQUE(skill_card_id,version) 冲突，'
        'skill_card % version % 已被并发请求写入，请刷新后重试',
        p_skill_card_id, v_new_version;
    WHEN OTHERS THEN
      RAISE;  -- 其余异常原样上抛，事务由调用层回滚
  END;

  RETURN jsonb_build_object(
    'ok',                           true,
    'new_version',                  v_new_version,
    'prev_version',                 v_prev_version,
    'skill_card_id',                p_skill_card_id,
    'new_skill_history_id',         v_new_history_id,
    'previous_skill_history_id',    p_skill_history_id,
    'rollback_episode_id',          v_rollback_ep_id,
    'ineffective_patch_episode_id', p_ineffective_patch_ep_id,
    'rollback_params',              v_rollback_params,
    'applied_at',                   v_applied_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_rollback_recommendation(uuid, uuid, uuid, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.apply_rollback_recommendation(uuid, uuid, uuid, text) TO authenticated;

COMMENT ON FUNCTION public.apply_rollback_recommendation(uuid, uuid, uuid, text) IS
  'apply_rollback_recommendation v2（需求 4-7）：'
  'type=rollback_applied episode + 7字段 content_json + '
  '事务保护（三写入原子） + VERSION_CONFLICT 并发防护（乐观锁+UNIQUE兜底）。';
