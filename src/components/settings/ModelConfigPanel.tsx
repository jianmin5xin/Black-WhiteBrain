// 模型配置面板（BYOK - Bring Your Own Key）
// 支持 DeepSeek / Anthropic Claude / 通义千问 / OpenAI 四种模型的 API Key 配置
import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/db/supabase';
import { useAuth } from '@/contexts/AuthContext';
import type { ModelConfig, ModelProvider } from '@/types/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Eye, EyeOff, Check, Trash2, Loader2, ChevronDown, ChevronUp, Zap, ZapOff,
  Wifi, WifiOff, CircleCheck, CircleX,
} from 'lucide-react';

// 测试结果类型
type TestStatus = 'idle' | 'testing' | 'success' | 'failure';
interface TestResult { status: TestStatus; message?: string }

// ---- 提供商元数据 ----
interface ProviderMeta {
  label: string;
  desc: string;
  keyName: string;
  keyPrefix: string;
  baseUrl: string;
  docsUrl: string;
  color: string;
}

const PROVIDERS: Record<ModelProvider, ProviderMeta> = {
  deepseek: {
    label: 'DeepSeek',
    desc: 'DeepSeek-V3 / DeepSeek-R1，兼容 OpenAI 格式',
    keyName: 'DEEPSEEK_API_KEY',
    keyPrefix: 'sk-',
    baseUrl: 'https://api.deepseek.com',
    docsUrl: 'https://platform.deepseek.com/api_keys',
    color: 'text-blue-400',
  },
  anthropic: {
    label: 'Anthropic Claude',
    desc: 'Claude 3.5 Sonnet / Claude 3 Haiku',
    keyName: 'ANTHROPIC_API_KEY',
    keyPrefix: 'sk-ant-',
    baseUrl: 'https://api.anthropic.com',
    docsUrl: 'https://console.anthropic.com/settings/keys',
    color: 'text-orange-400',
  },
  qwen: {
    label: '通义千问 Qwen',
    desc: 'Qwen-Plus / Qwen-Turbo，兼容 OpenAI 格式',
    keyName: 'DASHSCOPE_API_KEY',
    keyPrefix: 'sk-',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode',
    docsUrl: 'https://bailian.console.aliyun.com/?apiKey=1',
    color: 'text-purple-400',
  },
  openai: {
    label: 'OpenAI ChatGPT',
    desc: 'GPT-4o / GPT-4o-mini',
    keyName: 'OPENAI_API_KEY',
    keyPrefix: 'sk-',
    baseUrl: 'https://api.openai.com',
    docsUrl: 'https://platform.openai.com/api-keys',
    color: 'text-primary',
  },
};

const PROVIDER_ORDER: ModelProvider[] = ['deepseek', 'anthropic', 'qwen', 'openai'];

// ---- 工具函数 ----
function maskKey(key: string): string {
  if (key.length <= 8) return '****';
  return `${key.slice(0, 4)}****${key.slice(-4)}`;
}

