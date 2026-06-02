import { createClient } from "npm:@supabase/supabase-js@2";
import { chromium } from "npm:playwright-core";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * 最小 Bootloader — 只负责采集事实，不负责复杂推理
 * 
 * 输入: target_url
 * 输出: RawEnvironmentScan 存入 raw_environment_scans 表
 * 
 * 不生成：selector、risk_level、surfaces、adapters 等任何推理字段
 */

interface RawElement {
  tag: string;
  text: string | null;
  role: string | null;
  name: string | null;
  placeholder: string | null;
  type: string | null;
  href: string | null;
  "aria-label": string | null;
  "data-testid": string | null;
  "data-test": string | null;
  "data-cy": string | null;
  id: string | null;
  class: string | null;
  title: string | null;
  // 元素在页面中的位置（用于后续编排与排序）
  rect: { x: number; y: number; width: number; height: number };
}

interface RawScanResult {
  url: string;
  title: string;
  dom: string;
  visible_text: string;
  screenshot: string | null;
  console_errors: string[];
  raw_elements: RawElement[];
  scan_duration_ms: number;
}

/**
 * 注入页面的最小扫描脚本 — 只采集原始属性
 */
function extractRawElements() {
  const targetSelectors = 'button, input, textarea, select, a, form, dialog, [role="dialog"], [role="alert"], .modal, .alert';
  const elements = Array.from(document.querySelectorAll(targetSelectors));

  const results: RawElement[] = [];

  for (const el of elements) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue; // 忽略不可见元素

    results.push({
      tag: el.tagName.toLowerCase(),
      text: (el.textContent || '').trim().slice(0, 200) || null,
      role: el.getAttribute('role') || null,
      name: el.getAttribute('name') || null,
      placeholder: el.getAttribute('placeholder') || null,
      type: el.getAttribute('type') || null,
      href: el.getAttribute('href') || null,
      "aria-label": el.getAttribute('aria-label') || null,
      "data-testid": el.getAttribute('data-testid') || null,
      "data-test": el.getAttribute('data-test') || null,
      "data-cy": el.getAttribute('data-cy') || null,
      id: el.id || null,
      class: el.getAttribute('class') || null,
      title: el.getAttribute('title') || null,
      rect: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
    });
  }

  return {
    dom: document.documentElement.outerHTML.slice(0, 50000),
    visible_text: document.body.innerText.slice(0, 10000),
    raw_elements: results,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });
  }

  const startTime = Date.now();

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

    console.log(`[Bootloader] Scanning URL: ${target_url}`);

    let rawScan: RawScanResult;
    const browserlessToken = Deno.env.get("BROWSERLESS_API_KEY");

    if (browserlessToken) {
      console.log("[Bootloader] Using Browserless CDP...");
      const browser = await chromium.connectOverCDP(`wss://chrome.browserless.io?token=${browserlessToken}`);
      const page = await browser.newPage();

      const consoleErrors: string[] = [];
      page.on('console', msg => {
        if (msg.type() === 'error') consoleErrors.push(msg.text());
      });
      page.on('pageerror', err => consoleErrors.push(err.message));

      await page.goto(target_url, { waitUntil: 'networkidle', timeout: 30000 }).catch(e => {
        console.warn(`[Bootloader] goto warning: ${e.message}`);
      });

      const title = await page.title();
      const screenshotBuffer = await page.screenshot({ type: 'jpeg', quality: 50 });
      const screenshotBase64 = `data:image/jpeg;base64,${screenshotBuffer.toString('base64')}`;

      const extracted = await page.evaluate(extractRawElements);
      await browser.close();

      rawScan = {
        url: target_url,
        title,
        dom: extracted.dom,
        visible_text: extracted.visible_text,
        screenshot: screenshotBase64,
        console_errors: consoleErrors,
        raw_elements: extracted.raw_elements,
        scan_duration_ms: Date.now() - startTime,
      };
    } else {
      // Fallback: 简单 fetch 模式（无浏览器环境）
      console.log("[Bootloader] Browserless token not found, using fetch fallback...");
      const res = await fetch(target_url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
      });
      const html = await res.text();
      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);

      rawScan = {
        url: target_url,
        title: titleMatch ? titleMatch[1] : target_url,
        dom: html.slice(0, 50000),
        visible_text: html.replace(/<[^>]+>/g, ' ').slice(0, 10000),
        screenshot: null,
        console_errors: [],
        raw_elements: [], // fallback 无法获取真实 DOM 元素
        scan_duration_ms: Date.now() - startTime,
      };
    }

    // 存入 raw_environment_scans
    const supabaseService = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { data: scanRecord, error: insertError } = await supabaseService
      .from('raw_environment_scans')
      .insert({
        url: rawScan.url,
        title: rawScan.title,
        dom: rawScan.dom,
        visible_text: rawScan.visible_text,
        screenshot: rawScan.screenshot,
        console_errors: rawScan.console_errors,
        raw_elements: rawScan.raw_elements,
        scan_status: 'success',
        scan_duration_ms: rawScan.scan_duration_ms,
        user_id: user.id,
      })
      .select()
      .maybeSingle();

    if (insertError) {
      console.error("[Bootloader] Insert error:", insertError);
      return new Response(JSON.stringify({ error: insertError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({
      data: {
        raw_scan_id: scanRecord.id,
        ...rawScan,
      },
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("[Bootloader] Error:", error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
