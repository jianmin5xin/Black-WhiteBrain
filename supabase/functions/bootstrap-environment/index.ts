import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * 白质层 Bootstrap Environment — 负责复杂推理 + 验证 + 写库
 *
 * 输入: raw_scan_id
 * 输出: environment_profile + memory_episode
 *
 * 三阶段流水线：
 * 1. 推理：从 RawEnvironmentScan 生成 environment_profile 草案
 * 2. 验证：EnvironmentProfileValidator 校验所有字段
 * 3. 写库：验证通过后写入 environment_profiles + memory_episodes
 */

// ─── Selector 生成优先级 ─────────────────────────────────
type SelectorCandidate = { selector: string; strategy: string; score: number };

function buildSelectorCandidates(el: any): SelectorCandidate[] {
  const candidates: SelectorCandidate[] = [];

  // 1. data-testid / data-test / data-cy
  if (el["data-testid"]) {
    candidates.push({ selector: `[data-testid="${el["data-testid"]}"]`, strategy: "data-testid", score: 100 });
  }
  if (el["data-test"]) {
    candidates.push({ selector: `[data-test="${el["data-test"]}"]`, strategy: "data-test", score: 95 });
  }
  if (el["data-cy"]) {
    candidates.push({ selector: `[data-cy="${el["data-cy"]}"]`, strategy: "data-cy", score: 95 });
  }

  // 2. aria-label
  if (el["aria-label"]) {
    candidates.push({ selector: `[aria-label="${el["aria-label"]}"]`, strategy: "aria-label", score: 90 });
  }

  // 3. role + accessible name
  if (el.role && el.title) {
    candidates.push({ selector: `[role="${el.role}"][title="${el.title}"]`, strategy: "role+title", score: 85 });
  }

  // 4. label 对应 input (简化：用 id 推断)
  if (el.id) {
    candidates.push({ selector: `#${el.id}`, strategy: "id", score: 80 });
  }

  // 5. name
  if (el.name) {
    candidates.push({ selector: `${el.tag}[name="${el.name}"]`, strategy: "name", score: 75 });
  }

  // 6. placeholder
  if (el.placeholder) {
    candidates.push({ selector: `[placeholder="${el.placeholder}"]`, strategy: "placeholder", score: 70 });
  }

  // 7. text
  if (el.text && el.text.length > 0 && el.text.length < 50) {
    candidates.push({ selector: `text="${el.text}"`, strategy: "text", score: 60 });
  }

  // 8. CSS fallback
  if (el.class) {
    const classes = el.class
      .split(/\s+/)
      .filter((c: string) => c && !c.includes('hover') && !c.includes('active'))
      .join('.');
    if (classes) {
      candidates.push({ selector: `${el.tag}.${classes}`, strategy: "css-class", score: 40 });
    }
  }

  // 9. tag fallback
  candidates.push({ selector: el.tag, strategy: "tag", score: 10 });

  // 排序：分数高的在前
  return candidates.sort((a, b) => b.score - a.score);
}

function pickBestSelector(candidates: SelectorCandidate[]): { selector: string; stable_score: number } {
  if (candidates.length === 0) return { selector: "", stable_score: 0 };
  return {
    selector: candidates[0].selector,
    stable_score: candidates[0].score,
  };
}

// ─── Risk Level 推断 ─────────────────────────────────
function inferRiskLevel(el: any): string {
  const text = (el.text || el["aria-label"] || el.placeholder || "").toLowerCase();

  // forbidden/high: 敏感操作
  if (
    /(删除|移除|delete|remove|pay|purchase|transfer|authorize|修改密码|支付|购买|转账|授权|清空|clear|drop|destroy|trash)/.test(text)
  ) {
    return "high";
  }

  // medium: 状态变更操作
  if (
    /(submit|login|send|save|update|confirm|apply|登录|发送|提交|保存|更新|确认)/.test(text)
  ) {
    return "medium";
  }

  return "low";
}

// ─── Action Candidates 推断 ─────────────────────────────────
function inferActionCandidates(el: any): string[] {
  const tag = el.tag;
  const type = el.type;

  if (tag === "button" || tag === "a") return ["click", "hover"];
  if (tag === "input" && type !== "submit" && type !== "button") {
    return ["fill", "click", "focus", "clear"];
  }
  if (tag === "textarea") return ["fill", "click", "focus", "clear"];
  if (tag === "select") return ["select", "click", "focus"];
  if (tag === "form") return ["submit"];
  return ["click"];
}

