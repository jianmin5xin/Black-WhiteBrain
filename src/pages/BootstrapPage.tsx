import { useState, useEffect, useMemo } from 'react';
import AppLayout from '@/components/layouts/AppLayout';
import { supabase } from '@/db/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import type { EnvironmentProfile } from '@/types/types';
import { toast } from 'sonner';
import {
  Cpu, Search, Activity, Eye, Zap, BarChart3, Plus, Copy, CheckCircle,
  History, Trash2, ChevronDown, ChevronUp, Globe, Clock, Layers,
} from 'lucide-react';

function simulateBootstrap(url: string, userId: string): EnvironmentProfile {
  let domain = url;
  try {
    domain = new URL(url.startsWith('http') ? url : 'https://' + url).hostname;
  } catch (e) {
    // 忽略无效 URL 格式导致的解析错误，此时直接使用原字符串
  }

  // 模拟从 DOM 中扫描出的交互元素
  const mockElements = [
    { type: 'input', selector: '[data-testid="username-input"]', role: 'textbox', attributes: { type: 'text', placeholder: 'Username' } },
    { type: 'input', selector: '[data-testid="password-input"]', role: 'textbox', attributes: { type: 'password', placeholder: 'Password' } },
    { type: 'button', selector: '[data-testid="login-button"]', role: 'button', text: 'Login' },
    { type: 'a', selector: '[data-test="forgot-password"]', role: 'link', text: 'Forgot Password?' },
    { type: 'select', selector: '#language-select', role: 'combobox', options: ['en', 'zh', 'ja'] }
  ];

  return {
    id: crypto.randomUUID(),
    url,
    environment_type: 'web_automation',
    perception_surfaces: ['dom_elements', 'page_title', 'form_fields', 'button_labels', 'link_texts', 'image_alts', 'aria_labels'],
    execution_surfaces: ['click', 'fill', 'select', 'wait', 'screenshot', 'press_key', 'navigate'],
    feedback_surfaces: ['url_change', 'dom_change', 'element_visible', 'element_hidden', 'validation_error', 'toast_or_alert', 'network_idle'],
    elements: mockElements,
    scan_status: 'success',
    scan_error: null,
    missing_capabilities: ['visual_recognition', 'captcha_solving', 'file_upload'],
    recommended_adapters: ['dom_reader', 'click_adapter', 'fill_adapter', 'select_adapter', 'wait_adapter', 'screenshot_adapter', 'feedback_observer'],
    raw_profile: {
      domain,
      detected_frameworks: ['React', 'Vue'],
      form_count: Math.floor(Math.random() * 5) + 1,
      button_count: Math.floor(Math.random() * 20) + 5,
      input_count: Math.floor(Math.random() * 15) + 2,
      has_spa: true,
      has_authentication: true,
      scan_duration_ms: Math.floor(Math.random() * 800) + 200,
    },
    user_id: userId,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  } as import('@/types/types').EnvironmentProfile;
}

const SURFACE_DEFS = [
  { key: 'perception_surfaces',  icon: Eye,      label: '感知面',    color: 'text-blue-400',   border: 'border-blue-400/30',   bg: 'bg-blue-400/10' },
  { key: 'execution_surfaces',   icon: Zap,      label: '执行面',    color: 'text-primary',    border: 'border-primary/30',    bg: 'bg-primary/10' },
  { key: 'feedback_surfaces',    icon: Activity, label: '反馈面',    color: 'text-yellow-400', border: 'border-yellow-400/30', bg: 'bg-yellow-400/10' },
  { key: 'missing_capabilities', icon: Search,   label: '缺失能力',  color: 'text-red-400',    border: 'border-red-400/30',    bg: 'bg-red-400/10' },
  { key: 'recommended_adapters', icon: BarChart3, label: '推荐适配器', color: 'text-purple-400', border: 'border-purple-400/30', bg: 'bg-purple-400/10' },
];