// ---- 子组件：单个提供商卡片 ----
function ProviderCard({
  provider,
  config,
  onSave,
  onDelete,
  onActivate,
  onTest,
  activating,
  saving,
  deleting,
}: {
  provider: ModelProvider;
  config: ModelConfig | null;
  onSave: (provider: ModelProvider, key: string) => Promise<void>;
  onDelete: (provider: ModelProvider) => Promise<void>;
  onActivate: (provider: ModelProvider) => Promise<void>;
  onTest: (provider: ModelProvider, key: string) => Promise<TestResult>;
  activating: ModelProvider | null;
  saving: ModelProvider | null;
  deleting: ModelProvider | null;
}) {
  const meta = PROVIDERS[provider];
  const [expanded, setExpanded] = useState(false);
  const [keyValue, setKeyValue] = useState('');
  const [showKey, setShowKey] = useState(false);
  // 表单内测试（输入中的 key）
  const [formTest, setFormTest] = useState<TestResult>({ status: 'idle' });
  // 已保存 key 的测试（卡片头部）
  const [savedTest, setSavedTest] = useState<TestResult>({ status: 'idle' });

  const isConfigured = !!config;
  const isActive = config?.is_active ?? false;
  const isSaving = saving === provider;
  const isDeleting = deleting === provider;
  const isActivating = activating === provider;

  // 输入框变化时重置表单测试结果
  const handleKeyChange = (val: string) => {
    setKeyValue(val);
    if (formTest.status !== 'idle') setFormTest({ status: 'idle' });
  };

  const handleSave = async () => {
    if (!keyValue.trim()) { toast.error('请输入 API Key'); return; }
    await onSave(provider, keyValue.trim());
    setKeyValue('');
    setExpanded(false);
    setFormTest({ status: 'idle' });
  };

  // 测试表单中输入的 key
  const handleTestForm = async () => {
    if (!keyValue.trim()) { toast.error('请先填写 API Key'); return; }
    setFormTest({ status: 'testing' });
    const result = await onTest(provider, keyValue.trim());
    setFormTest(result);
  };

  // 测试已保存的 key
  const handleTestSaved = async () => {
    if (!config) return;
    setSavedTest({ status: 'testing' });
    const result = await onTest(provider, config.api_key);
    setSavedTest(result);
  };

  return (
    <div className={`border transition-colors ${isActive ? 'border-primary/60 bg-primary/5' : 'border-border hover:border-border/80'}`}>
      {/* 卡片头部 */}
      <div className="flex items-center gap-3 p-3">
        {/* 激活指示点 */}
        <div className={`w-2 h-2 shrink-0 ${isActive ? 'bg-primary' : isConfigured ? 'bg-yellow-400' : 'bg-muted-foreground/30'}`} />

        {/* 提供商信息 */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-xs font-mono font-bold ${meta.color}`}>{meta.label}</span>
            {isActive && (
              <span className="text-xs font-mono px-1.5 py-0.5 border border-primary/40 text-primary bg-primary/10 flex items-center gap-1">
                <Zap className="w-2.5 h-2.5" />激活中
              </span>
            )}
            {isConfigured && !isActive && (
              <span className="text-xs font-mono px-1.5 py-0.5 border border-yellow-400/40 text-yellow-400 bg-yellow-400/5">
                已配置
              </span>
            )}
            {!isConfigured && (
              <span className="text-xs font-mono text-muted-foreground/60">未配置</span>
            )}
            {/* 已保存 key 的测试结果徽章 */}
            {savedTest.status === 'success' && (
              <span className="text-xs font-mono px-1.5 py-0.5 border border-green-500/40 text-green-400 bg-green-500/5 flex items-center gap-1">
                <CircleCheck className="w-2.5 h-2.5" />连接正常
              </span>
            )}
            {savedTest.status === 'failure' && (
              <span className="text-xs font-mono px-1.5 py-0.5 border border-red-500/40 text-red-400 bg-red-500/5 flex items-center gap-1">
                <CircleX className="w-2.5 h-2.5" />连接失败
              </span>
            )}
          </div>
          <p className="text-xs font-mono text-muted-foreground mt-0.5 text-pretty">{meta.desc}</p>
          {isConfigured && (
            <p className="text-xs font-mono text-muted-foreground/60 mt-0.5">
              {meta.keyName}: <code className="text-foreground/60">{maskKey(config!.api_key)}</code>
            </p>
          )}
          {/* 已保存 key 的测试失败详情 */}
          {savedTest.status === 'failure' && savedTest.message && (
            <p className="text-xs font-mono text-red-400 mt-1 text-pretty">{savedTest.message}</p>
          )}
        </div>

        {/* 操作按钮组 */}
        <div className="flex items-center gap-1 shrink-0">
          {/* 测试已保存的 key */}
          {isConfigured && (
            <Button
              variant="ghost"
              size="sm"
              className={`h-7 text-xs font-mono border gap-1 px-2 ${
                savedTest.status === 'success'
                  ? 'border-green-500/40 text-green-400 hover:bg-green-500/10'
                  : savedTest.status === 'failure'
                  ? 'border-red-500/40 text-red-400 hover:bg-red-500/10'
                  : 'border-border text-muted-foreground hover:text-foreground hover:border-border/80'
              }`}
              onClick={handleTestSaved}
              disabled={savedTest.status === 'testing'}
              title="测试已保存的 API Key 是否可用"
            >
              {savedTest.status === 'testing' ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : savedTest.status === 'success' ? (
                <Wifi className="w-3 h-3" />
              ) : savedTest.status === 'failure' ? (
                <WifiOff className="w-3 h-3" />
              ) : (
                <Wifi className="w-3 h-3" />
              )}
              测试
            </Button>
          )}
          {/* 激活按钮（仅已配置未激活时显示） */}
          {isConfigured && !isActive && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs font-mono border border-yellow-400/40 text-yellow-400 hover:bg-yellow-400/10 gap-1 px-2"
              onClick={() => onActivate(provider)}
              disabled={isActivating}
            >
              {isActivating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
              激活
            </Button>
          )}
          {/* 取消激活（已激活时） */}
          {isActive && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs font-mono border border-primary/40 text-primary hover:bg-primary/10 gap-1 px-2"
              onClick={() => onActivate(provider)}
              disabled={isActivating}
            >
              {isActivating ? <Loader2 className="w-3 h-3 animate-spin" /> : <ZapOff className="w-3 h-3" />}
              取消
            </Button>
          )}
          {/* 删除按钮 */}
          {isConfigured && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-muted-foreground hover:text-red-400 hover:border-red-400/40 border border-transparent"
              onClick={() => onDelete(provider)}
              disabled={isDeleting}
            >
              {isDeleting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
            </Button>
          )}
          {/* 展开/收起配置表单 */}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground border border-transparent hover:border-border"
            onClick={() => setExpanded(v => !v)}
          >
            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </Button>
        </div>
      </div>

      {/* 展开：配置表单 */}
      {expanded && (
        <div className="border-t border-border/40 p-3 bg-black/10 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-mono text-muted-foreground">
              {isConfigured ? '更新 API Key' : '填入 API Key'}
            </p>
            <a
              href={meta.docsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-mono text-primary/70 hover:text-primary underline"
            >
              获取 Key →
            </a>
          </div>
          {/* Key 输入行 */}
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Input
                type={showKey ? 'text' : 'password'}
                value={keyValue}
                onChange={e => handleKeyChange(e.target.value)}
                placeholder={`${meta.keyPrefix}...`}
                className="h-8 text-xs font-mono bg-background border-border pr-8"
                onKeyDown={e => { if (e.key === 'Enter') handleSave(); }}
              />
              <button
                type="button"
                onClick={() => setShowKey(v => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>
            {/* 测试输入中的 key */}
            <Button
              variant="ghost"
              size="sm"
              className={`h-8 text-xs font-mono border gap-1 shrink-0 px-2 ${
                formTest.status === 'success'
                  ? 'border-green-500/40 text-green-400 hover:bg-green-500/10'
                  : formTest.status === 'failure'
                  ? 'border-red-500/40 text-red-400 hover:bg-red-500/10'
                  : 'border-border text-muted-foreground hover:text-foreground'
              }`}
              onClick={handleTestForm}
              disabled={formTest.status === 'testing' || !keyValue.trim()}
            >
              {formTest.status === 'testing' ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : formTest.status === 'success' ? (
                <CircleCheck className="w-3 h-3" />
              ) : formTest.status === 'failure' ? (
                <CircleX className="w-3 h-3" />
              ) : (
                <Wifi className="w-3 h-3" />
              )}
              测试
            </Button>
            {/* 保存按钮 */}
            <Button
              size="sm"
              className="h-8 text-xs font-mono bg-primary text-primary-foreground hover:bg-primary/90 gap-1 shrink-0"
              onClick={handleSave}
              disabled={isSaving || !keyValue.trim()}
            >
              {isSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
              保存
            </Button>
          </div>
          {/* 表单测试结果详情 */}
          {formTest.status === 'success' && (
            <p className="text-xs font-mono text-green-400 flex items-center gap-1">
              <CircleCheck className="w-3 h-3 shrink-0" />
              连接成功，API Key 有效，可以保存
            </p>
          )}
          {formTest.status === 'failure' && formTest.message && (
            <p className="text-xs font-mono text-red-400 flex items-start gap-1">
              <CircleX className="w-3 h-3 shrink-0 mt-0.5" />
              <span className="text-pretty">{formTest.message}</span>
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ---- 主组件 ----
export default function ModelConfigPanel() {
  const { user } = useAuth();
  const [configs, setConfigs] = useState<ModelConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<ModelProvider | null>(null);
  const [deleting, setDeleting] = useState<ModelProvider | null>(null);
  const [activating, setActivating] = useState<ModelProvider | null>(null);

  const fetchConfigs = async () => {
    if (!user) return;
    const { data } = await supabase
      .from('model_configs')
      .select('*')
      .eq('user_id', user.id);
    setConfigs(Array.isArray(data) ? data : []);
    setLoading(false);
  };

  useEffect(() => { fetchConfigs(); }, [user]);

  const getConfig = (provider: ModelProvider) =>
    configs.find(c => c.provider === provider) ?? null;

  const handleSave = async (provider: ModelProvider, apiKey: string) => {
    if (!user) return;
    setSaving(provider);
    try {
      const existing = getConfig(provider);
      if (existing) {
        const { error } = await supabase
          .from('model_configs')
          .update({ api_key: apiKey })
          .eq('id', existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('model_configs')
          .insert({ provider, api_key: apiKey, user_id: user.id });
        if (error) throw error;
      }
      toast.success(`${PROVIDERS[provider].label} API Key 已保存`);
      await fetchConfigs();
    } catch (e) {
      toast.error(`保存失败: ${(e as Error).message}`);
    } finally {
      setSaving(null);
    }
  };

  const handleDelete = async (provider: ModelProvider) => {
    const config = getConfig(provider);
    if (!config) return;
    setDeleting(provider);
    try {
      const { error } = await supabase
        .from('model_configs')
        .delete()
        .eq('id', config.id);
      if (error) throw error;
      toast.success(`${PROVIDERS[provider].label} API Key 已删除`);
      await fetchConfigs();
    } catch (e) {
      toast.error(`删除失败: ${(e as Error).message}`);
    } finally {
      setDeleting(null);
    }
  };

  const handleActivate = async (provider: ModelProvider) => {
    const config = getConfig(provider);
    if (!config) return;
    setActivating(provider);
    try {
      const newActive = !config.is_active;
      const { error } = await supabase
        .from('model_configs')
        .update({ is_active: newActive })
        .eq('id', config.id);
      if (error) throw error;
      toast.success(newActive
        ? `已激活 ${PROVIDERS[provider].label} 作为白质层推理模型`
        : `已取消激活 ${PROVIDERS[provider].label}`
      );
      await fetchConfigs();
    } catch (e) {
      toast.error(`操作失败: ${(e as Error).message}`);
    } finally {
      setActivating(null);
    }
  };

  // 测试连接：通过 Edge Function 验证 API Key 可用性
  const handleTest = async (provider: ModelProvider, apiKey: string): Promise<TestResult> => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) {
      toast.error('未登录或会话已过期，请重新登录');
      return { status: 'failure', message: '未登录或会话已过期' };
    }

    try {
      const { data, error } = await supabase.functions.invoke('test-model-connection', {
        body: { provider, api_key: apiKey },
      });

      if (error) {
        const msg = await error?.context?.text?.() || error.message;
        return { status: 'failure', message: msg };
      }

      if (data?.success) {
        toast.success(`${PROVIDERS[provider].label} 连接测试成功`);
        return { status: 'success', message: data.message };
      } else {
        return { status: 'failure', message: data?.message ?? '连接失败，请检查 API Key' };
      }
    } catch (e) {
      return { status: 'failure', message: (e as Error).message };
    }
  };

  const activeConfig = configs.find(c => c.is_active);

  return (
    <div className="space-y-4">
      {/* 模块标题 */}
      <div className="flex items-center gap-3 pb-2 border-b border-border">
        <Zap className="w-4 h-4 text-primary shrink-0" />
        <div>
          <h3 className="text-sm font-mono font-bold text-foreground">模型配置</h3>
          <p className="text-xs font-mono text-muted-foreground mt-0.5">
            配置自己的大模型 API Key，白质层推理将优先使用已激活的模型
          </p>
        </div>
      </div>

      {/* 当前激活模型提示 */}
      <div className={`flex items-center gap-2 p-2.5 border text-xs font-mono
        ${activeConfig ? 'border-primary/40 bg-primary/5 text-primary' : 'border-border bg-card/50 text-muted-foreground'}`}>
        <Zap className="w-3.5 h-3.5 shrink-0" />
        {activeConfig
          ? `当前激活：${PROVIDERS[activeConfig.provider as ModelProvider].label}`
          : '当前未激活自定义模型，使用平台托管文心一言（默认兜底）'}
      </div>

      {/* 提供商列表 */}
      {loading ? (
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-16 bg-muted animate-pulse border border-border" />
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {PROVIDER_ORDER.map(provider => (
            <ProviderCard
              key={provider}
              provider={provider}
              config={getConfig(provider)}
              onSave={handleSave}
              onDelete={handleDelete}
              onActivate={handleActivate}
              onTest={handleTest}
              activating={activating}
              saving={saving}
              deleting={deleting}
            />
          ))}
        </div>
      )}

      {/* 平台托管文心说明 */}
      <div className="border border-border/40 p-3 bg-card/30 space-y-1">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 bg-muted-foreground/30 shrink-0" />
          <span className="text-xs font-mono font-bold text-muted-foreground">文心一言（平台托管）</span>
          <span className="text-xs font-mono px-1.5 py-0.5 border border-border text-muted-foreground">兜底</span>
        </div>
        <p className="text-xs font-mono text-muted-foreground pl-4">
          无需配置，当没有激活自定义模型时自动使用。由平台统一提供，无额外费用。
        </p>
      </div>
    </div>
  );
}
