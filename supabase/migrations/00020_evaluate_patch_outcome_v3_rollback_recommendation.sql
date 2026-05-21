
-- ══════════════════════════════════════════════════════════════════════
--  evaluate_patch_outcome v3 — 需求 9 补充：rollback_recommendation
--
--  仅修改 v2 中 ineffective_patch 告警 episode 的 content_json，
--  在原有字段基础上追加 rollback_recommendation 对象，包含：
--    - action          : 'rollback_to_version'
--    - target_version  : 回滚到哪个版本（prev_version）
--    - reason          : 回滚原因描述
--    - patch_params    : 从 parameter_patch episode 中取出的 param_patches 数组
--                        每个元素含 param_name / old_value（回滚目标值）/ applied_value
--    - suggested_steps : 文本数组，逐步操作指引
--  其余逻辑与 v2 完全一致（不重复输出，仅 DROP + CREATE）
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
  v_window           int  := 10;
  v_consec_threshold int  := 3;
  v_user_id          uuid := auth.uid();

  v_patch_ep_id      uuid;
  v_patch_applied_at timestamptz;
  v_prev_version     text;
  v_new_version      text;
  v_skill_history_id uuid;
  v_patch_params     jsonb;   -- parameter_patch episode 中的 param_patches 数组

  v_before_run       RECORD;
  v_after_run        RECORD;
  v_before_fail_type text;
  v_after_fail_type  text;
  v_improved         boolean;
  v_eval_summary     text;

  v_before_total     int; v_before_success int;
  v_before_succ_rate numeric; v_before_avg_dur numeric;
  v_before_fail_types text[]; v_before_steps text[];
  v_after_total      int; v_after_success int;
  v_after_succ_rate  numeric; v_after_avg_dur numeric;
  v_after_fail_types text[]; v_after_steps text[];
  v_succ_rate_delta  numeric; v_dur_delta numeric;
  v_resolved_failures text[]; v_persisting_failures text[];
  v_resolved_steps   text[];  v_still_failing_steps text[];

  v_status            text;
  v_consec_improved   int  := 0;
  v_consec_degraded   int  := 0;
  v_lifecycle_change  text := 'none';
  v_old_card_status   skill_status;
  v_new_card_status   skill_status;
  v_episode_id        uuid;
  v_ineff_episode_id  uuid;
  v_applied_at        timestamptz := now();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: 用户未登录';
  END IF;
  IF p_skill_card_id IS NULL OR p_task_id IS NULL OR p_task_run_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_INPUT: skill_card_id / task_id / task_run_id 均不能为空';
  END IF;

  -- ── 1. 最近 parameter_patch（含 param_patches 数组，用于 rollback）──
  SELECT me.id,
         me.created_at,
         (me.content_json->>'prev_version')     AS prev_ver,
         (me.content_json->>'new_version')      AS new_ver,
         (me.content_json->>'skill_history_id')::uuid AS sh_id,
         COALESCE(me.content_json->'param_patches', '[]'::jsonb) AS patch_params
  INTO v_patch_ep_id, v_patch_applied_at, v_prev_version, v_new_version,
       v_skill_history_id, v_patch_params
  FROM memory_episodes me
  WHERE me.skill_card_id = p_skill_card_id
    AND me.type          = 'parameter_patch'
    AND me.user_id       = v_user_id
  ORDER BY me.created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: skill_card % 未找到 parameter_patch 记录，无法评估', p_skill_card_id;
  END IF;

  -- ── 2. after run ──────────────────────────────────────────────────
  SELECT id, status, ended_at, duration_ms
  INTO v_after_run
  FROM task_runs
  WHERE id = p_task_run_id AND user_id = v_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: task_run % 不存在', p_task_run_id;
  END IF;

  -- ── 3. before run ─────────────────────────────────────────────────
  SELECT id, status, ended_at, duration_ms
  INTO v_before_run
  FROM task_runs
  WHERE task_id       = p_task_id
    AND skill_card_id = p_skill_card_id
    AND ended_at      < v_patch_applied_at
    AND status        IN ('success', 'failed')
    AND user_id       = v_user_id
  ORDER BY ended_at DESC
  LIMIT 1;

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

    v_succ_rate_delta:=COALESCE(v_after_succ_rate,0)-COALESCE(v_before_succ_rate,0);
    v_dur_delta:=COALESCE(v_after_avg_dur,0)-COALESCE(v_before_avg_dur,0);
    SELECT ARRAY(SELECT unnest(v_before_fail_types) EXCEPT SELECT unnest(v_after_fail_types)) INTO v_resolved_failures;
    SELECT ARRAY(SELECT unnest(v_before_fail_types) INTERSECT SELECT unnest(v_after_fail_types)) INTO v_persisting_failures;
    SELECT ARRAY(SELECT unnest(v_before_steps) EXCEPT SELECT unnest(v_after_steps)) INTO v_resolved_steps;
    SELECT ARRAY(SELECT unnest(v_before_steps) INTERSECT SELECT unnest(v_after_steps)) INTO v_still_failing_steps;
    v_status := 'evaluated';
  END IF;

  -- ── 7. 写入 patch_evaluation episode ─────────────────────────────
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
      'before', jsonb_build_object(
        'total',v_before_total,'success',v_before_success,'success_rate',v_before_succ_rate,
        'avg_duration_ms',v_before_avg_dur,'failure_types',to_jsonb(v_before_fail_types),
        'affected_steps',to_jsonb(v_before_steps)),
      'after', jsonb_build_object(
        'total',v_after_total,'success',v_after_success,'success_rate',v_after_succ_rate,
        'avg_duration_ms',v_after_avg_dur,'failure_types',to_jsonb(v_after_fail_types),
        'affected_steps',to_jsonb(v_after_steps)),
      'delta', jsonb_build_object(
        'success_rate_delta',v_succ_rate_delta,'duration_ms_delta',v_dur_delta,
        'resolved_failure_types',to_jsonb(v_resolved_failures),
        'persisting_failure_types',to_jsonb(v_persisting_failures),
        'resolved_steps',to_jsonb(v_resolved_steps),
        'still_failing_steps',to_jsonb(v_still_failing_steps))
    ),
    p_skill_card_id, p_task_id, p_task_run_id,
    ARRAY['patch_evaluation','milestone5',v_status,
          CASE WHEN v_improved IS TRUE  THEN 'improved_true'
               WHEN v_improved IS FALSE THEN 'improved_false'
               ELSE 'improved_partial' END],
    v_user_id
  ) RETURNING id INTO v_episode_id;

  -- ── 8. 连续评估 + 生命周期引擎 ───────────────────────────────────
  SELECT
    SUM(CASE WHEN (me.content_json->>'improved')::boolean=true  THEN 1 ELSE 0 END)::int,
    SUM(CASE WHEN (me.content_json->>'improved')::boolean=false THEN 1 ELSE 0 END)::int
  INTO v_consec_improved, v_consec_degraded
  FROM (
    SELECT me.content_json FROM memory_episodes me
    WHERE me.skill_card_id=p_skill_card_id AND me.type='patch_evaluation' AND me.user_id=v_user_id
    ORDER BY me.created_at DESC LIMIT v_consec_threshold
  ) me;

  v_consec_improved:=COALESCE(v_consec_improved,0);
  v_consec_degraded:=COALESCE(v_consec_degraded,0);

  SELECT status INTO v_old_card_status FROM skill_cards WHERE id=p_skill_card_id;

  IF v_consec_improved>=v_consec_threshold AND v_old_card_status NOT IN ('universal','deprecated') THEN
    v_new_card_status:=CASE v_old_card_status
      WHEN 'candidate'   THEN 'temporary'::skill_status
      WHEN 'temporary'   THEN 'sandbox'::skill_status
      WHEN 'sandbox'     THEN 'gray_matter'::skill_status
      WHEN 'gray_matter' THEN 'mature'::skill_status
      ELSE v_old_card_status END;
    IF v_new_card_status<>v_old_card_status THEN
      UPDATE skill_cards SET status=v_new_card_status, updated_at=v_applied_at WHERE id=p_skill_card_id;
      v_lifecycle_change:='advanced: '||v_old_card_status::text||' → '||v_new_card_status::text;
    END IF;

  ELSIF v_consec_degraded>=v_consec_threshold AND v_old_card_status NOT IN ('universal','deprecated') THEN
    v_new_card_status:=CASE v_old_card_status
      WHEN 'temporary'   THEN 'candidate'::skill_status
      WHEN 'sandbox'     THEN 'temporary'::skill_status
      WHEN 'gray_matter' THEN 'sandbox'::skill_status
      WHEN 'mature'      THEN 'gray_matter'::skill_status
      ELSE v_old_card_status END;
    IF v_new_card_status<>v_old_card_status THEN
      UPDATE skill_cards SET status=v_new_card_status, updated_at=v_applied_at WHERE id=p_skill_card_id;
    END IF;
    v_lifecycle_change:='ineffective_patch: '||v_old_card_status::text||' → '||v_new_card_status::text;

    -- ── 需求 9 v3：写入含 rollback_recommendation 的告警 episode ────
    --  patch_params 从 parameter_patch episode 取出，每个元素倒转 old/applied:
    --    param_name     = 原参数名
    --    rollback_to    = old_value（补丁前的值，即回滚目标）
    --    current_value  = applied_value（当前生效的值）
    INSERT INTO memory_episodes (
      type, title, content_json, skill_card_id, task_id, task_run_id, tags, user_id
    ) VALUES (
      'episode',
      '⚠️ 补丁无效警告：v'||COALESCE(v_prev_version,'?')||' → v'||COALESCE(v_new_version,'?')
        ||' 连续 '||v_consec_threshold||' 次未改善',
      jsonb_build_object(
        'alert_type',               'ineffective_patch',
        'skill_card_id',            p_skill_card_id,
        'parameter_patch_episode_id', v_patch_ep_id,
        'consecutive_false_count',  v_consec_degraded,
        'threshold',                v_consec_threshold,
        'prev_status',              v_old_card_status,
        'new_status',               v_new_card_status,
        'degraded_at',              v_applied_at,
        'prev_version',             v_prev_version,
        'new_version',              v_new_version,
        -- ── 需求 9 新增：rollback_recommendation ────────────────────
        'rollback_recommendation', jsonb_build_object(
          'action',         'rollback_to_version',
          'target_version', v_prev_version,
          'reason',         '连续 '||v_consec_threshold||' 次 improved=false，'
                              ||'参数补丁（v'||COALESCE(v_prev_version,'?')
                              ||' → v'||COALESCE(v_new_version,'?')||'）未带来改善，建议回滚至上一稳定版本。',
          -- 将 param_patches 中每一条倒转为回滚指令
          'patch_params', (
            SELECT jsonb_agg(
              jsonb_build_object(
                'param_name',    p_item->>'param_name',
                'rollback_to',   p_item->>'old_value',     -- 回滚目标 = 补丁前值
                'current_value', COALESCE(p_item->>'applied_value', p_item->>'suggested_value'),
                'original_reason', p_item->>'reason'
              )
            )
            FROM jsonb_array_elements(v_patch_params) AS p_item
          ),
          'suggested_steps', jsonb_build_array(
            '1. 在技能卡编辑页面将上述参数恢复为 rollback_to 对应的值',
            '2. 重新执行任务验证回滚效果',
            '3. 若回滚后仍失败，建议重新触发白质层推理以获取新补丁方案',
            '4. 回滚操作完成后手动将技能卡状态置回 ' || COALESCE(v_old_card_status::text,'candidate')
          )
        )
      ),
      p_skill_card_id, p_task_id, p_task_run_id,
      ARRAY['ineffective_patch','lifecycle_warning','milestone5','rollback_recommendation'],
      v_user_id
    ) RETURNING id INTO v_ineff_episode_id;
  END IF;

  -- ── 9. 返回 ───────────────────────────────────────────────────────
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
    'ineffective_patch_episode_id', v_ineff_episode_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.evaluate_patch_outcome(uuid, uuid, uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.evaluate_patch_outcome(uuid, uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.evaluate_patch_outcome(uuid, uuid, uuid) IS
  '补丁效果评估 v3（Milestone 5 需求 5-9）。'
  '连续 N=3 次 improved=false → 写入含 rollback_recommendation 的 ineffective_patch 告警，'
  '包含逐条参数回滚指令（param_name/rollback_to/current_value）和操作步骤指引。';
