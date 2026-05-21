import { createClient } from "npm:@supabase/supabase-js@2";
import { chromium } from "npm:playwright-core";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

export interface ExtractResult {
  perception_surfaces: {
    url: string;
    title: string;
    dom: string;
    visible_text: string;
    screenshot: string | null;
    console_errors: string[];
  };
  execution_surfaces: Array<{
    type: string;
    target_selector: string;
    action_candidates: string[];
    risk_level: string;
    stable_selector_score: number;
    element_info: Record<string, string | null>;
  }>;
}

// 这是将注入到页面内的脚本，用于 DOM 扫描、信息提取、Selector 生成及打分
function extractDomInfo() {
  const elements = Array.from(document.querySelectorAll('button, input, textarea, select, a, form, dialog, [role="dialog"], [role="alert"], .modal, .alert'));
  
  const results: any[] = [];
  
  function getElementSelector(el: Element): string {
    if (el.getAttribute('data-testid')) return `[data-testid="${el.getAttribute('data-testid')}"]`;
    if (el.getAttribute('data-test')) return `[data-test="${el.getAttribute('data-test')}"]`;
    if (el.id) return `#${el.id}`;
    if (el.getAttribute('name')) return `${el.tagName.toLowerCase()}[name="${el.getAttribute('name')}"]`;
    
    // 生成基于 class 和结构的备选
    const classes = Array.from(el.classList).filter(c => !c.includes('hover') && !c.includes('active')).join('.');
    if (classes) return `${el.tagName.toLowerCase()}.${classes}`;
    
    return el.tagName.toLowerCase();
  }

  function calculateStableScore(el: Element): number {
    let score = 50; // 基础分
    if (el.getAttribute('data-testid') || el.getAttribute('data-test')) score += 50;
    if (el.id) score += 40;
    if (el.getAttribute('name')) score += 30;
    if (el.getAttribute('aria-label')) score += 20;
    
    const classes = el.getAttribute('class') || '';
    // 如果类名看起来像 hash 生成的（例如 css-1234abcd），扣分
    if (/[a-zA-Z0-9]{6,}/.test(classes) && classes.includes('-')) score -= 20;
    
    return Math.min(Math.max(score, 0), 100);
  }

  function inferRiskLevel(el: Element): string {
    const text = (el.textContent || el.getAttribute('value') || el.getAttribute('aria-label') || '').toLowerCase();
    const isDestructive = /(delete|remove|clear|drop|destroy|trash|pay|checkout)/.test(text);
    const isStateChange = /(submit|save|update|confirm|apply|send)/.test(text);
    
    if (isDestructive) return 'high';
    if (isStateChange) return 'medium';
    return 'low';
  }

  function inferActionCandidates(el: Element): string[] {
    const tag = el.tagName.toLowerCase();
    const type = el.getAttribute('type');
    
    if (tag === 'button' || tag === 'a') return ['click', 'hover'];
    if (tag === 'input' && type !== 'submit' && type !== 'button') return ['fill', 'click', 'focus', 'clear'];
    if (tag === 'textarea') return ['fill', 'click', 'focus', 'clear'];
    if (tag === 'select') return ['select', 'click', 'focus'];
    if (tag === 'form') return ['submit'];
    
    return ['click'];
  }

  for (const el of elements) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue; // 忽略不可见元素

    const info = {
      tag: el.tagName.toLowerCase(),
      text: (el.textContent || '').trim().slice(0, 100),
      role: el.getAttribute('role'),
      name: el.getAttribute('name'),
      placeholder: el.getAttribute('placeholder'),
      type: el.getAttribute('type'),
      href: el.getAttribute('href'),
      'aria-label': el.getAttribute('aria-label'),
      'data-testid': el.getAttribute('data-testid')
    };

    results.push({
      target_selector: getElementSelector(el),
      stable_selector_score: calculateStableScore(el),
      action_candidates: inferActionCandidates(el),
      risk_level: inferRiskLevel(el),
      element_info: info,
      type: inferActionCandidates(el)[0] || 'click' // 默认为最可能的候选动作
    });
  }
  
  return {
    dom: document.documentElement.outerHTML.slice(0, 50000), // 截断防止 payload 过大
    visible_text: document.body.innerText.slice(0, 10000),
    execution_surfaces: results
  };
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

    const { target_url } = await req.json();
    if (!target_url) {
      return new Response(JSON.stringify({ error: "target_url is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Bootstrapping env for URL: ${target_url}`);

    let result: ExtractResult;

    // 获取 Browserless Token 或尝试本地 fallback（Deno Deploy 一般无法运行真实的本地 chromium）
    const browserlessToken = Deno.env.get("BROWSERLESS_API_KEY");
    
    if (browserlessToken) {
      console.log("Using Browserless CDP connection...");
      const browser = await chromium.connectOverCDP(`wss://chrome.browserless.io?token=${browserlessToken}`);
      const page = await browser.newPage();
      
      const consoleErrors: string[] = [];
      page.on('console', msg => {
        if (msg.type() === 'error') {
          consoleErrors.push(msg.text());
        }
      });
      page.on('pageerror', err => {
        consoleErrors.push(err.message);
      });

      // 使用合理的超时和 networkidle
      await page.goto(target_url, { waitUntil: 'networkidle', timeout: 30000 }).catch(e => {
        console.warn(`Timeout or error during goto: ${e.message}`);
      });

      const title = await page.title();
      
      // 截屏 (较小尺寸和压缩率以防载荷过大)
      const screenshotBuffer = await page.screenshot({ type: 'jpeg', quality: 50 });
      const screenshotBase64 = `data:image/jpeg;base64,${screenshotBuffer.toString('base64')}`;

      // 在页面内执行解析脚本
      const extracted = await page.evaluate(extractDomInfo);
      
      await browser.close();

      result = {
        perception_surfaces: {
          url: target_url,
          title,
          dom: extracted.dom,
          visible_text: extracted.visible_text,
          screenshot: screenshotBase64,
          console_errors: consoleErrors
        },
        execution_surfaces: extracted.execution_surfaces
      };
    } else {
      // 模拟退级方案（当缺少 browserless 凭证时的简单请求方案）
      // 这虽然不包含 playwright 的完全动态能力，但在无凭证的测试中起退级作用
      console.log("Browserless token not found, using simple fetch fallback...");
      const res = await fetch(target_url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
      });
      const html = await res.text();
      
      // 模拟一些简单的信息
      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      const title = titleMatch ? titleMatch[1] : target_url;
      
      // 使用正则表达式简单提取一些按钮和链接作演示
      const execution_surfaces = [];
      const btnRegex = /<button[^>]*>([^<]*)<\/button>/gi;
      let match;
      while ((match = btnRegex.exec(html)) !== null) {
        if (execution_surfaces.length >= 20) break;
        execution_surfaces.push({
          type: "click",
          target_selector: "button",
          action_candidates: ["click"],
          risk_level: "low",
          stable_selector_score: 50,
          element_info: { role: "button", text: match[1].slice(0, 50).trim() }
        });
      }

      result = {
        perception_surfaces: {
          url: target_url,
          title,
          dom: html.slice(0, 50000),
          visible_text: html.replace(/<[^>]+>/g, ' ').slice(0, 10000),
          screenshot: null,
          console_errors: []
        },
        execution_surfaces
      };
    }

    // 存入 environment_profiles
    const supabaseService = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { data: profile, error: insertError } = await supabaseService.from('environment_profiles').insert({
      target_url: target_url,
      environment_type: 'web_automation',
      perception_surfaces: ['dom', 'url', 'title', 'visible_text', 'screenshot', 'console_errors'],
      execution_surfaces: ['click', 'fill', 'select', 'wait', 'screenshot', 'press_key', 'navigate'],
      feedback_surfaces: ['url_change', 'dom_change', 'element_visible', 'element_hidden', 'validation_error', 'toast_or_alert', 'network_idle'],
      recommended_adapters: ['dom_reader', 'click_adapter', 'fill_adapter', 'select_adapter', 'wait_adapter', 'screenshot_adapter', 'feedback_observer'],
      missing_capabilities: ['visual_recognition', 'captcha_solving', 'file_upload'],
      raw_profile: result,
      user_id: user.id
    }).select().maybeSingle();

    if (insertError) {
      console.error("Insert error:", insertError);
      return new Response(JSON.stringify({ error: insertError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ data: profile }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("Bootstrap error:", error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});