// ─── 语义角色推断 ─────────────────────────────────
function inferSemanticRole(el: any): string {
  const tag = el.tag;
  const type = el.type;
  const text = (el.text || "").toLowerCase();

  if (tag === "input") {
    if (type === "password") return "password_input";
    if (type === "email") return "email_input";
    if (type === "search") return "search_input";
    if (type === "checkbox") return "checkbox";
    if (type === "radio") return "radio";
    if (type === "file") return "file_input";
    if (type === "submit" || type === "button") return "submit_button";
    return "text_input";
  }
  if (tag === "textarea") return "text_area";
  if (tag === "select") return "dropdown";
  if (tag === "button") {
    if (text.includes("submit") || text.includes("提交")) return "submit_button";
    if (text.includes("login") || text.includes("登录")) return "login_button";
    if (text.includes("save") || text.includes("保存")) return "save_button";
    if (text.includes("delete") || text.includes("删除")) return "delete_button";
    if (text.includes("cancel") || text.includes("取消")) return "cancel_button";
    return "action_button";
  }
  if (tag === "a") return "link";
  if (tag === "form") return "form_container";
  if (tag === "dialog") return "modal";
  return "generic_element";
}

// ─── Surfaces 判断 ─────────────────────────────────
function deriveSurfaces(rawElements: any[]) {
  const hasInput = rawElements.some(e => e.tag === "input" || e.tag === "textarea");
  const hasButton = rawElements.some(e => e.tag === "button" || e.tag === "a");
  const hasSelect = rawElements.some(e => e.tag === "select");
  const hasForm = rawElements.some(e => e.tag === "form");
  const hasDialog = rawElements.some(e => e.tag === "dialog" || e.role === "dialog");

  const perception_surfaces = ["dom", "url", "title", "visible_text"];
  const execution_surfaces = ["wait", "screenshot", "navigate", "press_key"];
  const feedback_surfaces = ["url_change", "dom_change", "network_idle"];

  if (hasInput || hasSelect) {
    perception_surfaces.push("form_fields");
    execution_surfaces.push("fill");
    feedback_surfaces.push("validation_error");
  }
  if (hasButton) {
    perception_surfaces.push("button_labels", "link_texts");
    execution_surfaces.push("click");
    feedback_surfaces.push("element_visible", "element_hidden");
  }
  if (hasSelect) {
    execution_surfaces.push("select");
  }
  if (hasDialog) {
    perception_surfaces.push("modal_content");
    feedback_surfaces.push("toast_or_alert");
  }

  // 去重
  return {
    perception_surfaces: [...new Set(perception_surfaces)],
    execution_surfaces: [...new Set(execution_surfaces)],
    feedback_surfaces: [...new Set(feedback_surfaces)],
  };
}

// ─── Adapters 推荐 ─────────────────────────────────
function recommendAdapters(surfaces: {
  perception_surfaces: string[];
  execution_surfaces: string[];
  feedback_surfaces: string[];
}): string[] {
  const adapters = new Set<string>(["dom_reader"]);

  if (surfaces.execution_surfaces.includes("click")) adapters.add("click_adapter");
  if (surfaces.execution_surfaces.includes("fill")) adapters.add("fill_adapter");
  if (surfaces.execution_surfaces.includes("select")) adapters.add("select_adapter");
  if (surfaces.execution_surfaces.includes("wait")) adapters.add("wait_adapter");
  if (surfaces.execution_surfaces.includes("screenshot")) adapters.add("screenshot_adapter");
  if (surfaces.feedback_surfaces.length > 0) adapters.add("feedback_observer");

  return [...adapters];
}

