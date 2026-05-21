// 模型连接测试 Edge Function
// 用极简 prompt 测试用户提供的 API Key 是否可用，避免直接在前端暴露 Key
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type ModelProvider = "deepseek" | "anthropic" | "qwen" | "openai";

const PROVIDER_CONFIG: Record<ModelProvider, { baseUrl: string; model: string }> = {
  deepseek: { baseUrl: "https://api.deepseek.com", model: "deepseek-chat" },
  qwen: { baseUrl: "https://dashscope.aliyuncs.com/compatible-mode", model: "qwen-turbo" },
  openai: { baseUrl: "https://api.openai.com", model: "gpt-4o-mini" },
  anthropic: { baseUrl: "https://api.anthropic.com", model: "claude-3-haiku-20240307" },
};

// 极简测试 prompt，最小化 token 消耗
const TEST_MESSAGES = [{ role: "user", content: "Reply with the single word: OK" }];

// OpenAI 兼容格式（DeepSeek / Qwen / OpenAI）
async function testOpenAICompatible(baseUrl: string, model: string, apiKey: string): Promise<void> {
  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: TEST_MESSAGES,
      max_tokens: 5,
      stream: false,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    // 401/403 → Key 无效；429 → Key 有效但限流（视为成功）
    if (res.status === 429) return;
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
}

// Anthropic 独立格式
async function testAnthropic(apiKey: string, model: string): Promise<void> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 5,
      messages: TEST_MESSAGES,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    if (res.status === 429) return;
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
}

// 将原始错误信息转换为用户友好提示
function friendlyError(provider: ModelProvider, raw: string): string {
  const lower = raw.toLowerCase();
  if (lower.includes("401") || lower.includes("unauthorized") || lower.includes("invalid api key") || lower.includes("authentication")) {
    return "API Key 无效或已过期，请检查后重新填写";
  }
  if (lower.includes("403") || lower.includes("forbidden")) {
    return "API Key 权限不足，请确认已开通对应模型权限";
  }
  if (lower.includes("404") || lower.includes("not found")) {
    return "模型不存在，请确认账号已开通该模型访问权限";
  }
  if (lower.includes("insufficient_quota") || lower.includes("quota") || lower.includes("balance")) {
    return "账号余额不足，请充值后重试";
  }
  if (lower.includes("network") || lower.includes("fetch") || lower.includes("econnrefused")) {
    return "网络连接失败，请检查网络后重试";
  }
  return `连接失败：${raw.slice(0, 120)}`;
}

Deno.serve(async (req: Request): Promise<Response> => {
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
      return new Response(JSON.stringify({ success: false, message: "未授权" }), {
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
      return new Response(JSON.stringify({ success: false, message: "未登录或会话已过期" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. 解析请求体
    const { provider, api_key } = await req.json() as { provider: ModelProvider; api_key: string };

    if (!provider || !api_key) {
      return new Response(JSON.stringify({ success: false, message: "缺少 provider 或 api_key 参数" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!PROVIDER_CONFIG[provider]) {
      return new Response(JSON.stringify({ success: false, message: `不支持的模型提供商: ${provider}` }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3. 执行连接测试（限时 10 秒）
    const cfg = PROVIDER_CONFIG[provider];
    const testPromise = provider === "anthropic"
      ? testAnthropic(api_key, cfg.model)
      : testOpenAICompatible(cfg.baseUrl, cfg.model, api_key);

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("连接超时（10s），请检查网络或重试")), 10000)
    );

    await Promise.race([testPromise, timeoutPromise]);

    return new Response(
      JSON.stringify({ success: true, message: `${provider} 连接成功，API Key 有效` }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    const raw = (err as Error).message ?? String(err);
    const provider = (() => {
      try {
        return (JSON.parse(new URL(req.url).searchParams.get("provider") ?? "")).provider;
      } catch { return ""; }
    })();
    const message = friendlyError(provider as ModelProvider, raw);
    console.error(`[test-model-connection] 测试失败:`, raw);
    return new Response(
      JSON.stringify({ success: false, message }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
