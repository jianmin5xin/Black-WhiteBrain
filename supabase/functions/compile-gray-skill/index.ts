import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Milestone 12: Gray Skill Compilation Integrity
 *
 * 基于 environment_profile 和成功 task_run_steps，自动生成 candidate skill_card。
 * 实现从成功轨迹到灰质技能卡的编译闭环。
 *
 * 输入: { task_id, task_run_id, environment_profile_id }
 * 输出: { skill_card }
 *
 * 校验规则:
 * 1. task_run 必须 status='success' 且 is_legacy_run=false
 * 2. 读取 task_run_steps 提取稳定 action sequence
 * 3. 读取 environment_profile，校验每个 step 的 selector 仍存在于 profile.elements
 * 4. 生成 skill_card（status='candidate'）
 */

interface CompileRequest {
  task_id: string;
  task_run_id: string;
  environment_profile_id: string;
}

/** 从 profile.elements 中提取所有 selector 构成的快速查找集 */
function buildSelectorIndex(elements: any[]): Set<string> {
  const index = new Set<string>();
  for (const el of elements || []) {
    if (el.selector) index.add(el.selector);
    // 同时索引候选 selector
    for (const cand of el.selector_candidates || []) {
      if (cand.selector) index.add(cand.selector);
    }
    // 索引属性中的 id/name/aria-label 等
    const attrs = el.attributes || {};
    if (attrs.id) index.add(`#${attrs.id}`);
    if (attrs.name && el.tag) index.add(`${el.tag}[name="${attrs.name}"]`);
    if (attrs["data-testid"]) index.add(`[data-testid="${attrs["data-testid"]}"]`);
    if (attrs["aria-label"]) index.add(`[aria-label="${attrs["aria-label"]}"]`);
  }
  return index;
}

/** 校验每个 step 的 selector 是否存在于环境画像 */
function validateSelectors(steps: any[], selectorIndex: Set<string>): { valid: boolean; invalidSteps: Array<{ step_index: number; selector: string; reason: string }> } {
  const invalidSteps: Array<{ step_index: number; selector: string; reason: string }> = [];

  for (const step of steps) {
    const selector = step.target_selector;
    if (!selector) continue; // 无 selector 的步骤（如 navigate/wait/screenshot）跳过

    if (!selectorIndex.has(selector)) {
      invalidSteps.push({
        step_index: step.step_index,
        selector,
        reason: `selector "${selector}" 不存在于 environment_profile 的 elements 中`,
      });
    }
  }

  return { valid: invalidSteps.length === 0, invalidSteps };
}

/** 从 task_run_steps 提取可调参数 */
function extractTunableParams(steps: any[]): Record<string, unknown> {
  // 默认参数
  const defaults = {
    detection_threshold: 0.62,
    reaction_delay_ms: 100,
    retry_count: 3,
    timeout_ms: 5000,
    confidence_min: 0.7,
  };

  // 如果所有步骤都是 success，提取实际执行时间来调整 timeout
  const maxDuration = Math.max(...steps.map(s => s.duration_ms || 0));
  if (maxDuration > 0) {
    defaults.timeout_ms = Math.max(defaults.timeout_ms, maxDuration * 2);
  }

  // 根据步骤数量调整 retry_count
  defaults.retry_count = Math.min(Math.max(steps.length, 1), 5);

  return defaults;
}

/** 从 steps 推导 execution_surfaces */
function deriveExecutionSurfaces(steps: any[]): string[] {
  const surfaces = new Set<string>(["wait", "screenshot"]);
  for (const step of steps) {
    const action = step.action_type;
    if (action === "click") surfaces.add("click");
    if (action === "fill") surfaces.add("fill");
    if (action === "select") surfaces.add("select");
    if (action === "navigate") surfaces.add("navigate");
    if (action === "press_key") surfaces.add("press_key");
  }
  return [...surfaces];
}

