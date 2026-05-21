
-- ══════════════════════════════════════════════════════════════════════
--  Milestone 5 – evaluate_patch_outcome RPC
--
--  触发时机：任务执行完成（success/failed）后，前端调用此 RPC。
--
--  四维对比（需求 3）：
--    ① 成功率对比（success_rate_before vs after）
--    ② 平均耗时对比（avg_duration_before vs after）
--    ③ 失败类型是否消失（failure_types_resolved）
--    ④ 同一 affected_step 是否仍然失败（steps_still_failing）
--
--  窗口策略：
--    - 取补丁时间点前最近 WINDOW 条完成的 task_run
--    - 取补丁时间点后最近 WINDOW 条完成的 task_run（含本次）
--    - WINDOW = 10（可配置）
--    - 若 before_count = 0：写入 evaluation_status='insufficient_data_before'
--    - 若 after_count  = 0：写入 evaluation_status='insufficient_data_after'
--
--  失败类型来源：
--    task_run.steps_result（jsonb 数组，每个元素可含 success/action/description/error 字段）
-- ══════════════════════════════════════════════════════════════════════

CREATE FUNCTION public.evaluate_patch_outcome(
  p_skill_card_id uuid,
  p_task_id       uuid,
  p_task_run_id   uuid      -- 刚完成的那次 task_run
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id           uuid := auth.uid();
  v_window            int  := 10;          -- 评估窗口：前/后各取最多 N 条
  v_patch_ep          RECORD;
  v_patch_applied_at  timestamptz;
  v_prev_version      text;
  v_new_version       text;

  -- 窗口统计
  v_before_total      int;
  v_before_success    int;
  v_before_succ_rate  numeric;
  v_before_avg_dur    numeric;
  v_before_fail_types text[];
  v_before_steps      text[];

  v_after_total       int;
  v_after_success     int;
  v_after_succ_rate   numeric;
  v_after_avg_dur     numeric;
  v_after_fail_types  text[];
  v_after_steps       text[];

  -- 四维评估
  v_succ_rate_delta   numeric;
  v_dur_delta         numeric;
  v_resolved_failures text[];
  v_persisting_failures text[];
  v_resolved_steps    text[];
  v_still_failing_steps text[];

  v_status            text;
  v_episode_id        uuid;
  v_applied_at        timestamptz := now();
BEGIN
  -- ── 0. 鉴权 ──────────────────────────────────────────────────────────
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: 用户未登录';
  END IF;

  IF p_skill_card_id IS NULL OR p_task_id IS NULL OR p_task_run_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_INPUT: skill_card_id / task_id / task_run_id 均不能为空';
  END IF;

  -- ── 1. 查找最近一次 parameter_patch 记录（作为时间分界点）──────────
  SELECT me.created_at,
         (me.content_json->>'prev_version') AS prev_ver,
         (me.content_json->>'new_version')  AS new_ver
  INTO v_patch_ep
  FROM memory_episodes me
  WHERE me.skill_card_id = p_skill_card_id
    AND me.type = 'parameter_patch'
    AND me.user_id = v_user_id
  ORDER BY me.created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: skill_card % 未找到 parameter_patch 记录，无法评估', p_skill_card_id;
  END IF;

  v_patch_applied_at := v_patch_ep.created_at;
  v_prev_version     := v_patch_ep.prev_ver;
  v_new_version      := v_patch_ep.new_ver;

  -- ── 2a. 补丁前窗口统计 ───────────────────────────────────────────────
  SELECT
    COUNT(*)::int,
    SUM(CASE WHEN tr.status = 'success' THEN 1 ELSE 0 END)::int,
    ROUND(AVG(tr.duration_ms)::numeric, 2),
    -- 失败类型：从 steps_result 中提取 error 字段
    ARRAY(
      SELECT DISTINCT COALESCE(step->>'error', step->>'action', 'unknown')
      FROM (
        SELECT jsonb_array_elements(tr2.steps_result) AS step
        FROM task_runs tr2
        WHERE tr2.task_id     = p_task_id
          AND tr2.skill_card_id = p_skill_card_id
          AND tr2.ended_at    < v_patch_applied_at
          AND tr2.status      IN ('success', 'failed')
          AND tr2.user_id     = v_user_id
        ORDER BY tr2.ended_at DESC
        LIMIT v_window
      ) sub
      WHERE (step->>'success')::boolean = false
        AND COALESCE(step->>'error', step->>'action', '') <> ''
    ),
    -- 受影响步骤：格式 "index:action"
    ARRAY(
      SELECT DISTINCT (step->>'step_index') || ':' || COALESCE(step->>'action', '?')
      FROM (
        SELECT jsonb_array_elements(tr2.steps_result) AS step
        FROM task_runs tr2
        WHERE tr2.task_id     = p_task_id
          AND tr2.skill_card_id = p_skill_card_id
          AND tr2.ended_at    < v_patch_applied_at
          AND tr2.status      IN ('success', 'failed')
          AND tr2.user_id     = v_user_id
        ORDER BY tr2.ended_at DESC
        LIMIT v_window
      ) sub
      WHERE (step->>'success')::boolean = false
    )
  INTO v_before_total, v_before_success, v_before_avg_dur, v_before_fail_types, v_before_steps
  FROM (
    SELECT tr.status, tr.duration_ms, tr.steps_result
    FROM task_runs tr
    WHERE tr.task_id      = p_task_id
      AND tr.skill_card_id = p_skill_card_id
      AND tr.ended_at     < v_patch_applied_at
      AND tr.status       IN ('success', 'failed')
      AND tr.user_id      = v_user_id
    ORDER BY tr.ended_at DESC
    LIMIT v_window
  ) tr;

  v_before_total   := COALESCE(v_before_total, 0);
  v_before_success := COALESCE(v_before_success, 0);
  v_before_succ_rate := CASE WHEN v_before_total > 0
    THEN ROUND((v_before_success::numeric / v_before_total) * 100, 1)
    ELSE NULL END;
  v_before_fail_types := COALESCE(v_before_fail_types, '{}');
  v_before_steps      := COALESCE(v_before_steps, '{}');

  -- ── 2b. 补丁后窗口统计 ───────────────────────────────────────────────
  SELECT
    COUNT(*)::int,
    SUM(CASE WHEN tr.status = 'success' THEN 1 ELSE 0 END)::int,
    ROUND(AVG(tr.duration_ms)::numeric, 2),
    ARRAY(
      SELECT DISTINCT COALESCE(step->>'error', step->>'action', 'unknown')
      FROM (
        SELECT jsonb_array_elements(tr2.steps_result) AS step
        FROM task_runs tr2
        WHERE tr2.task_id      = p_task_id
          AND tr2.skill_card_id = p_skill_card_id
          AND tr2.ended_at    >= v_patch_applied_at
          AND tr2.status       IN ('success', 'failed')
          AND tr2.user_id      = v_user_id
        ORDER BY tr2.ended_at DESC
        LIMIT v_window
      ) sub
      WHERE (step->>'success')::boolean = false
        AND COALESCE(step->>'error', step->>'action', '') <> ''
    ),
    ARRAY(
      SELECT DISTINCT (step->>'step_index') || ':' || COALESCE(step->>'action', '?')
      FROM (
        SELECT jsonb_array_elements(tr2.steps_result) AS step
        FROM task_runs tr2
        WHERE tr2.task_id      = p_task_id
          AND tr2.skill_card_id = p_skill_card_id
          AND tr2.ended_at    >= v_patch_applied_at
          AND tr2.status       IN ('success', 'failed')
          AND tr2.user_id      = v_user_id
        ORDER BY tr2.ended_at DESC
        LIMIT v_window
      ) sub
      WHERE (step->>'success')::boolean = false
    )
  INTO v_after_total, v_after_success, v_after_avg_dur, v_after_fail_types, v_after_steps
  FROM (
    SELECT tr.status, tr.duration_ms, tr.steps_result
    FROM task_runs tr
    WHERE tr.task_id      = p_task_id
      AND tr.skill_card_id = p_skill_card_id
      AND tr.ended_at    >= v_patch_applied_at
      AND tr.status       IN ('success', 'failed')
      AND tr.user_id      = v_user_id
    ORDER BY tr.ended_at DESC
    LIMIT v_window
  ) tr;

  v_after_total   := COALESCE(v_after_total, 0);
  v_after_success := COALESCE(v_after_success, 0);
  v_after_succ_rate := CASE WHEN v_after_total > 0
    THEN ROUND((v_after_success::numeric / v_after_total) * 100, 1)
    ELSE NULL END;
  v_after_fail_types := COALESCE(v_after_fail_types, '{}');
  v_after_steps      := COALESCE(v_after_steps, '{}');

  -- ── 3. 数据充分性检验 ──────────────────────────────────────────────
  IF v_before_total = 0 THEN
    v_status := 'insufficient_data_before';
  ELSIF v_after_total = 0 THEN
    v_status := 'insufficient_data_after';
  ELSE
    -- ── 4. 四维对比计算 ──────────────────────────────────────────────

    -- ① 成功率变化
    v_succ_rate_delta := COALESCE(v_after_succ_rate, 0) - COALESCE(v_before_succ_rate, 0);

    -- ② 耗时变化（正数 = 变慢，负数 = 变快）
    v_dur_delta := COALESCE(v_after_avg_dur, 0) - COALESCE(v_before_avg_dur, 0);

    -- ③ 已消除的失败类型（在 before 存在，after 不存在）
    SELECT ARRAY(
      SELECT unnest(v_before_fail_types)
      EXCEPT
      SELECT unnest(v_after_fail_types)
    ) INTO v_resolved_failures;

    -- 仍然存在的失败类型（两窗口交集）
    SELECT ARRAY(
      SELECT unnest(v_before_fail_types)
      INTERSECT
      SELECT unnest(v_after_fail_types)
    ) INTO v_persisting_failures;

    -- ④ 已修复的步骤（before 失败，after 不再失败）
    SELECT ARRAY(
      SELECT unnest(v_before_steps)
      EXCEPT
      SELECT unnest(v_after_steps)
    ) INTO v_resolved_steps;

    -- 仍然失败的步骤（两窗口交集）
    SELECT ARRAY(
      SELECT unnest(v_before_steps)
      INTERSECT
      SELECT unnest(v_after_steps)
    ) INTO v_still_failing_steps;

    v_status := 'evaluated';
  END IF;

  -- ── 5. 写入 patch_evaluation episode ─────────────────────────────
  INSERT INTO memory_episodes (
    type, title, content_json,
    skill_card_id, task_id, task_run_id,
    tags, user_id
  ) VALUES (
    'patch_evaluation',
    '补丁评估: v' || COALESCE(v_prev_version, '?') || ' → v' || COALESCE(v_new_version, '?')
      || CASE WHEN v_status = 'evaluated'
              THEN ' | 成功率 ' || COALESCE(v_before_succ_rate::text, '?')
                   || '% → ' || COALESCE(v_after_succ_rate::text, '?') || '%'
              ELSE ' | ' || v_status
         END,
    jsonb_build_object(
      -- 评估元数据
      'evaluation_status',    v_status,
      'patch_applied_at',     v_patch_applied_at,
      'prev_version',         v_prev_version,
      'new_version',          v_new_version,
      'evaluated_at',         v_applied_at,
      'window_size',          v_window,
      -- 补丁前窗口
      'before', jsonb_build_object(
        'total',       v_before_total,
        'success',     v_before_success,
        'success_rate', v_before_succ_rate,
        'avg_duration_ms', v_before_avg_dur,
        'failure_types',  to_jsonb(v_before_fail_types),
        'affected_steps', to_jsonb(v_before_steps)
      ),
      -- 补丁后窗口
      'after', jsonb_build_object(
        'total',       v_after_total,
        'success',     v_after_success,
        'success_rate', v_after_succ_rate,
        'avg_duration_ms', v_after_avg_dur,
        'failure_types',  to_jsonb(v_after_fail_types),
        'affected_steps', to_jsonb(v_after_steps)
      ),
      -- 四维对比结论
      'delta', jsonb_build_object(
        'success_rate_delta',      v_succ_rate_delta,
        'duration_ms_delta',       v_dur_delta,
        'resolved_failure_types',  to_jsonb(v_resolved_failures),
        'persisting_failure_types',to_jsonb(v_persisting_failures),
        'resolved_steps',          to_jsonb(v_resolved_steps),
        'still_failing_steps',     to_jsonb(v_still_failing_steps)
      )
    ),
    p_skill_card_id,
    p_task_id,
    p_task_run_id,
    ARRAY['patch_evaluation', 'milestone5', v_status],
    v_user_id
  )
  RETURNING id INTO v_episode_id;

  RETURN jsonb_build_object(
    'ok',                  true,
    'episode_id',          v_episode_id,
    'evaluation_status',   v_status,
    'prev_version',        v_prev_version,
    'new_version',         v_new_version,
    'before_success_rate', v_before_succ_rate,
    'after_success_rate',  v_after_succ_rate,
    'success_rate_delta',  v_succ_rate_delta,
    'before_avg_duration', v_before_avg_dur,
    'after_avg_duration',  v_after_avg_dur,
    'duration_delta',      v_dur_delta,
    'resolved_failure_types',   to_jsonb(v_resolved_failures),
    'persisting_failure_types', to_jsonb(v_persisting_failures),
    'resolved_steps',           to_jsonb(v_resolved_steps),
    'still_failing_steps',      to_jsonb(v_still_failing_steps)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.evaluate_patch_outcome(uuid, uuid, uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.evaluate_patch_outcome(uuid, uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.evaluate_patch_outcome(uuid, uuid, uuid) IS
  '评估参数补丁应用效果（Milestone 5）。'
  '以最近 parameter_patch episode 时间为分界，对比前后各 10 条 task_run，'
  '输出四维对比（成功率/耗时/失败类型/受影响步骤）并写入 patch_evaluation episode。';
