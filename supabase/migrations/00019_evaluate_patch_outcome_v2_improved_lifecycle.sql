
-- ══════════════════════════════════════════════════════════════════════
--  evaluate_patch_outcome v2 — 需求 5-9
--
--  新增：
--    需求 5  content_json 完整字段（skill_card_id / skill_history_id /
--             parameter_patch_episode_id / before/after_task_run_id /
--             before/after_status / before/after_failure_type /
--             improved / evaluation_summary）
--    需求 6  补丁后成功 → improved=true
--    需求 7  补丁后仍失败且 failure_type 相同 → improved=false
--    需求 8  连续 N=3 次 improved=true → 技能卡生命周期前进一档
--    需求 9  连续 N=3 次 improved=false → 标记补丁无效（写 ineffective_patch 记录
--             并回退生命周期一档）
--
--  生命周期前进序列（req 8）：
--    candidate → temporary → sandbox → gray_matter → mature
--  生命周期回退（req 9）：
--    任意状态退回上一档，最低保持 candidate；
--    universal / deprecated 不参与自动推进 / 回退
-- ══════════════════════════════════════════════════════════════════════

-- 先删除旧签名
DROP FUNCTION IF EXISTS public.evaluate_patch_outcome(uuid, uuid, uuid);

CREATE FUNCTION public.evaluate_patch_outcome(
  p_skill_card_id uuid,
  p_task_id       uuid,
  p_task_run_id   uuid      -- 刚完成的 after run
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- 常量
  v_window           int  := 10;   -- 窗口聚合条数
  v_consec_threshold int  := 3;    -- 连续评估触发阈值（需求 8/9）

  v_user_id          uuid := auth.uid();

  -- 补丁元数据
  v_patch_ep_id      uuid;
  v_patch_applied_at timestamptz;
  v_prev_version     text;
  v_new_version      text;
  v_skill_history_id uuid;

  -- 单次对比（需求 5–7）
  v_before_run       RECORD;
  v_after_run        RECORD;
  v_before_fail_type text;
  v_after_fail_type  text;
  v_improved         boolean;
  v_eval_summary     text;

  -- 窗口聚合（原有逻辑保留）
  v_before_total     int;  v_before_success int;
  v_before_succ_rate numeric; v_before_avg_dur numeric;
  v_before_fail_types text[]; v_before_steps text[];
  v_after_total      int;  v_after_success int;
  v_after_succ_rate  numeric; v_after_avg_dur numeric;
  v_after_fail_types text[]; v_after_steps text[];
  v_succ_rate_delta  numeric; v_dur_delta numeric;
  v_resolved_failures text[]; v_persisting_failures text[];
  v_resolved_steps   text[];  v_still_failing_steps text[];

  -- 生命周期（需求 8/9）
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
  -- ── 0. 鉴权 ──────────────────────────────────────────────────────────
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: 用户未登录';
  END IF;
  IF p_skill_card_id IS NULL OR p_task_id IS NULL OR p_task_run_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_INPUT: skill_card_id / task_id / task_run_id 均不能为空';
  END IF;

  -- ── 1. 最近一次 parameter_patch（时间分界 + episode id + skill_history_id）
  SELECT me.id,
         me.created_at,
         (me.content_json->>'prev_version')   AS prev_ver,
         (me.content_json->>'new_version')    AS new_ver,
         (me.content_json->>'skill_history_id')::uuid AS sh_id
  INTO v_patch_ep_id, v_patch_applied_at, v_prev_version, v_new_version, v_skill_history_id
  FROM memory_episodes me
  WHERE me.skill_card_id = p_skill_card_id
    AND me.type          = 'parameter_patch'
    AND me.user_id       = v_user_id
  ORDER BY me.created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: skill_card % 未找到 parameter_patch 记录，无法评估', p_skill_card_id;
  END IF;

  -- ── 2. after run（当前传入 p_task_run_id）────────────────────────────
  SELECT id, status, ended_at, duration_ms
  INTO v_after_run
  FROM task_runs
  WHERE id      = p_task_run_id
    AND user_id = v_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: task_run % 不存在', p_task_run_id;
  END IF;

  -- ── 3. before run（补丁前最近一次完成的 run）────────────────────────
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
  -- before 不存在时 v_before_run 为 NULL，后续 insufficient_data_before 分支处理

  -- ── 4. 提取 failure_type（来自 failure 类型 episode 的 content_json）─
  IF v_before_run.id IS NOT NULL AND v_before_run.status = 'failed' THEN
    SELECT COALESCE(me.content_json->>'failure_type', 'unknown')
    INTO v_before_fail_type
    FROM memory_episodes me
    WHERE me.task_run_id = v_before_run.id
      AND me.type        = 'failure'
      AND me.user_id     = v_user_id
    ORDER BY me.created_at DESC
    LIMIT 1;
    v_before_fail_type := COALESCE(v_before_fail_type, 'unknown');
  ELSIF v_before_run.id IS NOT NULL THEN
    v_before_fail_type := NULL;   -- before 成功，无 failure_type
  ELSE
    v_before_fail_type := NULL;   -- 无 before run
  END IF;

  IF v_after_run.status = 'failed' THEN
    SELECT COALESCE(me.content_json->>'failure_type', 'unknown')
    INTO v_after_fail_type
    FROM memory_episodes me
    WHERE me.task_run_id = v_after_run.id
      AND me.type        = 'failure'
      AND me.user_id     = v_user_id
    ORDER BY me.created_at DESC
    LIMIT 1;
    v_after_fail_type := COALESCE(v_after_fail_type, 'unknown');
  ELSE
    v_after_fail_type := NULL;    -- after 成功，无 failure_type
  END IF;

  -- ── 5. improved 判定（需求 6/7）──────────────────────────────────────
  IF v_after_run.status = 'success' THEN
    -- 需求 6：补丁后任务成功 → improved=true
    v_improved     := true;
    v_eval_summary := '补丁有效：任务执行成功'
      || CASE WHEN v_before_run.id IS NOT NULL
              THEN '（前次状态: ' || v_before_run.status || '）'
              ELSE '' END;
  ELSIF v_after_run.status = 'failed'
    AND v_before_fail_type IS NOT NULL
    AND v_after_fail_type  IS NOT NULL
    AND v_after_fail_type = v_before_fail_type THEN
    -- 需求 7：仍失败且 failure_type 相同 → improved=false
    v_improved     := false;
    v_eval_summary := '补丁无效：仍以相同原因失败（' || v_after_fail_type || '）';
  ELSIF v_after_run.status = 'failed' THEN
    -- 失败但 failure_type 已改变 → 部分改善（improved=NULL 用 true 表示进步方向）
    v_improved     := NULL;
    v_eval_summary := '部分改善：仍失败但失败类型已变化（'
      || COALESCE(v_before_fail_type, '?') || ' → ' || COALESCE(v_after_fail_type, 'unknown') || '）';
  ELSE
    v_improved     := NULL;
    v_eval_summary := '状态未知';
  END IF;

  -- ── 6. 数据充分性检验 + 窗口聚合（原有逻辑）───────────────────────
  IF v_before_run.id IS NULL THEN
    v_status := 'insufficient_data_before';
    v_before_total := 0;
  ELSE
    -- 补丁前窗口
    SELECT COUNT(*)::int,
           SUM(CASE WHEN tr.status='success' THEN 1 ELSE 0 END)::int,
           ROUND(AVG(tr.duration_ms)::numeric,2),
           ARRAY(SELECT DISTINCT COALESCE(s->>'error',s->>'action','unknown')
                 FROM (SELECT jsonb_array_elements(tr2.steps_result) s
                       FROM task_runs tr2
                       WHERE tr2.task_id=p_task_id AND tr2.skill_card_id=p_skill_card_id
                         AND tr2.ended_at<v_patch_applied_at AND tr2.status IN('success','failed')
                         AND tr2.user_id=v_user_id ORDER BY tr2.ended_at DESC LIMIT v_window) sub
                 WHERE (s->>'success')::boolean=false
                   AND COALESCE(s->>'error',s->>'action','')<>''),
           ARRAY(SELECT DISTINCT (s->>'step_index')||':'||COALESCE(s->>'action','?')
                 FROM (SELECT jsonb_array_elements(tr2.steps_result) s
                       FROM task_runs tr2
                       WHERE tr2.task_id=p_task_id AND tr2.skill_card_id=p_skill_card_id
                         AND tr2.ended_at<v_patch_applied_at AND tr2.status IN('success','failed')
                         AND tr2.user_id=v_user_id ORDER BY tr2.ended_at DESC LIMIT v_window) sub
                 WHERE (s->>'success')::boolean=false)
    INTO v_before_total, v_before_success, v_before_avg_dur, v_before_fail_types, v_before_steps
    FROM (SELECT tr.status, tr.duration_ms, tr.steps_result
          FROM task_runs tr
          WHERE tr.task_id=p_task_id AND tr.skill_card_id=p_skill_card_id
            AND tr.ended_at<v_patch_applied_at AND tr.status IN('success','failed')
            AND tr.user_id=v_user_id ORDER BY tr.ended_at DESC LIMIT v_window) tr;

    v_before_total   := COALESCE(v_before_total,0);
    v_before_success := COALESCE(v_before_success,0);
    v_before_succ_rate := CASE WHEN v_before_total>0
      THEN ROUND((v_before_success::numeric/v_before_total)*100,1) ELSE NULL END;
    v_before_fail_types := COALESCE(v_before_fail_types,'{}');
    v_before_steps      := COALESCE(v_before_steps,'{}');

    -- 补丁后窗口
    SELECT COUNT(*)::int,
           SUM(CASE WHEN tr.status='success' THEN 1 ELSE 0 END)::int,
           ROUND(AVG(tr.duration_ms)::numeric,2),
           ARRAY(SELECT DISTINCT COALESCE(s->>'error',s->>'action','unknown')
                 FROM (SELECT jsonb_array_elements(tr2.steps_result) s
                       FROM task_runs tr2
                       WHERE tr2.task_id=p_task_id AND tr2.skill_card_id=p_skill_card_id
                         AND tr2.ended_at>=v_patch_applied_at AND tr2.status IN('success','failed')
                         AND tr2.user_id=v_user_id ORDER BY tr2.ended_at DESC LIMIT v_window) sub
                 WHERE (s->>'success')::boolean=false
                   AND COALESCE(s->>'error',s->>'action','')<>''),
           ARRAY(SELECT DISTINCT (s->>'step_index')||':'||COALESCE(s->>'action','?')
                 FROM (SELECT jsonb_array_elements(tr2.steps_result) s
                       FROM task_runs tr2
                       WHERE tr2.task_id=p_task_id AND tr2.skill_card_id=p_skill_card_id
                         AND tr2.ended_at>=v_patch_applied_at AND tr2.status IN('success','failed')
                         AND tr2.user_id=v_user_id ORDER BY tr2.ended_at DESC LIMIT v_window) sub
                 WHERE (s->>'success')::boolean=false)
    INTO v_after_total, v_after_success, v_after_avg_dur, v_after_fail_types, v_after_steps
    FROM (SELECT tr.status, tr.duration_ms, tr.steps_result
          FROM task_runs tr
          WHERE tr.task_id=p_task_id AND tr.skill_card_id=p_skill_card_id
            AND tr.ended_at>=v_patch_applied_at AND tr.status IN('success','failed')
            AND tr.user_id=v_user_id ORDER BY tr.ended_at DESC LIMIT v_window) tr;

    v_after_total   := COALESCE(v_after_total,0);
    v_after_success := COALESCE(v_after_success,0);
    v_after_succ_rate := CASE WHEN v_after_total>0
      THEN ROUND((v_after_success::numeric/v_after_total)*100,1) ELSE NULL END;
    v_after_fail_types := COALESCE(v_after_fail_types,'{}');
    v_after_steps      := COALESCE(v_after_steps,'{}');

    -- 四维 delta
    v_succ_rate_delta := COALESCE(v_after_succ_rate,0)-COALESCE(v_before_succ_rate,0);
    v_dur_delta       := COALESCE(v_after_avg_dur,0)-COALESCE(v_before_avg_dur,0);
    SELECT ARRAY(SELECT unnest(v_before_fail_types) EXCEPT SELECT unnest(v_after_fail_types))
    INTO v_resolved_failures;
    SELECT ARRAY(SELECT unnest(v_before_fail_types) INTERSECT SELECT unnest(v_after_fail_types))
    INTO v_persisting_failures;
    SELECT ARRAY(SELECT unnest(v_before_steps) EXCEPT SELECT unnest(v_after_steps))
    INTO v_resolved_steps;
    SELECT ARRAY(SELECT unnest(v_before_steps) INTERSECT SELECT unnest(v_after_steps))
    INTO v_still_failing_steps;

    v_status := 'evaluated';
  END IF;

  -- ── 7. 写入 patch_evaluation episode（需求 4/5）──────────────────────
  INSERT INTO memory_episodes (
    type, title, content_json,
    skill_card_id, task_id, task_run_id,
    tags, user_id
  ) VALUES (
    'patch_evaluation',
    '补丁评估: v' || COALESCE(v_prev_version,'?') || ' → v' || COALESCE(v_new_version,'?')
      || ' | ' || CASE
          WHEN v_improved IS TRUE  THEN '✅ 有效'
          WHEN v_improved IS FALSE THEN '❌ 无效'
          ELSE '⚠️ 部分改善'
        END,
    jsonb_build_object(
      -- 需求 5 必填字段
      'skill_card_id',              p_skill_card_id,
      'skill_history_id',           v_skill_history_id,
      'parameter_patch_episode_id', v_patch_ep_id,
      'before_task_run_id',         v_before_run.id,
      'after_task_run_id',          p_task_run_id,
      'before_status',              v_before_run.status,
      'after_status',               v_after_run.status,
      'before_failure_type',        v_before_fail_type,
      'after_failure_type',         v_after_fail_type,
      'improved',                   v_improved,           -- 需求 6/7
      'evaluation_summary',         v_eval_summary,
      -- 补充元数据
      'evaluation_status',          v_status,
      'patch_applied_at',           v_patch_applied_at,
      'prev_version',               v_prev_version,
      'new_version',                v_new_version,
      'evaluated_at',               v_applied_at,
      'window_size',                v_window,
      'before', jsonb_build_object(
        'total', v_before_total, 'success', v_before_success,
        'success_rate', v_before_succ_rate, 'avg_duration_ms', v_before_avg_dur,
        'failure_types', to_jsonb(v_before_fail_types), 'affected_steps', to_jsonb(v_before_steps)
      ),
      'after', jsonb_build_object(
        'total', v_after_total, 'success', v_after_success,
        'success_rate', v_after_succ_rate, 'avg_duration_ms', v_after_avg_dur,
        'failure_types', to_jsonb(v_after_fail_types), 'affected_steps', to_jsonb(v_after_steps)
      ),
      'delta', jsonb_build_object(
        'success_rate_delta',       v_succ_rate_delta,
        'duration_ms_delta',        v_dur_delta,
        'resolved_failure_types',   to_jsonb(v_resolved_failures),
        'persisting_failure_types', to_jsonb(v_persisting_failures),
        'resolved_steps',           to_jsonb(v_resolved_steps),
        'still_failing_steps',      to_jsonb(v_still_failing_steps)
      )
    ),
    p_skill_card_id, p_task_id, p_task_run_id,
    ARRAY['patch_evaluation', 'milestone5', v_status,
          CASE WHEN v_improved IS TRUE THEN 'improved_true'
               WHEN v_improved IS FALSE THEN 'improved_false'
               ELSE 'improved_partial' END],
    v_user_id
  )
  RETURNING id INTO v_episode_id;

  -- ── 8. 连续评估 + 生命周期引擎（需求 8/9）────────────────────────────
  --  统计最近 v_consec_threshold 条 patch_evaluation 的 improved 值
  --  （不含当前刚写入的那条，但含其他历史条目）
  --  注意：当前 episode 已写入，直接统计最新 N 条（含本条）
  SELECT
    SUM(CASE WHEN (me.content_json->>'improved')::boolean = true  THEN 1 ELSE 0 END)::int,
    SUM(CASE WHEN (me.content_json->>'improved')::boolean = false THEN 1 ELSE 0 END)::int
  INTO v_consec_improved, v_consec_degraded
  FROM (
    SELECT me.content_json
    FROM memory_episodes me
    WHERE me.skill_card_id = p_skill_card_id
      AND me.type          = 'patch_evaluation'
      AND me.user_id       = v_user_id
    ORDER BY me.created_at DESC
    LIMIT v_consec_threshold
  ) me;

  v_consec_improved := COALESCE(v_consec_improved, 0);
  v_consec_degraded := COALESCE(v_consec_degraded, 0);

  -- 读取当前技能卡状态
  SELECT status INTO v_old_card_status
  FROM skill_cards WHERE id = p_skill_card_id;

  IF v_consec_improved >= v_consec_threshold
     AND v_old_card_status NOT IN ('universal', 'deprecated') THEN
    -- 需求 8：连续 N 次 improved=true → 前进一档
    v_new_card_status := CASE v_old_card_status
      WHEN 'candidate'  THEN 'temporary'::skill_status
      WHEN 'temporary'  THEN 'sandbox'::skill_status
      WHEN 'sandbox'    THEN 'gray_matter'::skill_status
      WHEN 'gray_matter' THEN 'mature'::skill_status
      ELSE v_old_card_status
    END;
    IF v_new_card_status <> v_old_card_status THEN
      UPDATE skill_cards
      SET status     = v_new_card_status,
          updated_at = v_applied_at
      WHERE id = p_skill_card_id;
      v_lifecycle_change := 'advanced: ' || v_old_card_status::text || ' → ' || v_new_card_status::text;
    END IF;

  ELSIF v_consec_degraded >= v_consec_threshold
    AND v_old_card_status NOT IN ('universal', 'deprecated') THEN
    -- 需求 9：连续 N 次 improved=false → 标记补丁无效 + 回退一档
    v_new_card_status := CASE v_old_card_status
      WHEN 'temporary'   THEN 'candidate'::skill_status
      WHEN 'sandbox'     THEN 'temporary'::skill_status
      WHEN 'gray_matter' THEN 'sandbox'::skill_status
      WHEN 'mature'      THEN 'gray_matter'::skill_status
      ELSE v_old_card_status   -- candidate 不再降
    END;
    IF v_new_card_status <> v_old_card_status THEN
      UPDATE skill_cards
      SET status     = v_new_card_status,
          updated_at = v_applied_at
      WHERE id = p_skill_card_id;
    END IF;
    v_lifecycle_change := 'ineffective_patch: ' || v_old_card_status::text || ' → ' || v_new_card_status::text;

    -- 写入 ineffective_patch 警告 episode
    INSERT INTO memory_episodes (
      type, title, content_json,
      skill_card_id, task_id, task_run_id,
      tags, user_id
    ) VALUES (
      'episode',
      '⚠️ 补丁无效警告：v' || COALESCE(v_prev_version,'?') || ' → v' || COALESCE(v_new_version,'?')
        || ' 连续 ' || v_consec_threshold || ' 次未改善',
      jsonb_build_object(
        'alert_type',              'ineffective_patch',
        'skill_card_id',           p_skill_card_id,
        'parameter_patch_episode_id', v_patch_ep_id,
        'consecutive_false_count', v_consec_degraded,
        'threshold',               v_consec_threshold,
        'prev_status',             v_old_card_status,
        'new_status',              v_new_card_status,
        'degraded_at',             v_applied_at,
        'prev_version',            v_prev_version,
        'new_version',             v_new_version
      ),
      p_skill_card_id, p_task_id, p_task_run_id,
      ARRAY['ineffective_patch', 'lifecycle_warning', 'milestone5'],
      v_user_id
    )
    RETURNING id INTO v_ineff_episode_id;
  END IF;

  -- ── 9. 返回完整结果 ────────────────────────────────────────────────
  RETURN jsonb_build_object(
    'ok',                          true,
    'episode_id',                  v_episode_id,
    'evaluation_status',           v_status,
    -- 需求 5 字段
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
    -- 四维聚合
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
    -- 生命周期
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
  '补丁效果评估 v2（Milestone 5 需求 5-9）。'
  '单次对比（improved 判定）+ 窗口聚合（四维 delta）+ 生命周期引擎（N=3 阈值）。'
  '连续 3 次 improved=true → 技能卡状态前进；连续 3 次 improved=false → 回退并写 ineffective_patch 告警。';