/** 计算最高风险等级 */
function deriveSafetyRisk(steps: any[]): string {
  const riskOrder = ["low", "medium", "high", "forbidden"];
  let maxRisk = 0;
  for (const step of steps) {
    const level = step.safety_risk_level || "low";
    const idx = riskOrder.indexOf(level);
    if (idx > maxRisk) maxRisk = idx;
  }
  return riskOrder[maxRisk];
}

/** 生成 safety_profile 记录每一层的风险详情 */
function buildSafetyProfile(steps: any[]) {
  return steps.map(s => ({
    step_index: s.step_index,
    action_type: s.action_type,
    risk_level: s.safety_risk_level || "low",
    matched_rule: s.matched_rule || "unknown"
  }));
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json() as CompileRequest;
    const { task_id, task_run_id, environment_profile_id } = body;

    if (!task_id || !task_run_id || !environment_profile_id) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: task_id, task_run_id, environment_profile_id" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseService = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // ── 1. 读取 task 和 task_run ─────────────────────────────────
    const { data: task } = await supabaseService
      .from("tasks")
      .select("id, name, steps_json, skill_card_id, environment_profile_id")
      .eq("id", task_id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!task) {
      return new Response(JSON.stringify({ error: "Task not found or access denied" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: taskRun } = await supabaseService
      .from("task_runs")
      .select("id, status, is_legacy_run, duration_ms, ended_at")
      .eq("id", task_run_id)
      .eq("task_id", task_id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!taskRun) {
      return new Response(JSON.stringify({ error: "Task run not found or access denied" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 校验规则 1: 只允许从 success 且 non-legacy 的 run 编译
    if (taskRun.status !== "success") {
      return new Response(
        JSON.stringify({ error: `Compilation rejected: task_run status is "${taskRun.status}", only "success" runs can be compiled` }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (taskRun.is_legacy_run) {
      return new Response(
        JSON.stringify({ error: "Compilation rejected: legacy runs cannot be compiled into skill cards" }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── 2. 读取 task_run_steps ─────────────────────────────────
    const { data: steps, error: stepsError } = await supabaseService
      .from("task_run_steps")
      .select("*")
      .eq("task_run_id", task_run_id)
      .order("step_index", { ascending: true });

    if (stepsError) {
      return new Response(JSON.stringify({ error: stepsError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!steps || steps.length === 0) {
      return new Response(
        JSON.stringify({ error: "No steps found for this task run" }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 只保留 success 状态的步骤作为技能卡 action sequence
    const successSteps = steps.filter((s: any) => s.status === "success");
    if (successSteps.length === 0) {
      return new Response(
        JSON.stringify({ error: "No successful steps found in this task run" }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── 3. 读取 environment_profile ──────────────────────────
    const { data: envProfile } = await supabaseService
      .from("environment_profiles")
      .select("*")
      .eq("id", environment_profile_id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!envProfile) {
      return new Response(
        JSON.stringify({ error: "Environment profile not found or access denied" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── 4. 校验 selector 存在性 ───────────────────────────────
    const selectorIndex = buildSelectorIndex(envProfile.elements || []);
    const selectorValidation = validateSelectors(successSteps, selectorIndex);

    if (!selectorValidation.valid) {
      return new Response(
        JSON.stringify({
          error: "Selector validation failed",
          invalid_steps: selectorValidation.invalidSteps,
          hint: "部分 step 的 target_selector 已不存在于当前环境画像中，请重新扫描环境或修复 selector",
        }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[Compile-Gray-Skill] All ${successSteps.length} selectors validated OK`);

    // ── 5. 生成 skill_card ───────────────────────────────────────
    const skillId = `skill_${(task.name || "unnamed").trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "").slice(0, 30)}_${Date.now().toString(36)}`;

    const actionSequence = successSteps.map((s: any) => ({
      action: s.action_type,
      selector: s.target_selector,
      value: s.input_value_snapshot,
      step_index: s.step_index,
    }));

    const compiledSkill = {
      skill_id: skillId,
      name: `${task.name} - 编译技能卡`,
      environment_type: envProfile.environment_type || "web_automation",
      perception_sources: envProfile.perception_surfaces || ["dom", "url", "title"],
      execution_surfaces: deriveExecutionSurfaces(successSteps),
      feedback_surfaces: envProfile.feedback_surfaces || ["dom_change", "url_change"],
      tunable_params: extractTunableParams(successSteps),
      safety: {
        risk_level: deriveSafetyRisk(successSteps),
        fallback_action: "stop",
        max_action_rate_per_second: 5,
        safety_profile: buildSafetyProfile(successSteps),
      },
      metrics: {
        success_rate: 1.0,
        avg_latency_ms: taskRun.duration_ms || 0,
        sample_count: 1,
      },
      policy: `基于成功执行轨迹编译的灰质技能卡。\n来源 task_run: ${task_run_id}\n环境画像: ${environment_profile_id}\n稳定步骤数: ${successSteps.length}\n动作序列: ${actionSequence.map((a: any) => a.action).join(" -> ")}`,
      status: "candidate",
      version: "1.0.0",
      task_id: task_id,
      environment_profile_id: environment_profile_id,
      compiled_from_task_run_id: task_run_id,
      user_id: user.id,
    };

    const { data: skillCard, error: cardError } = await supabaseService
      .from("skill_cards")
      .insert(compiledSkill)
      .select()
      .maybeSingle();

    if (cardError || !skillCard) {
      console.error("[Compile-Gray-Skill] Insert error:", cardError);
      return new Response(
        JSON.stringify({ error: cardError?.message || "Failed to insert skill card" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 更新 task 的 skill_card_id 为新编译的技能卡
    await supabaseService
      .from("tasks")
      .update({ skill_card_id: skillCard.id })
      .eq("id", task_id);

    // 写入 skill_history 初始版本记录
    const { error: historyError } = await supabaseService
      .from("skill_history")
      .insert({
        skill_card_id: skillCard.id,
        version: "1.0.0",
        changes_json: {
          source: "compile-gray-skill",
          task_run_id,
          environment_profile_id,
          action_sequence: actionSequence,
          selector_validation: { valid: true, count: successSteps.length },
        },
        tunable_params: compiledSkill.tunable_params,
        status: "candidate",
        notes: `从成功执行轨迹编译的初始版本。task_run: ${task_run_id}`,
        user_id: user.id,
      });

    if (historyError) {
      console.error("[Compile-Gray-Skill] Skill history insert error:", historyError);
    }

    // 写入 memory_episodes(技能编译记录)
    const { error: episodeError } = await supabaseService
      .from("memory_episodes")
      .insert({
        type: "skill_compilation",
        title: `技能编译: ${compiledSkill.name}`,
        content_json: {
          skill_card_id: skillCard.id,
          task_run_id,
          environment_profile_id,
          action_sequence: actionSequence,
          selector_validation: { valid: true, count: successSteps.length },
        },
        skill_card_id: skillCard.id,
        environment_profile_id: environment_profile_id,
        tags: ["compilation", "gray_skill", "auto-generated"],
        user_id: user.id,
      });

    if (episodeError) {
      console.error("[Compile-Gray-Skill] Memory episode insert error:", episodeError);
    } else {
      console.log("[Compile-Gray-Skill] Memory episode created for skill card:", skillCard.id);
    }

    console.log(`[Compile-Gray-Skill] Skill card created: ${skillCard.id}`);

    return new Response(
      JSON.stringify({
        data: {
          skill_card: skillCard,
          action_sequence: actionSequence,
          validation: {
            selectors_validated: successSteps.length,
            environment_profile_id,
            task_run_id,
          },
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("[Compile-Gray-Skill] Error:", error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