// ─── 主推理函数 ─────────────────────────────────
function buildProfileDraft(rawScan: any) {
  const rawElements = rawScan.raw_elements || [];

  // 生成带语义角色的 elements
  const elements = rawElements.map((el: any) => {
    const candidates = buildSelectorCandidates(el);
    const best = pickBestSelector(candidates);

    return {
      tag: el.tag,
      semantic_role: inferSemanticRole(el),
      text: el.text,
      attributes: {
        role: el.role,
        name: el.name,
        placeholder: el.placeholder,
        type: el.type,
        href: el.href,
        "aria-label": el["aria-label"],
        "data-testid": el["data-testid"],
        id: el.id,
      },
      selector: best.selector,
      selector_candidates: candidates.map(c => ({
        selector: c.selector,
        strategy: c.strategy,
        score: c.score,
      })),
      stable_selector_score: best.stable_score,
      action_candidates: inferActionCandidates(el),
      risk_level: inferRiskLevel(el),
      rect: el.rect,
    };
  });

  const surfaces = deriveSurfaces(rawElements);
  const adapters = recommendAdapters(surfaces);

  // 判断缺失能力
  const missing = new Set<string>();
  if (rawElements.some((e: any) => e.tag === "img" || e.tag === "canvas")) {
    missing.add("visual_recognition");
  }
  if (rawElements.some((e: any) => e.tag === "input" && e.type === "file")) {
    missing.add("file_upload");
  }
  // 验证码检测是一个动态过程，默认标记
  missing.add("captcha_solving");

  return {
    url: rawScan.url,
    environment_type: "web_automation",
    perception_surfaces: surfaces.perception_surfaces,
    execution_surfaces: surfaces.execution_surfaces,
    feedback_surfaces: surfaces.feedback_surfaces,
    recommended_adapters: adapters,
    missing_capabilities: [...missing],
    elements,
    raw_scan_id: rawScan.id,
  };
}

// ─── EnvironmentProfileValidator ─────────────────────────────────

/** 系统支持的 action 列表 */
const ALLOWED_ACTIONS = new Set([
  "click", "hover", "fill", "focus", "clear", "select", "submit",
  "wait", "screenshot", "navigate", "press_key",
]);

/** 允许的 adapter 列表 */
const ALLOWED_ADAPTERS = new Set([
  "dom_reader", "click_adapter", "fill_adapter", "select_adapter",
  "wait_adapter", "screenshot_adapter", "feedback_observer",
]);

/** 允许的 risk_level 枚举 */
const ALLOWED_RISK_LEVELS = new Set(["low", "medium", "high", "forbidden"]);

interface ValidationError {
  field: string;
  message: string;
}

