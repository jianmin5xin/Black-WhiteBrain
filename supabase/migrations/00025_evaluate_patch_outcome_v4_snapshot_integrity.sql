
-- ══════════════════════════════════════════════════════════════════════
--  evaluate_patch_outcome v4 — Milestone 7 需求 4
--
--  变更：
--    · SELECT task_runs 时加入 tunable_params_snapshot 列
--    · patch_evaluation episode content_json 新增：
--        before_params_snapshot — before_run 执行时刻参数快照
--        after_params_snapshot  — after_run  执行时刻参数快照（p_task_run_id）
--    · ineffective_patch episode content_json 同步新增两字段
--    · RETURN 结果新增 before_params_snapshot / after_params_snapshot
--
--  不变：所有聚合逻辑、生命周期引擎、rollback_recommendation 均保持 v3 原样
-- ══════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.evaluate_patch_outcome(uuid, uuid, uuid);

CREATE FUNCTION public.evaluate_patch_outcome(
  p_skill_card_id uuid,
  p_task_id       uuid,
  p_task_run_id   uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id          uuid := auth.uid();
  v_window           int  := 5;
  v_applied_at       timestamptz := now();

  v_patch_ep_id         uuid;
  v_patch_applied_at    timestamptz;
  v_prev_version        text;
  v_new_version         text;
  v_skill_history_id    uuid;

  v_before_run       RECORD;
  v_after_run        RECORD;

  v_before_fail_type text;
  v_after_fail_type  text;
  v_improved         boolean;
  v_eval_summary     text;
  v_status           text;

  v_before_total     int; v_before_success int; v_before_succ_rate numeric;
  v_before_avg_dur   numeric;
  v_before_fail_types text[]; v_before_steps text[];
  v_after_total      int; v_after_success  int; v_after_succ_rate  numeric;
  v_after_avg_dur    numeric;
  v_after_fail_types text[]; v_after_steps  text[];

  v_succ_rate_delta  numeric;
  v_dur_delta        numeric;
  v_resolved_failures text[]; v_persisting_failures text[];
  v_resolved_steps    text[]; v_still_failing_steps text[];

  -- 生命周期
  v_old_card_status  skill_status;
  v_new_card_status  skill_status;
  v_lifecycle_change text := 'none';
  v_threshold_n      int  := 3;
  v_consec_improved  int  := 0;
  v_consec_degraded  int  := 0;

  v_episode_id       uuid;
  v_ineff_episode_id uuid;

  -- Milestone 7 需求 4: 执行时刻快照变量
  v_before_snapshot  jsonb := NULL;
  v_after_snapshot   jsonb := NULL;
BEGIN
  -- ── 0. 认证 ────────────────────────────────────────────────────────
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: 用户未登录';
  END IF;
  IF p_skill_card_id IS NULL OR p_task_id IS NULL OR p_task_run_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_INPUT: skill_card_id / task_id / task_run_id 均不能为空';
  END IF;

  -- ── 1. 最近一次 parameter_patch episode ──────────────────────────
  SELECT me.id, me.created_at,
         me.content_json->>'prev_version',
         me.content_json->>'new_version',
         (me.content_json->>'skill_history_id')::uuid
  INTO v_patch_ep_id, v_patch_applied_at, v_prev_version, v_new_version, v_skill_history_id
  FROM memory_episodes me
  WHERE me.skill_card_id = p_skill_card_id
    AND me.user_id       = v_user_id
    AND me.type          = 'parameter_patch'
  ORDER BY me.created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: skill_card % 未找到 parameter_patch 记录，无法评估', p_skill_card_id;
  END IF;

  -- ── 2. after run（含 snapshot，需求 4）────────────────────────────
  SELECT id, status, ended_at, duration_ms, tunable_params_snapshot
  INTO v_after_run
  FROM task_runs
  WHERE id = p_task_run_id AND user_id = v_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: task_run % 不存在', p_task_run_id;
  END IF;
  -- 需求 4: 保存 after snapshot
  v_after_snapshot := v_after_run.tunable_params_snapshot;

  -- ── 3. before run（含 snapshot，需求 4）───────────────────────────
  SELECT id, status, ended_at, duration_ms, tunable_params_snapshot
  INTO v_before_run
  FROM task_runs
  WHERE task_id       = p_task_id
    AND skill_card_id = p_skill_card_id
    AND ended_at      < v_patch_applied_at
    AND status        IN ('success', 'failed')
    AND user_id       = v_user_id
  ORDER BY ended_at DESC
  LIMIT 1;
  -- 需求 4: 保存 before snapshot（可为 NULL — insufficient_data_before 场景）
  v_before_snapshot := v_before_run.tunable_params_snapshot;

  -- ── 4. failure_type ───────────────────────────────────────────────
  IF v_before_run.id IS NOT NULL AND v_before_run.status = 'failed' THEN
    SELECT COALESCE(me.content_json->>'failure_type', 'unknown')
    INTO v_before_fail_type
    FROM memory_episodes me
    WHERE me.task_run_id = v_before_run.id AND me.type = 'failure' AND me.user_id = v_user_id
    ORDER BY me.created_at DESC LIMIT 1;
    v_before_fail_type := COALESCE(v_before_fail_type, 'unknown');
  ELSIF v_before_run.id IS NOT NULL THEN
    v_before_fail_type := NULL;
  ELSE
    v_before_fail_type := NULL;
  END IF;

  IF v_after_run.status = 'failed' THEN
    SELECT COALESCE(me.content_json->>'failure_type', 'unknown')
    INTO v_after_fail_type
    FROM memory_episodes me
    WHERE me.task_run_id = v_after_run.id AND me.type = 'failure' AND me.user_id = v_user_id
    ORDER BY me.created_at DESC LIMIT 1;
    v_after_fail_type := COALESCE(v_after_fail_type, 'unknown');
  ELSE
    v_after_fail_type := NULL;
  END IF;

  -- ── 5. improved 判定 ──────────────────────────────────────────────
  IF v_after_run.status = 'success' THEN
    v_improved     := true;
    v_eval_summary := '补丁有效：任务执行成功'
      || CASE WHEN v_before_run.id IS NOT NULL
              THEN '（前次状态: ' || v_before_run.status || '）' ELSE '' END;
  ELSIF v_after_run.status = 'failed'
    AND v_before_fail_type IS NOT NULL AND v_after_fail_type IS NOT NULL
    AND v_after_fail_type = v_before_fail_type THEN
    v_improved     := false;
    v_eval_summary := '补丁无效：仍以相同原因失败（' || v_after_fail_type || '）';
  ELSIF v_after_run.status = 'failed' THEN
    v_improved     := NULL;
    v_eval_summary := '部分改善：仍失败但失败类型已变化（'
      || COALESCE(v_before_fail_type,'?') || ' → ' || COALESCE(v_after_fail_type,'unknown') || '）';
  ELSE
    v_improved     := NULL;
    v_eval_summary := '状态未知';
  END IF;

  -- ── 6. 窗口聚合 ───────────────────────────────────────────────────
  IF v_before_run.id IS NULL THEN
    v_status       := 'insufficient_data_before';
    v_before_total := 0;
  ELSE
    SELECT COUNT(*)::int,
           SUM(CASE WHEN tr.status='success' THEN 1 ELSE 0 END)::int,
           ROUND(AVG(tr.duration_ms)::numeric,2),
           ARRAY(SELECT DISTINCT COALESCE(s->>'error',s->>'action','unknown')
                 FROM (SELECT jsonb_array_elements(tr2.steps_result) s FROM task_runs tr2
                       WHERE tr2.task_id=p_task_id AND tr2.skill_card_id=p_skill_card_id
                         AND tr2.ended_at<v_patch_applied_at AND tr2.status IN('success','failed')
                         AND tr2.user_id=v_user_id ORDER BY tr2.ended_at DESC LIMIT v_window) sub
                 WHERE (s->>'success')::boolean=false AND COALESCE(s->>'error',s->>'action','')<>''),
           ARRAY(SELECT DISTINCT (s->>'step_index')||':'||COALESCE(s->>'action','?')
                 FROM (SELECT jsonb_array_elements(tr2.steps_result) s FROM task_runs tr2
                       WHERE tr2.task_id=p_task_id AND tr2.skill_card_id=p_skill_card_id
                         AND tr2.ended_at<v_patch_applied_at AND tr2.status IN('success','failed')
                         AND tr2.user_id=v_user_id ORDER BY tr2.ended_at DESC LIMIT v_window) sub
                 WHERE (s->>'success')::boolean=false)
    INTO v_before_total,v_before_success,v_before_avg_dur,v_before_fail_types,v_before_steps
    FROM (SELECT tr.status,tr.duration_ms,tr.steps_result FROM task_runs tr
          WHERE tr.task_id=p_task_id AND tr.skill_card_id=p_skill_card_id
            AND tr.ended_at<v_patch_applied_at AND tr.status IN('success','failed')
            AND tr.user_id=v_user_id ORDER BY tr.ended_at DESC LIMIT v_window) tr;

    v_before_total:=COALESCE(v_before_total,0); v_before_success:=COALESCE(v_before_success,0);
    v_before_succ_rate:=CASE WHEN v_before_total>0 THEN ROUND((v_before_success::numeric/v_before_total)*100,1) ELSE NULL END;
    v_before_fail_types:=COALESCE(v_before_fail_types,'{}'); v_before_steps:=COALESCE(v_before_steps,'{}');

    SELECT COUNT(*)::int,
           SUM(CASE WHEN tr.status='success' THEN 1 ELSE 0 END)::int,
           ROUND(AVG(tr.duration_ms)::numeric,2),
           ARRAY(SELECT DISTINCT COALESCE(s->>'error',s->>'action','unknown')
                 FROM (SELECT jsonb_array_elements(tr2.steps_result) s FROM task_runs tr2
                       WHERE tr2.task_id=p_task_id AND tr2.skill_card_id=p_skill_card_id
                         AND tr2.ended_at>=v_patch_applied_at AND tr2.status IN('success','failed')
                         AND tr2.user_id=v_user_id ORDER BY tr2.ended_at DESC LIMIT v_window) sub
                 WHERE (s->>'success')::boolean=false AND COALESCE(s->>'error',s->>'action','')<>''),
           ARRAY(SELECT DISTINCT (s->>'step_index')||':'||COALESCE(s->>'action','?')
                 FROM (SELECT jsonb_array_elements(tr2.steps_result) s FROM task_runs tr2
                       WHERE tr2.task_id=p_task_id AND tr2.skill_card_id=p_skill_card_id
                         AND tr2.ended_at>=v_patch_applied_at AND tr2.status IN('success','failed')
                         AND tr2.user_id=v_user_id ORDER BY tr2.ended_at DESC LIMIT v_window) sub
                 WHERE (s->>'success')::boolean=false)
    INTO v_after_total,v_after_success,v_after_avg_dur,v_after_fail_types,v_after_steps
    FROM (SELECT tr.status,tr.duration_ms,tr.steps_result FROM task_runs tr
          WHERE tr.task_id=p_task_id AND tr.skill_card_id=p_skill_card_id
            AND tr.ended_at>=v_patch_applied_at AND tr.status IN('success','failed')
            AND tr.user_id=v_user_id ORDER BY tr.ended_at DESC LIMIT v_window) tr;

    v_after_total:=COALESCE(v_after_total,0); v_after_success:=COALESCE(v_after_success,0);
    v_after_succ_rate:=CASE WHEN v_after_total>0 THEN ROUND((v_after_success::numeric/v_after_total)*100,1) ELSE NULL END;
    v_after_fail_types:=COALESCE(v_after_fail_types,'{}'); v_after_steps:=COALESCE(v_after_steps,'{}');

    v_succ_rate_delta:=CASE WHEN v_before_succ_rate IS NOT NULL AND v_after_succ_rate IS NOT NULL
                            THEN v_after_succ_rate-v_before_succ_rate ELSE NULL END;
    v_dur_delta:=CASE WHEN v_before_avg_dur IS NOT NULL AND v_after_avg_dur IS NOT NULL
                      THEN v_after_avg_dur-v_before_avg_dur ELSE NULL END;

    IF v_after_total >= 1 THEN v_status := 'evaluated'; ELSE v_status := 'insufficient_data_after'; END IF;

    SELECT ARRAY(SELECT unnest(v_before_fail_types) EXCEPT SELECT unnest(v_after_fail_types)) INTO v_resolved_failures;
    SELECT ARRAY(SELECT unnest(v_before_fail_types) INTERSECT SELECT unnest(v_after_fail_types)) INTO v_persisting_failures;
    SELECT ARRAY(SELECT unnest(v_before_steps) EXCEPT SELECT unnest(v_after_steps)) INTO v_resolved_steps;
    SELECT ARRAY(SELECT unnest(v_before_steps) INTERSECT SELECT unnest(v_after_steps)) INTO v_still_failing_steps;
  END IF;

  -- ── 7. 写入 patch_evaluation episode（含 snapshot，需求 4）────────
  INSERT INTO memory_episodes (
    type, title, content_json, skill_card_id, task_id, task_run_id, tags, user_id
  ) VALUES (
    'patch_evaluation',
    '补丁评估: v'||COALESCE(v_prev_version,'?')||' → v'||COALESCE(v_new_version,'?')
      ||' | '||CASE WHEN v_improved IS TRUE THEN '✅ 有效'
                    WHEN v_improved IS FALSE THEN '❌ 无效'
                    ELSE '⚠️ 部分改善' END,
    jsonb_build_object(
      'skill_card_id',              p_skill_card_id,
      'skill_history_id',           v_skill_history_id,
      'parameter_patch_episode_id', v_patch_ep_id,
      'before_task_run_id',         v_before_run.id,
      'after_task_run_id',          p_task_run_id,
      'before_status',              v_before_run.status,
      'after_status',               v_after_run.status,
      'before_failure_type',        v_before_fail_type,
      'after_failure_type',         v_after_fail_type,
      'improved',                   v_improved,
      'evaluation_summary',         v_eval_summary,
      'evaluation_status',          v_status,
      'patch_applied_at',           v_patch_applied_at,
      'prev_version',               v_prev_version,
      'new_version',                v_new_version,
      'evaluated_at',               v_applied_at,
      'window_size',                v_window,
      -- Milestone 7 需求 4: 执行时刻 snapshot（不读 skill_cards 当前值）
      'before_params_snapshot',     v_before_snapshot,
      'after_params_snapshot',      v_after_snapshot,
      'before', jsonb_build_object(
        'total',v_before_total,'success',v_before_success,'success_rate',v_before_succ_rate,
        'avg_duration_ms',v_before_avg_dur,'failure_types',to_jsonb(v_before_fail_types),
        'affected_steps',to_jsonb(v_before_steps)),
      'after', jsonb_build_object(
        'total',v_after_total,'success',v_after_success,'success_rate',v_after_succ_rate,
        'avg_duration_ms',v_after_avg_dur,'failure_types',to_jsonb(v_after_fail_types),
        'affected_steps',to_jsonb(v_after_steps)),
      'delta', jsonb_build_object(
        'success_rate',v_succ_rate_delta,'avg_duration_ms',v_dur_delta,
        'resolved_failure_types',to_jsonb(v_resolved_failures),
        'persisting_failure_types',to_jsonb(v_persisting_failures),
        'resolved_steps',to_jsonb(v_resolved_steps),
        'still_failing_steps',to_jsonb(v_still_failing_steps))
    ),
    p_skill_card_id, p_task_id, p_task_run_id,
    ARRAY['patch_evaluation','milestone5','milestone7'],
    v_user_id
  ) RETURNING id INTO v_episode_id;

  -- ── 8. 生命周期引擎（连续判定） ───────────────────────────────────
  IF v_status = 'evaluated' THEN
    SELECT COUNT(*)::int INTO v_consec_improved
    FROM (
      SELECT (me.content_json->>'improved')::boolean AS imp
      FROM memory_episodes me
      WHERE me.skill_card_id = p_skill_card_id AND me.user_id = v_user_id
        AND me.type = 'patch_evaluation'
        AND (me.content_json->>'improved') IS NOT NULL
      ORDER BY me.created_at DESC
      LIMIT v_threshold_n
    ) recent WHERE imp = true;

    SELECT COUNT(*)::int INTO v_consec_degraded
    FROM (
      SELECT (me.content_json->>'improved')::boolean AS imp
      FROM memory_episodes me
      WHERE me.skill_card_id = p_skill_card_id AND me.user_id = v_user_id
        AND me.type = 'patch_evaluation'
        AND (me.content_json->>'improved') IS NOT NULL
      ORDER BY me.created_at DESC
      LIMIT v_threshold_n
    ) recent WHERE imp = false;

    SELECT status INTO v_old_card_status FROM skill_cards WHERE id = p_skill_card_id;

    IF v_consec_improved >= v_threshold_n THEN
      SELECT CASE v_old_card_status
        WHEN 'candidate'   THEN 'temporary'::skill_status
        WHEN 'temporary'   THEN 'sandbox'::skill_status
        WHEN 'sandbox'     THEN 'gray_matter'::skill_status
        WHEN 'gray_matter' THEN 'mature'::skill_status
        WHEN 'mature'      THEN 'universal'::skill_status
        ELSE v_old_card_status END
      INTO v_new_card_status;
      IF v_new_card_status IS DISTINCT FROM v_old_card_status THEN
        UPDATE skill_cards SET status = v_new_card_status, updated_at = v_applied_at
        WHERE id = p_skill_card_id;
        v_lifecycle_change := 'advanced: ' || v_old_card_status::text || '→' || v_new_card_status::text;
      END IF;
    ELSIF v_consec_degraded >= v_threshold_n THEN
      v_new_card_status := 'candidate';
      IF v_new_card_status IS DISTINCT FROM v_old_card_status THEN
        UPDATE skill_cards SET status = v_new_card_status, updated_at = v_applied_at
        WHERE id = p_skill_card_id;
      END IF;
      v_lifecycle_change := 'ineffective_patch: ' || v_old_card_status::text || '→candidate';

      -- ineffective_patch episode（含 snapshot，需求 4）
      INSERT INTO memory_episodes (
        type, title, content_json, skill_card_id, task_id, task_run_id, tags, user_id
      ) VALUES (
        'patch_evaluation',
        '无效补丁警告: 连续 ' || v_consec_degraded || ' 次未改善，技能卡已回退至 candidate',
        jsonb_build_object(
          'alert_type',               'ineffective_patch',
          'skill_card_id',            p_skill_card_id,
          'skill_history_id',         v_skill_history_id,
          'prev_version',             v_prev_version,
          'new_version',              v_new_version,
          'consecutive_degraded',     v_consec_degraded,
          'reverted_status',          v_old_card_status,
          'evaluated_at',             v_applied_at,
          -- Milestone 7 需求 4: 快照字段
          'before_params_snapshot',   v_before_snapshot,
          'after_params_snapshot',    v_after_snapshot,
          'rollback_recommendation', jsonb_build_object(
            'action',         'rollback_to_version',
            'target_version', v_prev_version,
            'reason',         '连续 ' || v_consec_degraded || ' 次 improved=false，建议回滚至补丁前版本 v'
                              || COALESCE(v_prev_version,'?'),
            'patch_params', (
              SELECT jsonb_agg(jsonb_build_object(
                'param_name',      me2.content_json->>'param_name',
                'rollback_to',     me2.content_json->>'prev_value',
                'current_value',   me2.content_json->>'applied_value',
                'original_reason', me2.content_json->>'reason'
              ))
              FROM memory_episodes me2
              WHERE me2.skill_card_id = p_skill_card_id
                AND me2.user_id       = v_user_id
                AND me2.type          = 'parameter_patch'
              ORDER BY me2.created_at DESC
              LIMIT 1
            ),
            'suggested_steps', jsonb_build_array(
              '1. 在技能卡管理页面确认当前参数已回退',
              '2. 重新执行任务，验证回退后效果',
              '3. 触发白质层重新推理，获取新补丁建议',
              '4. 将技能卡状态置回 ' || COALESCE(v_old_card_status::text,'candidate')
            )
          )
        ),
        p_skill_card_id, p_task_id, p_task_run_id,
        ARRAY['ineffective_patch','lifecycle_warning','milestone5','milestone7','rollback_recommendation'],
        v_user_id
      ) RETURNING id INTO v_ineff_episode_id;
    END IF;
  END IF;

  -- ── 9. 返回（含 snapshot，需求 4）────────────────────────────────
  RETURN jsonb_build_object(
    'ok',                          true,
    'episode_id',                  v_episode_id,
    'evaluation_status',           v_status,
    'skill_card_id',               p_skill_card_id,
    'skill_history_id',            v_skill_history_id,
    'parameter_patch_episode_id',  v_patch_ep_id,
    'before_task_run_id',          v_before_run.id,
    'after_task_run_id',           p_task_run_id,
    'before_status',               v_before_run.status,
    'after_status',                v_after_run.status,
    'before_failure_type',         v_before_fail_type,
    'after_failure_type',          v_after_fail_type,
    'improved',                    v_improved,
    'evaluation_summary',          v_eval_summary,
    'prev_version',                v_prev_version,
    'new_version',                 v_new_version,
    'before_success_rate',         v_before_succ_rate,
    'after_success_rate',          v_after_succ_rate,
    'success_rate_delta',          v_succ_rate_delta,
    'before_avg_duration',         v_before_avg_dur,
    'after_avg_duration',          v_after_avg_dur,
    'duration_delta',              v_dur_delta,
    'resolved_failure_types',      to_jsonb(v_resolved_failures),
    'persisting_failure_types',    to_jsonb(v_persisting_failures),
    'resolved_steps',              to_jsonb(v_resolved_steps),
    'still_failing_steps',         to_jsonb(v_still_failing_steps),
    'lifecycle_change',            v_lifecycle_change,
    'consecutive_improved',        v_consec_improved,
    'consecutive_degraded',        v_consec_degraded,
    'ineffective_patch_episode_id', v_ineff_episode_id,
    -- Milestone 7 需求 4: 快照字段（不读 skill_cards 当前值）
    'before_params_snapshot',      v_before_snapshot,
    'after_params_snapshot',       v_after_snapshot
  );
END;
$$;

REVOKE ALL ON FUNCTION public.evaluate_patch_outcome(uuid, uuid, uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.evaluate_patch_outcome(uuid, uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.evaluate_patch_outcome(uuid, uuid, uuid) IS
  'evaluate_patch_outcome v4（Milestone 7 需求 4）：'
  'SELECT task_runs 时加入 tunable_params_snapshot；'
  'patch_evaluation/ineffective_patch episode content_json 新增 '
  'before_params_snapshot / after_params_snapshot；'
  'RETURN 结果新增两 snapshot 字段。所有聚合逻辑与生命周期引擎保持 v3 不变。';