// ─── 能力面展示卡 ────────────────────────────────────────────────────
function SurfaceGrid({ profile }: { profile: EnvironmentProfile }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {SURFACE_DEFS.map(({ key, icon: Icon, label, color, border, bg }) => {
        const items = profile[key as keyof EnvironmentProfile] as string[];
        return (
          <div key={key} className={`border ${border} ${bg} p-3`}>
            <div className="flex items-center gap-1.5 mb-2">
              <Icon className={`w-3.5 h-3.5 ${color}`} />
              <span className={`text-xs font-semibold font-mono ${color}`}>{label}</span>
              <span className={`text-xs font-mono ${color} ml-auto opacity-70`}>{items.length}项</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {items.map(item => (
                <span key={item} className={`text-xs font-mono px-2 py-0.5 border ${border} ${color}`}>{item}</span>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── 历史画像行 ──────────────────────────────────────────────────────
function ProfileHistoryRow({
  profile,
  expanded,
  onToggle,
  onDelete,
}: {
  profile: EnvironmentProfile;
  expanded: boolean;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const raw = profile.raw_profile as Record<string, unknown>;
  const domain = (() => {
    try { return new URL(profile.url.startsWith('http') ? profile.url : 'https://' + profile.url).hostname; }
    catch { return profile.url; }
  })();

  return (
    <div className="border border-border">
      {/* 折叠头 */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-3 py-3 hover:bg-muted/40 transition-colors text-left"
      >
        <Globe className="w-4 h-4 text-primary shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-mono font-semibold text-foreground truncate">{domain}</p>
          <p className="text-xs font-mono text-muted-foreground truncate">{profile.url}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="hidden md:flex items-center gap-3">
            <span className="flex items-center gap-1 text-xs font-mono text-muted-foreground">
              <Layers className="w-3 h-3" />
              {profile.perception_surfaces.length + profile.execution_surfaces.length + profile.feedback_surfaces.length}项能力
            </span>
            <span className="text-xs font-mono px-1.5 py-0.5 border border-purple-400/40 text-purple-400">
              {profile.recommended_adapters.length} 适配器
            </span>
          </div>
          <span className="flex items-center gap-1 text-xs font-mono text-muted-foreground">
            <Clock className="w-3 h-3" />
            {new Date(profile.created_at).toLocaleString('zh-CN', {
              month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
            })}
          </span>
          {expanded ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
        </div>
      </button>

      {/* 展开详情 */}
      {expanded && (
        <div className="border-t border-border p-4 space-y-4">
          {/* 基础信息 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {[
              { label: '环境类型', value: profile.environment_type },
              { label: '域名', value: domain },
              { label: '扫描耗时', value: `${raw?.scan_duration_ms ?? 0}ms` },
              { label: '缺失能力', value: `${profile.missing_capabilities.length}项` },
            ].map(({ label, value }) => (
              <div key={label} className="p-2 border border-border bg-card/50">
                <p className="text-xs font-mono text-muted-foreground">{label}</p>
                <p className="text-xs font-mono text-foreground mt-0.5">{value}</p>
              </div>
            ))}
          </div>

          <SurfaceGrid profile={profile} />

          {/* 操作 */}
          <div className="flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs font-mono gap-1 text-red-400 border border-red-400/30 hover:bg-red-400/10"
              onClick={e => { e.stopPropagation(); onDelete(); }}
            >
              <Trash2 className="w-3 h-3" />
              删除此画像
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

type ActiveTab = 'scan' | 'history';

export default function BootstrapPage() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<ActiveTab>('scan');

  // ── 扫描状态 ─────────────────────────────────────────────────────
  const [url, setUrl] = useState('');
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<EnvironmentProfile | null>(null);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  // ── 历史画像 ─────────────────────────────────────────────────────
  const [profiles, setProfiles] = useState<EnvironmentProfile[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historySearch, setHistorySearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchHistory = async () => {
    if (!user) return;
    setLoadingHistory(true);
    const { data } = await supabase
      .from('environment_profiles')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(100);
    setProfiles(Array.isArray(data) ? data : []);
    setLoadingHistory(false);
  };

  useEffect(() => { fetchHistory(); }, [user]);

  const filteredProfiles = useMemo(() => {
    if (!historySearch) return profiles;
    const s = historySearch.toLowerCase();
    return profiles.filter(p =>
      p.url.toLowerCase().includes(s) ||
      p.environment_type.toLowerCase().includes(s),
    );
  }, [profiles, historySearch]);

  // ── 扫描操作 ─────────────────────────────────────────────────────
  const scan = async () => {
    if (!url.trim()) { toast.error('请输入目标URL'); return; }
    setScanning(true);
    setSaved(false);
    setResult(null);
    await new Promise(r => setTimeout(r, 1500));
    try {
      const profile = simulateBootstrap(url.trim(), user?.id || '');
      setResult(profile);
      toast.success('环境扫描完成，能力画像已生成');
    } catch {
      toast.error('URL格式无效');
    }
    setScanning(false);
  };

  const saveProfile = async () => {
    if (!user || !result) return;
    const { id: _id, created_at: _ca, user_id: _uid, ...insertData } = result;
    const { error } = await supabase.from('environment_profiles').insert({
      ...insertData,
      user_id: user.id,
    });
    if (error) { toast.error('保存失败: ' + error.message); return; }
    await supabase.from('environment_profiles').insert(result);
    toast.success('画像已保存至历史记录');
    fetchHistory();
    setSaved(true);
    toast.success('环境画像已保存至记忆库');
    fetchHistory();
  };

  const deleteProfile = async (id: string) => {
    const { error } = await supabase.from('environment_profiles').delete().eq('id', id);
    if (error) { toast.error('删除失败: ' + error.message); return; }
    toast.success('已删除画像');
    setProfiles(prev => prev.filter(p => p.id !== id));
  };

  const copyJson = () => {
    if (!result) return;
    navigator.clipboard.writeText(JSON.stringify(result, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success('已复制到剪贴板');
  };

  return (
    <AppLayout title="环境自举器">
      <div className="p-4 md:p-6 space-y-4 max-w-4xl">

        {/* 标题说明 */}
        <div className="p-4 border border-border bg-card">
          <div className="flex items-center gap-2 mb-2">
            <Cpu className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-semibold font-mono text-foreground">环境自举原理</h2>
          </div>
          <p className="text-xs font-mono text-muted-foreground leading-relaxed">
            智能体进入环境后，先建立环境能力画像：
            <span className="text-blue-400">感知什么</span>？
            <span className="text-primary ml-1">执行什么</span>？
            <span className="text-yellow-400 ml-1">如何判断成功</span>？
            自举层扫描目标网页，自动发现三类能力面并生成桥接组件推荐。
          </p>
        </div>

        {/* 标签切换 */}
        <div className="flex items-center border-b border-border">
          <button
            onClick={() => setActiveTab('scan')}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-mono border-b-2 transition-colors
              ${activeTab === 'scan' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
          >
            <Search className="w-3.5 h-3.5" />
            扫描配置
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-mono border-b-2 transition-colors
              ${activeTab === 'history' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
          >
            <History className="w-3.5 h-3.5" />
            画像历史
            {profiles.length > 0 && (
              <span className="ml-1 text-xs font-mono px-1.5 py-0 border border-current rounded-sm opacity-70">
                {profiles.length}
              </span>
            )}
          </button>
        </div>

        {/* ── 扫描配置标签 ── */}
        {activeTab === 'scan' && (
          <div className="space-y-6">
            {/* 扫描输入 */}
            <div className="space-y-3">
              <Label className="text-xs font-mono text-muted-foreground">目标URL</Label>
              <div className="flex gap-2">
                <Input
                  value={url}
                  onChange={e => setUrl(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && !scanning && scan()}
                  placeholder="https://example.com"
                  className="h-9 text-xs font-mono bg-background border-border flex-1"
                />
                <Button
                  className="h-9 text-xs font-mono gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90 shrink-0"
                  onClick={scan}
                  disabled={scanning}
                >
                  {scanning
                    ? <Activity className="w-3.5 h-3.5 animate-spin" />
                    : <Search className="w-3.5 h-3.5" />}
                  {scanning ? '扫描中...' : '开始扫描'}
                </Button>
              </div>
            </div>

            {/* 扫描进度动画 */}
            {scanning && (
              <div className="border border-primary/30 bg-primary/5 p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <Activity className="w-4 h-4 text-primary animate-spin" />
                  <span className="text-xs font-mono text-primary">自举层扫描中...</span>
                </div>
                {['识别环境类型', '发现感知面', '发现执行面', '发现反馈面', '评估缺失能力', '生成适配器推荐'].map((step, i) => (
                  <div key={step} className="flex items-center gap-2 pl-6">
                    <div
                      className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-pulse"
                      style={{ animationDelay: `${i * 200}ms` }}
                    />
                    <span className="text-xs font-mono text-muted-foreground">{step}</span>
                  </div>
                ))}
              </div>
            )}

            {/* 扫描结果 */}
            {result && !scanning && (
              <div className="space-y-4">
                <div className="border border-primary/30 bg-primary/5 p-4">
                  <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <CheckCircle className="w-4 h-4 text-primary" />
                      <span className="text-xs font-semibold font-mono text-primary">环境能力画像生成完成</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-xs font-mono gap-1 text-muted-foreground hover:text-foreground"
                        onClick={copyJson}
                      >
                        {copied ? <CheckCircle className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                        {copied ? '已复制' : '复制JSON'}
                      </Button>
                      {!saved ? (
                        <Button
                          size="sm"
                          className="h-6 text-xs font-mono gap-1 bg-primary text-primary-foreground hover:bg-primary/90"
                          onClick={saveProfile}
                        >
                          <Plus className="w-3 h-3" />保存到记忆库
                        </Button>
                      ) : (
                        <span className="text-xs font-mono text-primary">✓ 已保存</span>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    {[
                      { label: '环境类型', value: result.environment_type },
                      { label: '目标域名', value: (() => { try { return new URL(result.url.startsWith('http') ? result.url : 'https://' + result.url).hostname; } catch { return result.url; } })() },
                      { label: '扫描耗时', value: `${(result.raw_profile as Record<string, unknown>)?.scan_duration_ms ?? 0}ms` },
                      { label: '缺失能力', value: `${result.missing_capabilities.length}项` },
                    ].map(({ label, value }) => (
                      <div key={label} className="p-2 border border-primary/20 bg-background">
                        <p className="text-xs font-mono text-muted-foreground">{label}</p>
                        <p className="text-xs font-mono text-foreground mt-0.5">{value}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <SurfaceGrid profile={result} />

                <div>
                  <p className="text-xs font-mono text-muted-foreground mb-2">环境能力画像 (JSON)</p>
                  <pre className="text-xs font-mono text-foreground bg-background border border-border p-3 overflow-x-auto max-h-64">
                    {JSON.stringify(result, null, 2)}
                  </pre>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── 画像历史标签 ── */}
        {activeTab === 'history' && (
          <div className="space-y-4">
            {/* 搜索 + 刷新 */}
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <Input
                  value={historySearch}
                  onChange={e => setHistorySearch(e.target.value)}
                  placeholder="搜索URL或环境类型..."
                  className="h-8 text-xs font-mono bg-background border-border pl-8"
                />
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground shrink-0"
                onClick={fetchHistory}
              >
                <History className="w-3.5 h-3.5" />
              </Button>
            </div>

            {/* 统计摘要 */}
            {profiles.length > 0 && (
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: '已保存画像', value: profiles.length },
                  { label: '不同域名', value: new Set(profiles.map(p => { try { return new URL(p.url.startsWith('http') ? p.url : 'https://' + p.url).hostname; } catch { return p.url; } })).size },
                  { label: '平均适配器', value: profiles.length > 0 ? Math.round(profiles.reduce((a, p) => a + p.recommended_adapters.length, 0) / profiles.length) : 0 },
                ].map(({ label, value }) => (
                  <div key={label} className="p-3 border border-border text-center">
                    <div className="text-xl font-bold font-mono text-primary">{value}</div>
                    <div className="text-xs font-mono text-muted-foreground">{label}</div>
                  </div>
                ))}
              </div>
            )}

            {/* 列表 */}
            {loadingHistory ? (
              <div className="space-y-2">
                {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-16 bg-muted" />)}
              </div>
            ) : filteredProfiles.length === 0 ? (
              <div className="text-center py-16">
                <History className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                <p className="text-sm font-mono text-muted-foreground">
                  {profiles.length === 0 ? '暂无保存的环境画像' : '没有匹配的画像'}
                </p>
                <p className="text-xs text-muted-foreground font-mono mt-1">
                  {profiles.length === 0
                    ? '在「扫描配置」中扫描并保存后，画像将显示在此处'
                    : '尝试调整搜索关键词'}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-xs font-mono text-muted-foreground">
                  共 {filteredProfiles.length} 条画像{historySearch && `（筛选自 ${profiles.length} 条）`}
                </p>
                {filteredProfiles.map(profile => (
                  <ProfileHistoryRow
                    key={profile.id}
                    profile={profile}
                    expanded={expandedId === profile.id}
                    onToggle={() => setExpandedId(prev => prev === profile.id ? null : profile.id)}
                    onDelete={() => deleteProfile(profile.id)}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