function validateProfileDraft(draft: any, rawScan: any): ValidationError[] {
  const errors: ValidationError[] = [];

  // V1: 校验 perception_surfaces 不为空
  if (!draft.perception_surfaces || draft.perception_surfaces.length === 0) {
    errors.push({ field: "perception_surfaces", message: "perception_surfaces 不能为空" });
  }

  // V2: 校验 execution_surfaces 不为空
  if (!draft.execution_surfaces || draft.execution_surfaces.length === 0) {
    errors.push({ field: "execution_surfaces", message: "execution_surfaces 不能为空" });
  }

  // V3: 校验 feedback_surfaces 不为空
  if (!draft.feedback_surfaces || draft.feedback_surfaces.length === 0) {
    errors.push({ field: "feedback_surfaces", message: "feedback_surfaces 不能为空" });
  }

  // V4: 校验 adapters 是否在允许列表中
  for (const adapter of draft.recommended_adapters || []) {
    if (!ALLOWED_ADAPTERS.has(adapter)) {
      errors.push({ field: "recommended_adapters", message: `不允许的 adapter: ${adapter}` });
    }
  }

  // V5: 校验每个 element 的字段
  const rawElementSet = new Set((rawScan.raw_elements || []).map((e: any) => e.tag));
  for (let i = 0; i < (draft.elements || []).length; i++) {
    const el = draft.elements[i];

    // V5a: selector 必须存在于 selector_candidates 中
    if (el.selector && el.selector_candidates) {
      const candidateSelectors = el.selector_candidates.map((c: any) => c.selector);
      if (!candidateSelectors.includes(el.selector)) {
        errors.push({
          field: `elements[${i}].selector`,
          message: `selector "${el.selector}" 不在 selector_candidates 中`,
        });
      }
    }

    // V5b: action_candidates 必须被系统支持
    for (const action of el.action_candidates || []) {
      if (!ALLOWED_ACTIONS.has(action)) {
        errors.push({
          field: `elements[${i}].action_candidates`,
          message: `不支持的 action: ${action}`,
        });
      }
    }

    // V5c: risk_level 必须符合枚举
    if (!ALLOWED_RISK_LEVELS.has(el.risk_level)) {
      errors.push({
        field: `elements[${i}].risk_level`,
        message: `无效的 risk_level: ${el.risk_level}，允许值: low, medium, high, forbidden`,
      });
    }

    // V5d: 元素的 tag 必须存在于原始扫描中
    if (el.tag && !rawElementSet.has(el.tag)) {
      errors.push({
        field: `elements[${i}].tag`,
        message: `tag "${el.tag}" 不存在于原始扫描结果中`,
      });
    }
  }

  // V6: 校验 URL 非空
  if (!draft.url || draft.url.trim().length === 0) {
    errors.push({ field: "url", message: "url 不能为空" });
  }

  // V7: 校验 environment_type
  if (!draft.environment_type) {
    errors.push({ field: "environment_type", message: "environment_type 不能为空" });
  }

  return errors;
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

    const body = await req.json();
    const rawScanId = body.raw_scan_id;

    if (!rawScanId) {
      return new Response(JSON.stringify({ error: "raw_scan_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[Bootstrap-Environment] Processing raw_scan_id: ${rawScanId}`);

    // 读取原始扫描记录
    const { data: rawScan, error: fetchError } = await supabase
      .from("raw_environment_scans")
      .select("*")
      .eq("id", rawScanId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (fetchError || !rawScan) {
      return new Response(
        JSON.stringify({ error: fetchError?.message || "Raw scan not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Phase 2: 执行推理
    const profileDraft = buildProfileDraft(rawScan);

    // Phase 3: 验证
    const validationErrors = validateProfileDraft(profileDraft, rawScan);
    if (validationErrors.length > 0) {
      console.error("[Bootstrap-Environment] Validation failed:", validationErrors);
      return new Response(
        JSON.stringify({
          error: "EnvironmentProfile validation failed",
          validation_errors: validationErrors,
          draft: profileDraft,
        }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("[Bootstrap-Environment] Validation passed, saving profile...");

    // 存入 environment_profiles
    const supabaseService = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { data: profile, error: insertError } = await supabaseService
      .from("environment_profiles")
      .insert({
        url: profileDraft.url,
        environment_type: profileDraft.environment_type,
        perception_surfaces: profileDraft.perception_surfaces,
        execution_surfaces: profileDraft.execution_surfaces,
        feedback_surfaces: profileDraft.feedback_surfaces,
        recommended_adapters: profileDraft.recommended_adapters,
        missing_capabilities: profileDraft.missing_capabilities,
        elements: profileDraft.elements,
        raw_scan_id: rawScanId,
        raw_profile: { source: "bootstrap-environment", raw_scan_id: rawScanId },
        scan_status: "success",
        user_id: user.id,
      })
      .select()
      .maybeSingle();

    if (insertError || !profile) {
      console.error("[Bootstrap-Environment] Insert error:", insertError);
      return new Response(JSON.stringify({ error: insertError?.message || "Insert failed" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 生成白质层推理摘要
    const whiteMatterSummary = {
      url: profileDraft.url,
      element_count: profileDraft.elements.length,
      perception_surfaces: profileDraft.perception_surfaces,
      execution_surfaces: profileDraft.execution_surfaces,
      feedback_surfaces: profileDraft.feedback_surfaces,
      recommended_adapters: profileDraft.recommended_adapters,
      missing_capabilities: profileDraft.missing_capabilities,
      high_risk_elements: profileDraft.elements.filter((e: any) => e.risk_level === "high").length,
      medium_risk_elements: profileDraft.elements.filter((e: any) => e.risk_level === "medium").length,
    };

    // 写入 memory_episodes（环境自举记录）
    const { error: episodeError } = await supabaseService
      .from("memory_episodes")
      .insert({
        type: "environment_bootstrap",
        title: `环境自举: ${profileDraft.url}`,
        content_json: {
          raw_scan_id: rawScanId,
          environment_profile_id: profile.id,
          white_matter_summary: whiteMatterSummary,
        },
        environment_profile_id: profile.id,
        tags: ["bootstrap", "environment", "auto-generated"],
        user_id: user.id,
      });

    if (episodeError) {
      console.error("[Bootstrap-Environment] Episode insert error:", episodeError);
      // episode 写入失败不影响主流程，只打日志
    } else {
      console.log("[Bootstrap-Environment] Memory episode created:", profile.id);
    }

    return new Response(
      JSON.stringify({
        data: {
          profile,
          draft: profileDraft,
          validation: { passed: true, checked: validationErrors.length + " rules" },
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("[Bootstrap-Environment] Error:", error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
