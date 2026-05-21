// 白质层 AI 推理 Edge Function
// 接收失败任务的上下文，调用大模型进行根因分析，以 SSE 流形式返回结果
// 支持多模型路由（DeepSeek / Anthropic Claude / 通义千问 / OpenAI），无配置时回退到平台托管文心大模型
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type ModelProvider = "deepseek" | "anthropic" | "qwen" | "openai";

interface ModelConfig {
  provider: ModelProvider;
  api_key: string;
  is_active: boolean;
}

// 各提供商的 OpenAI 兼容 baseUrl 和模型名
const PROVIDER_CONFIG: Record<ModelProvider, { baseUrl: string; model: string }> = {
  deepseek: { baseUrl: "https://api.deepseek.com", model: "deepseek-chat" },
  qwen: { baseUrl: "https://dashscope.aliyuncs.com/compatible-mode", model: "qwen-plus" },
  openai: { baseUrl: "https://api.openai.com", model: "gpt-4o-mini" },
  anthropic: { baseUrl: "https://api.anthropic.com", model: "claude-3-5-haiku-20241022" },
};

// 平台托管文心大模型（兜底）
const PLATFORM_GATEWAY = "https://app-br1wyyyd6dq9-api-zYkZz8qovQ1L-gateway.appmiaoda.com/v2/chat/completions";

// ---- 调用 OpenAI 兼容接口（DeepSeek / Qwen / OpenAI）----
async function callOpenAICompatible(
  baseUrl: string,
  model: string,
  apiKey: string,
  messages: { role: string; content: string }[]
): Promise<Response> {
  return await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, messages, stream: true }),
  });
}

// ---- 调用 Anthropic Claude（非 OpenAI 格式）----
async function callAnthropic(
  apiKey: string,
  model: string,
  messages: { role: string; content: string }[]
): Promise<Response> {
  // 分离 system prompt 和 user messages（Anthropic 格式要求）
  const systemMsg = messages.find(m => m.role === "system");
  const userMessages = messages.filter(m => m.role !== "system");

  return await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      stream: true,
      system: systemMsg?.content ?? "",
      messages: userMessages.map(m => ({ role: m.role, content: m.content })),
    }),
  });
}

// ---- 将 Anthropic SSE 格式转换为 OpenAI SSE 格式（透传用）----
function createAnthropicToOpenAITransform(): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";

  return new TransformStream({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const raw = line.slice(6).trim();
        if (!raw) continue;

        try {
          const event = JSON.parse(raw);
          // Anthropic content_block_delta → OpenAI delta.content
          if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
            const openAIChunk = {
              choices: [{ delta: { content: event.delta.text }, index: 0, finish_reason: null }],
            };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(openAIChunk)}\n\n`));
          }
          // Anthropic message_stop → OpenAI [DONE]
          if (event.type === "message_stop") {
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          }
        } catch {
          // 忽略解析失败的帧
        }
      }
    },
  });
}

// 构建给大模型的系统提示词
function buildSystemPrompt(): string {
  return `你是一个网页自动化智能体的"白质层"推理引擎，专门负责失败任务的根本原因分析（Root Cause Analysis）与优化建议生成。

你的职责：
1. 根据任务失败信息进行深度推理，找出根本原因
2. 生成结构化的优化建议，帮助灰质层改进执行策略
3. 推断需要调整的技能卡参数（参数补丁）
4. 输出标准化 JSON 格式，供系统自动解析

**输出规则（必须严格遵守）：**
- 只输出一个 JSON 对象，不含任何 markdown 代码块符号（不加 \`\`\`json）
- JSON 字段必须完整，不得缺省
- suggestions 至少 2 条，最多 5 条
- param_patches 可为空数组 []
- confidence 为 0~1 的小数

**JSON 结构如下（直接输出，不含代码块）：**
{
  "root_cause": "失败的根本原因，1-3句话简洁说明",
  "failure_type": "element_not_found | timeout | assertion_failed | navigation_error | permission_denied | unknown",
  "affected_steps": [
    { "step_index": 0, "action": "步骤动作类型", "description": "该步骤失败的具体表现" }
  ],
  "suggestions": [
    {
      "priority": "high | medium | low",
      "action": "建议操作的一句话标题",
      "detail": "2-3句话详细说明该建议的实施方式和预期效果"
    }
  ],
  "param_patches": [
    {
      "param_name": "参数名（如 wait_timeout_ms）",
      "old_value": "当前值（修改前）",
      "suggested_value": "建议值",
      "reason": "调整原因"
    }
  ],
  "confidence": 0.85,
  "reasoning_summary": "3-5句话综合推理摘要，说明分析过程和最终判断"
}`;
}

// 构建用户提示词，包含任务上下文
function buildUserPrompt(payload: {
  task_name: string;
  target_url: string;
  steps: Array<{ action: string; selector?: string; value?: string }>;
  steps_result: Array<{
    step_index: number;
    action: string;
    status: string;
    duration_ms: number;
    error?: string;
    safety_risk_level?: string;
  }>;
  error_message?: string;
}): string {
  const stepsDesc = payload.steps
    .map((s, i) => `  步骤${i + 1}: ${s.action}${s.selector ? ` [${s.selector}]` : ""}${s.value ? ` = "${s.value}"` : ""}`)
    .join("\n");

  const resultsDesc = payload.steps_result
    .map(
      (r) =>
        `  步骤${r.step_index + 1} [${r.action}]: ${r.status === "success" ? "✓ 成功" : r.status === "skipped" ? "⏭ 跳过" : "✗ 失败"} (${r.duration_ms}ms)${r.error ? ` — 错误: ${r.error}` : ""}${r.safety_risk_level ? ` — 风险等级: ${r.safety_risk_level}` : ""}`
    )
    .join("\n");

  return `请对以下失败的网页自动化任务进行根因分析：

**任务信息**
- 任务名称: ${payload.task_name}
- 目标URL: ${payload.target_url}
- 总错误信息: ${payload.error_message || "未知错误"}

**配置的操作步骤**
${stepsDesc}

**实际执行结果**
${resultsDesc}

请基于以上信息，作为白质层推理引擎，输出标准化 JSON 分析结果。`;
}

Deno.serve(async (req: Request): Promise<Response> => {
  // 处理 CORS 预检
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });
  }

  try {
    // 1. 验证用户身份
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

    // 2. 解析请求体
    const body = await req.json();
    const { task_run_id, task_name, target_url, steps, error_message } = body;
    // skill_card_id 由前端从 task_run 读取后传入，用于需求 5（failure episode 绑定完整性）
    const skill_card_id: string | null = body.skill_card_id ?? null;

    if (!task_run_id || !task_name || !target_url) {
      return new Response(JSON.stringify({ error: "Missing required fields: task_run_id, task_name, target_url" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3. 查询执行轨迹 (Milestone 9 需求 5: 必须读取 task_run_steps)
    const supabaseService = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { data: stepTraces } = await supabaseService
      .from("task_run_steps")
      .select("*")
      .eq("task_run_id", task_run_id)
      .order("step_index", { ascending: true });

    const formattedStepsResult = (stepTraces || []).map((st) => ({
      step_index: st.step_index,
      action: st.action_type,
      status: st.status,
      duration_ms: st.duration_ms || 0,
      error: st.error_message || st.error_code,
      safety_risk_level: st.safety_risk_level
    }));

    const { data: modelConfigData } = await supabaseService
      .from("model_configs")
      .select("provider, api_key, is_active")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .maybeSingle();

    const activeModelConfig = modelConfigData as ModelConfig | null;

    // 4. 获取平台 API Key（兜底用）
    const platformApiKey = Deno.env.get("INTEGRATIONS_API_KEY");

    // 5. 构建 messages
    const messages = [
      { role: "system", content: buildSystemPrompt() },
      {
        role: "user",
        content: buildUserPrompt({ task_name, target_url, steps: steps || [], steps_result: formattedStepsResult, error_message }),
      },
    ];

    // 6. 根据激活模型路由调用
    let upstream: Response;

    if (activeModelConfig) {
      const provider = activeModelConfig.provider;
      console.log(`[白质层] 使用用户配置模型: ${provider}`);

      if (provider === "anthropic") {
        // Claude 使用独立 API 格式
        upstream = await callAnthropic(activeModelConfig.api_key, PROVIDER_CONFIG.anthropic.model, messages);
      } else {
        // DeepSeek / Qwen / OpenAI 均兼容 OpenAI 格式
        const cfg = PROVIDER_CONFIG[provider];
        upstream = await callOpenAICompatible(cfg.baseUrl, cfg.model, activeModelConfig.api_key, messages);
      }

      // 用户模型调用失败时回退到平台托管
      if (!upstream.ok) {
        const errText = await upstream.text();
        console.warn(`[白质层] 用户模型 ${provider} 调用失败 (${upstream.status}): ${errText}，回退到平台托管文心大模型`);
        if (!platformApiKey) {
          return new Response(JSON.stringify({ error: `模型调用失败: ${upstream.status}，且平台兜底模型不可用` }), {
            status: 502,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        upstream = await fetch(PLATFORM_GATEWAY, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Gateway-Authorization": `Bearer ${platformApiKey}`,
          },
          body: JSON.stringify({ messages, enable_thinking: false }),
        });
      }
    } else {
      // 无激活模型 → 使用平台托管文心大模型
      console.log("[白质层] 使用平台托管文心大模型（兜底）");
      if (!platformApiKey) {
        return new Response(JSON.stringify({ error: "Server config error: missing API key" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      upstream = await fetch(PLATFORM_GATEWAY, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Gateway-Authorization": `Bearer ${platformApiKey}`,
        },
        body: JSON.stringify({ messages, enable_thinking: false }),
      });
    }

    if (upstream.status === 429 || upstream.status === 402) {
      const errText = await upstream.text();
      return new Response(errText, {
        status: upstream.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!upstream.ok || !upstream.body) {
      return new Response(JSON.stringify({ error: `Upstream error: ${upstream.status}` }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 7. 透传 SSE 流，同时在流结束后将完整结果存入数据库
    // Anthropic 格式需要先做转换，其他格式直接透传
    let fullContent = "";
    const decoder = new TextDecoder();

    const contentAccumulator = new TransformStream({
      transform(chunk, controller) {
        const text = decoder.decode(chunk, { stream: true });
        const lines = text.split("\n");
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (raw === "[DONE]") continue;
          try {
            const parsed = JSON.parse(raw);
            const delta = parsed.choices?.[0]?.delta?.content ?? "";
            fullContent += delta;
          } catch {
            // 忽略解析失败的帧
          }
        }
        controller.enqueue(chunk);
      },
      async flush() {
        try {
          const cleaned = fullContent
            .replace(/^```json\s*/i, "")
            .replace(/^```\s*/i, "")
            .replace(/\s*```\s*$/i, "")
            .trim();

          const analysis = JSON.parse(cleaned);

          await supabaseService
            .from("task_runs")
            .update({ analysis, suggestions: analysis.suggestions ?? [] })
            .eq("id", task_run_id)
            .eq("user_id", user.id);

          await supabaseService.from("memory_episodes").insert({
            type: "failure",
            title: `[白质分析] ${task_name} — ${analysis.failure_type ?? "unknown"}`,
            content_json: {
              task_run_id,
              root_cause: analysis.root_cause,
              failure_type: analysis.failure_type,
              affected_steps: analysis.affected_steps,
              suggestions: analysis.suggestions,
              param_patches: analysis.param_patches,
              confidence: analysis.confidence,
              reasoning_summary: analysis.reasoning_summary,
            },
            task_id: body.task_id ?? null,
            task_run_id,
            // 需求 5：failure episode 必须记录 skill_card_id
            skill_card_id: skill_card_id,
            tags: ["white_matter", "failure_analysis", analysis.failure_type ?? "unknown"],
            user_id: user.id,
          });
        } catch (e) {
          console.error("白质层保存分析结果失败:", e, "rawContent:", fullContent.slice(0, 200));
        }
      },
    });

    // Anthropic 流需先转换为 OpenAI 格式，再接内容累积器
    const isAnthropic = activeModelConfig?.provider === "anthropic";
    let readable: ReadableStream<Uint8Array>;

    if (isAnthropic) {
      const anthropicTransform = createAnthropicToOpenAITransform();
      upstream.body!.pipeThrough(anthropicTransform).pipeTo(contentAccumulator.writable);
      readable = contentAccumulator.readable;
    } else {
      upstream.body!.pipeTo(contentAccumulator.writable);
      readable = contentAccumulator.readable;
    }

    return new Response(readable, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    console.error("白质层推理错误:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
