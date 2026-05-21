import { useEffect, useState, useCallback } from 'react';
import AppLayout from '@/components/layouts/AppLayout';
import { supabase } from '@/db/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useRealtimeSync } from '@/hooks/use-realtime-sync';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import type { SkillCard, SkillStatus, SkillHistory, RiskLevel, EnvironmentProfile } from '@/types/types';
import {
  Plus, Layers, Activity, CheckCircle, Clock, RefreshCw, ChevronRight,
  Settings, GitBranch, BarChart3, Shield, Zap, Eye, Trash2, ArrowRight,
  TrendingUp,
} from 'lucide-react';

const SKILL_STATUS_LIST: SkillStatus[] = ['candidate', 'temporary', 'sandbox', 'gray_matter', 'mature', 'universal', 'deprecated'];
const SKILL_STATUS_LABELS: Record<SkillStatus, string> = {
  candidate: '候选', temporary: '临时', sandbox: '沙盒验证',
  gray_matter: '灰质', mature: '成熟', universal: '通用', deprecated: '废弃',
};
const RISK_LABELS: Record<RiskLevel, string> = {
  low: '低风险', medium: '中风险', high: '高风险', forbidden: '禁止',
};

const DEFAULT_PARAMS = {
  detection_threshold: 0.62,
  reaction_delay_ms: 100,
  retry_count: 3,
  timeout_ms: 5000,
  confidence_min: 0.7,
};

function SkillStatusBadge({ status }: { status: SkillStatus }) {
  return (
    <span className={`text-xs font-mono px-2 py-0.5 border status-${status}`}>
      {SKILL_STATUS_LABELS[status]}
    </span>
  );
}

function SkillDetail({ skill, onUpdated }: { skill: SkillCard; onUpdated: () => void }) {
  const { user } = useAuth();
  const [history, setHistory] = useState<SkillHistory[]>([]);
  const [histLoading, setHistLoading] = useState(false);
  const [params, setParams] = useState({ ...skill.tunable_params });
  const [saving, setSaving] = useState(false);
  const [newStatus, setNewStatus] = useState<SkillStatus>(skill.status);
  const [statusSaving, setStatusSaving] = useState(false);

  useEffect(() => {
    setParams({ ...skill.tunable_params });
    setNewStatus(skill.status);
    loadHistory();
  }, [skill.id]);

  const loadHistory = async () => {
    setHistLoading(true);
    const { data } = await supabase.from('skill_history').select('*').eq('skill_card_id', skill.id).order('created_at', { ascending: false }).limit(20);
    setHistory(Array.isArray(data) ? data : []);
    setHistLoading(false);
  };

  const saveParams = async () => {
    if (!user) return;
    setSaving(true);
    // 保存历史
    await supabase.from('skill_history').insert({
      skill_card_id: skill.id,
      version: skill.version,
      changes_json: { params_updated: true, old: skill.tunable_params, new: params },
      tunable_params: params,
      status: skill.status,
      notes: '参数调整',
      user_id: user.id,
    });
    // 更新技能卡
    const vParts = skill.version.split('.').map(Number);
    vParts[2] = (vParts[2] || 0) + 1;
    const newVersion = vParts.join('.');
    const { error } = await supabase.from('skill_cards').update({
      tunable_params: params,
      version: newVersion,
    }).eq('id', skill.id);
    if (error) { toast.error('保存失败'); } else { toast.success('参数已保存，版本升级至 ' + newVersion); onUpdated(); }
    setSaving(false);
    loadHistory();
  };

  const changeStatus = async () => {
    if (!user || newStatus === skill.status) return;
    setStatusSaving(true);
    await supabase.from('skill_history').insert({
      skill_card_id: skill.id,
      version: skill.version,
      changes_json: { status_changed: true, old: skill.status, new: newStatus },
      tunable_params: skill.tunable_params,
      status: newStatus,
      notes: `状态变更: ${SKILL_STATUS_LABELS[skill.status]} → ${SKILL_STATUS_LABELS[newStatus]}`,
      user_id: user.id,
    });
    const { error } = await supabase.from('skill_cards').update({ status: newStatus }).eq('id', skill.id);
    if (error) { toast.error('变更失败'); } else { toast.success('状态已变更为: ' + SKILL_STATUS_LABELS[newStatus]); onUpdated(); }
    setStatusSaving(false);
  };

  const paramSliders: { key: string; label: string; min: number; max: number; step: number; unit: string }[] = [
    { key: 'detection_threshold', label: '检测阈值', min: 0, max: 1, step: 0.01, unit: '' },
    { key: 'reaction_delay_ms', label: '反应延迟', min: 0, max: 2000, step: 10, unit: 'ms' },
    { key: 'retry_count', label: '重试次数', min: 0, max: 10, step: 1, unit: '次' },
    { key: 'timeout_ms', label: '超时时间', min: 1000, max: 30000, step: 500, unit: 'ms' },
    { key: 'confidence_min', label: '置信度下限', min: 0, max: 1, step: 0.01, unit: '' },
  ];

  return (
    <Tabs defaultValue="overview" className="h-full flex flex-col">
      <TabsList className="bg-card border-b border-border rounded-none h-8 px-4 justify-start gap-0 shrink-0 w-full overflow-x-auto">
        {[
          { value: 'overview', label: '概览', icon: Eye },
          { value: 'params', label: '调参', icon: Settings },
          { value: 'lifecycle', label: '生命周期', icon: GitBranch },
          { value: 'history', label: '版本历史', icon: Clock },
          { value: 'metrics', label: '指标', icon: BarChart3 },
        ].map(({ value, label, icon: Icon }) => (
          <TabsTrigger key={value} value={value} className="text-xs font-mono h-7 px-3 rounded-none data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:border-b-2 data-[state=active]:border-primary whitespace-nowrap">
            <Icon className="w-3 h-3 mr-1.5" />{label}
          </TabsTrigger>
        ))}
      </TabsList>

      <div className="flex-1 overflow-y-auto">
        <TabsContent value="overview" className="p-4 mt-0 space-y-4">
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: '技能ID', value: skill.skill_id },
              { label: '版本', value: skill.version },
              { label: '环境类型', value: skill.environment_type },
              { label: '风险等级', value: RISK_LABELS[skill.safety.risk_level as RiskLevel] },
            ].map(({ label, value }) => (
              <div key={label} className="p-2 border border-border bg-card">
                <p className="text-xs font-mono text-muted-foreground">{label}</p>
                <p className="text-xs font-mono text-foreground mt-0.5 truncate">{value}</p>
              </div>
            ))}
          </div>
          <div>
            <p className="text-xs font-mono text-muted-foreground mb-1.5">感知面 (Perception Sources)</p>
            <div className="flex flex-wrap gap-1.5">
              {skill.perception_sources.length > 0 ? skill.perception_sources.map(s => (
                <span key={s} className="text-xs font-mono text-blue-400 border border-blue-400/30 bg-blue-400/10 px-2 py-0.5">{s}</span>
              )) : <span className="text-xs text-muted-foreground font-mono">未配置</span>}
            </div>
          </div>
          <div>
            <p className="text-xs font-mono text-muted-foreground mb-1.5">执行面 (Execution Surfaces)</p>
            <div className="flex flex-wrap gap-1.5">
              {skill.execution_surfaces.length > 0 ? skill.execution_surfaces.map(s => (
                <span key={s} className="text-xs font-mono text-primary border border-primary/30 bg-primary/10 px-2 py-0.5">{s}</span>
              )) : <span className="text-xs text-muted-foreground font-mono">未配置</span>}
            </div>
          </div>
          <div>
            <p className="text-xs font-mono text-muted-foreground mb-1.5">反馈面 (Feedback Surfaces)</p>
            <div className="flex flex-wrap gap-1.5">
              {skill.feedback_surfaces.length > 0 ? skill.feedback_surfaces.map(s => (
                <span key={s} className="text-xs font-mono text-yellow-400 border border-yellow-400/30 bg-yellow-400/10 px-2 py-0.5">{s}</span>
              )) : <span className="text-xs text-muted-foreground font-mono">未配置</span>}
            </div>
          </div>
          {skill.safety && (
            <div className="p-3 border border-red-400/20 bg-red-400/5">
              <div className="flex items-center gap-1.5 mb-2">
                <Shield className="w-3.5 h-3.5 text-red-400" />
                <p className="text-xs font-mono text-red-400">安全策略</p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <p className="text-xs font-mono text-muted-foreground">风险等级</p>
                  <span className={`text-xs font-mono border px-1.5 py-0.5 risk-${skill.safety.risk_level}`}>{RISK_LABELS[skill.safety.risk_level as RiskLevel]}</span>
                </div>
                <div>
                  <p className="text-xs font-mono text-muted-foreground">回退动作</p>
                  <p className="text-xs font-mono text-foreground">{skill.safety.fallback_action}</p>
                </div>
                <div className="col-span-2">
                  <p className="text-xs font-mono text-muted-foreground">最大动作频率</p>
                  <p className="text-xs font-mono text-foreground">{skill.safety.max_action_rate_per_second}/秒</p>
                </div>
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="params" className="p-4 mt-0 space-y-4">
          <div className="p-2.5 border border-yellow-400/20 bg-yellow-400/5">
            <p className="text-xs font-mono text-yellow-400">调参原则：先调参数，再改结构，最后换模型</p>
          </div>
          <div className="space-y-5">
            {paramSliders.map(({ key, label, min, max, step, unit }) => {
              const val = (params[key] as number) ?? (DEFAULT_PARAMS as Record<string, number>)[key] ?? min;
              return (
                <div key={key}>
                  <div className="flex items-center justify-between mb-2">
                    <Label className="text-xs font-mono text-muted-foreground">{label}</Label>
                    <span className="text-xs font-bold font-mono text-primary tabular-nums">{val}{unit}</span>
                  </div>
                  <Slider
                    value={[val]}
                    min={min}
                    max={max}
                    step={step}
                    onValueChange={([v]) => setParams(p => ({ ...p, [key]: v }))}
                    className="[&_[role=slider]]:bg-primary [&_[role=slider]]:border-primary"
                  />
                  <div className="flex justify-between mt-1">
                    <span className="text-xs text-muted-foreground font-mono">{min}{unit}</span>
                    <span className="text-xs text-muted-foreground font-mono">{max}{unit}</span>
                  </div>
                </div>
              );
            })}
          </div>
          <Button
            className="w-full h-8 text-xs font-mono bg-primary text-primary-foreground hover:bg-primary/90"
            onClick={saveParams}
            disabled={saving}
          >
            {saving ? '保存中...' : '保存参数（生成新版本）'}
          </Button>
        </TabsContent>

        <TabsContent value="lifecycle" className="p-4 mt-0 space-y-4">
          <div className="space-y-2">
            {SKILL_STATUS_LIST.filter(s => s !== 'deprecated').map((status, idx, arr) => {
              const isCurrent = skill.status === status;
              const filteredArr = arr as SkillStatus[];
              const isPast = filteredArr.indexOf(skill.status) > idx;
              return (
                <div key={status} className={`flex items-center gap-3 p-2.5 border ${isCurrent ? 'border-primary/60 bg-primary/5' : isPast ? 'border-border/40 opacity-50' : 'border-border'}`}>
                  <div className={`w-5 h-5 flex items-center justify-center border shrink-0 ${isCurrent ? 'border-primary bg-primary text-primary-foreground' : isPast ? 'border-border bg-muted' : 'border-border'}`}>
                    {isCurrent ? <Zap className="w-2.5 h-2.5" /> : isPast ? <CheckCircle className="w-2.5 h-2.5 text-muted-foreground" /> : <span className="text-xs text-muted-foreground font-mono">{idx + 1}</span>}
                  </div>
                  <div className="flex-1">
                    <SkillStatusBadge status={status} />
                    <p className="text-xs text-muted-foreground font-mono mt-0.5">
                      {status === 'candidate' ? '白质层认为值得生成' :
                       status === 'temporary' ? '已有最小实现，未充分测试' :
                       status === 'sandbox' ? '在安全环境中通过初步测试' :
                       status === 'gray_matter' ? '可在真实任务中调用' :
                       status === 'mature' ? '有足够成功记录，可默认调用' :
                       '可跨环境迁移'}
                    </p>
                  </div>
                  {isCurrent && <ArrowRight className="w-3.5 h-3.5 text-primary shrink-0" />}
                </div>
              );
            })}
          </div>
          <Separator className="bg-border" />
          <div className="space-y-2">
            <Label className="text-xs font-mono text-muted-foreground">变更状态</Label>
            <Select value={newStatus} onValueChange={v => setNewStatus(v as SkillStatus)}>
              <SelectTrigger className="h-8 text-xs font-mono bg-background border-border">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-card border-border">
                {SKILL_STATUS_LIST.map(s => (
                  <SelectItem key={s} value={s} className="text-xs font-mono">{SKILL_STATUS_LABELS[s]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              className="w-full h-8 text-xs font-mono bg-primary text-primary-foreground hover:bg-primary/90"
              onClick={changeStatus}
              disabled={statusSaving || newStatus === skill.status}
            >
              {statusSaving ? '变更中...' : '确认变更状态'}
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="history" className="p-4 mt-0">
          {histLoading ? (
            <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-12 bg-muted" />)}</div>
          ) : history.length === 0 ? (
            <div className="text-center py-8">
              <Clock className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-xs text-muted-foreground font-mono">暂无版本历史</p>
            </div>
          ) : (
            <div className="space-y-2">
              {history.map(h => (
                <div key={h.id} className="border border-border p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-mono text-primary border border-primary/30 px-1.5">v{h.version}</span>
                    <SkillStatusBadge status={h.status} />
                    <span className="text-xs text-muted-foreground font-mono ml-auto">{new Date(h.created_at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                  {h.notes && <p className="text-xs font-mono text-foreground">{h.notes}</p>}
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="metrics" className="p-4 mt-0">
          <div className="grid grid-cols-1 gap-3">
            {[
              { label: '成功率', value: `${Math.round((skill.metrics.success_rate || 0) * 100)}%`, icon: CheckCircle, color: 'text-primary' },
              { label: '平均延迟', value: `${skill.metrics.avg_latency_ms || 0}ms`, icon: Zap, color: 'text-yellow-400' },
              { label: '样本数量', value: skill.metrics.sample_count || 0, icon: TrendingUp, color: 'text-blue-400' },
            ].map(({ label, value, icon: Icon, color }) => (
              <div key={label} className="flex items-center gap-3 p-3 border border-border bg-card">
                <Icon className={`w-4 h-4 ${color} shrink-0`} />
                <div className="flex-1">
                  <p className="text-xs font-mono text-muted-foreground">{label}</p>
                  <p className="text-sm font-bold font-mono text-foreground">{value}</p>
                </div>
              </div>
            ))}
          </div>
        </TabsContent>
      </div>
    </Tabs>
  );
}

export default function SkillsPage() {
  const { user } = useAuth();
  const [skills, setSkills] = useState<SkillCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<SkillCard | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [filterStatus, setFilterStatus] = useState<SkillStatus | 'all'>('all');

  // 创建表单
  const [newName, setNewName] = useState('');
  const [newSkillId, setNewSkillId] = useState('');
  const [newEnvType, setNewEnvType] = useState('web_automation');
  const [newPerceptions, setNewPerceptions] = useState('dom, url, title, visible_text, screenshot, console_errors');
  const [newExecutions, setNewExecutions] = useState('click, fill, navigate, screenshot');
  const [newFeedbacks, setNewFeedbacks] = useState('page_redirect, element_change, dialog_popup');
  const [newEnvProfileId, setNewEnvProfileId] = useState<string>('none');
  const [envProfiles, setEnvProfiles] = useState<EnvironmentProfile[]>([]);

  const fetchEnvProfiles = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase.from('environment_profiles').select('*').eq('user_id', user.id).order('created_at', { ascending: false });
    setEnvProfiles(Array.isArray(data) ? data : []);
  }, [user]);

  const fetchSkills = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data } = await supabase.from('skill_cards').select('*').eq('user_id', user.id).order('created_at', { ascending: false });
    setSkills(Array.isArray(data) ? data : []);
    setLoading(false);
  }, [user]);

  // 首次加载
  useEffect(() => { fetchSkills(); fetchEnvProfiles(); }, [fetchSkills, fetchEnvProfiles]);

  // Realtime：skill_cards 表有 INSERT / UPDATE / DELETE 时自动刷新列表
  const { lastChange } = useRealtimeSync({
    tables: ['skill_cards'],
    userId: user?.id,
  });
  useEffect(() => {
    if (lastChange === 0) return;
    fetchSkills();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastChange]);

  const createSkill = async () => {
    if (!user || !newName.trim() || !newSkillId.trim()) {
      toast.error('请填写技能名称和ID');
      return;
    }
    const { error } = await supabase.from('skill_cards').insert({
      skill_id: newSkillId.trim(),
      name: newName.trim(),
      environment_type: newEnvType,
      perception_sources: newPerceptions.split(',').map(s => s.trim()).filter(Boolean),
      execution_surfaces: newExecutions.split(',').map(s => s.trim()).filter(Boolean),
      feedback_surfaces: newFeedbacks.split(',').map(s => s.trim()).filter(Boolean),
      tunable_params: DEFAULT_PARAMS,
      safety: { risk_level: 'low', fallback_action: 'stop', max_action_rate_per_second: 5 },
      metrics: { success_rate: 0, avg_latency_ms: 0, sample_count: 0 },
      status: 'candidate',
      version: '1.0.0',
      environment_profile_id: newEnvProfileId === 'none' ? null : newEnvProfileId,
      user_id: user.id,
    });
    if (error) { toast.error('创建失败: ' + error.message); return; }
    toast.success('技能卡创建成功');
    setCreateOpen(false);
    setNewName(''); setNewSkillId(''); setNewEnvProfileId('none');
    fetchSkills();
  };

  const deleteSkill = async (id: string) => {
    const { error } = await supabase.from('skill_cards').delete().eq('id', id);
    if (error) { toast.error('删除失败'); return; }
    toast.success('技能卡已删除');
    if (selected?.id === id) setSelected(null);
    fetchSkills();
  };

  const filteredSkills = filterStatus === 'all' ? skills : skills.filter(s => s.status === filterStatus);

  return (
    <AppLayout title="技能卡管理">
      <div className="flex h-[calc(100vh-3rem)] overflow-hidden">
        {/* 左侧技能列表 */}
        <div className="w-full md:w-72 shrink-0 flex flex-col border-r border-border overflow-hidden">
          <div className="flex items-center justify-between p-3 border-b border-border">
            <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">技能卡库</span>
            <div className="flex items-center gap-1.5">
              <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground" onClick={fetchSkills}>
                <RefreshCw className="w-3 h-3" />
              </Button>
              <Dialog open={createOpen} onOpenChange={setCreateOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" className="h-6 text-xs font-mono gap-1 bg-primary text-primary-foreground hover:bg-primary/90 px-2">
                    <Plus className="w-3 h-3" />新建
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg bg-card border-border">
                  <DialogHeader>
                    <DialogTitle className="text-sm font-mono text-foreground">创建技能卡</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-3 mt-2">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs font-mono text-muted-foreground">技能名称</Label>
                        <Input value={newName} onChange={e => setNewName(e.target.value)} className="h-8 text-xs font-mono bg-background border-border" placeholder="如：自动填表技能" />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs font-mono text-muted-foreground">技能ID</Label>
                        <Input value={newSkillId} onChange={e => setNewSkillId(e.target.value)} className="h-8 text-xs font-mono bg-background border-border" placeholder="如：web.form_fill.v1" />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-mono text-muted-foreground">环境画像绑定（可选）</Label>
                      <Select value={newEnvProfileId} onValueChange={setNewEnvProfileId}>
                        <SelectTrigger className="h-8 text-xs font-mono bg-background border-border">
                          <SelectValue placeholder="选择环境画像" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none" className="text-xs font-mono">-- 不绑定 --</SelectItem>
                          {envProfiles.map(p => (
                            <SelectItem key={p.id} value={p.id} className="text-xs font-mono">{p.url} ({new Date(p.created_at).toLocaleDateString()})</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-mono text-muted-foreground">环境类型</Label>
                      <Input value={newEnvType} onChange={e => setNewEnvType(e.target.value)} className="h-8 text-xs font-mono bg-background border-border" placeholder="web_automation" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-mono text-muted-foreground">感知面（逗号分隔）</Label>
                      <Input value={newPerceptions} onChange={e => setNewPerceptions(e.target.value)} className="h-8 text-xs font-mono bg-background border-border" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-mono text-muted-foreground">执行面（逗号分隔）</Label>
                      <Input value={newExecutions} onChange={e => setNewExecutions(e.target.value)} className="h-8 text-xs font-mono bg-background border-border" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-mono text-muted-foreground">反馈面（逗号分隔）</Label>
                      <Input value={newFeedbacks} onChange={e => setNewFeedbacks(e.target.value)} className="h-8 text-xs font-mono bg-background border-border" />
                    </div>
                    <div className="flex gap-2 justify-end">
                      <Button variant="outline" size="sm" className="h-8 text-xs font-mono border-border" onClick={() => setCreateOpen(false)}>取消</Button>
                      <Button size="sm" className="h-8 text-xs font-mono bg-primary text-primary-foreground hover:bg-primary/90" onClick={createSkill}>创建</Button>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </div>

          {/* 状态筛选 */}
          <div className="px-2 py-2 border-b border-border overflow-x-auto">
            <div className="flex gap-1 min-w-max">
              <button
                onClick={() => setFilterStatus('all')}
                className={`text-xs font-mono px-2 py-0.5 border transition-colors whitespace-nowrap ${filterStatus === 'all' ? 'border-primary/60 text-primary bg-primary/10' : 'border-border text-muted-foreground hover:border-border/60'}`}
              >
                全部 ({skills.length})
              </button>
              {SKILL_STATUS_LIST.filter(s => s !== 'deprecated').map(s => {
                const count = skills.filter(sk => sk.status === s).length;
                return count > 0 ? (
                  <button
                    key={s}
                    onClick={() => setFilterStatus(s)}
                    className={`text-xs font-mono px-2 py-0.5 border transition-colors whitespace-nowrap status-${s} ${filterStatus === s ? 'opacity-100' : 'opacity-60 hover:opacity-80'}`}
                  >
                    {SKILL_STATUS_LABELS[s]} ({count})
                  </button>
                ) : null;
              })}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {loading ? (
              [...Array(4)].map((_, i) => <Skeleton key={i} className="h-16 bg-muted" />)
            ) : filteredSkills.length === 0 ? (
              <div className="text-center py-8">
                <Layers className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-xs text-muted-foreground font-mono">暂无技能卡</p>
              </div>
            ) : (
              filteredSkills.map(skill => {
                const isSelected = selected?.id === skill.id;
                return (
                  <button
                    key={skill.id}
                    className={`w-full text-left p-2.5 border transition-colors ${isSelected ? 'border-primary/60 bg-primary/5' : 'border-border hover:bg-accent'}`}
                    onClick={() => setSelected(skill)}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <Activity className={`w-3 h-3 shrink-0 ${skill.status === 'gray_matter' || skill.status === 'mature' || skill.status === 'universal' ? 'text-primary' : 'text-muted-foreground'}`} />
                      <span className="text-xs font-semibold font-mono text-foreground flex-1 truncate">{skill.name}</span>
                    </div>
                    <p className="text-xs text-muted-foreground font-mono truncate pl-5">{skill.skill_id}</p>
                    <div className="flex items-center gap-2 mt-1 pl-5">
                      <SkillStatusBadge status={skill.status} />
                      <span className="text-xs text-muted-foreground font-mono">v{skill.version}</span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* 右侧详情 */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          {!selected ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <Layers className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                <p className="text-sm font-mono text-muted-foreground">选择左侧技能卡查看详情</p>
                <p className="text-xs text-muted-foreground font-mono mt-1">技能卡是灰质层的基本资产单位</p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col h-full overflow-hidden">
              {/* 技能卡标题 */}
              <div className="flex items-center gap-3 px-4 py-3 border-b border-border shrink-0">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h1 className="text-sm font-bold font-mono text-foreground text-balance">{selected.name}</h1>
                    <SkillStatusBadge status={selected.status} />
                    <span className="text-xs font-mono text-muted-foreground border border-border px-1.5">v{selected.version}</span>
                  </div>
                  <p className="text-xs font-mono text-muted-foreground mt-0.5">{selected.skill_id}</p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0 text-muted-foreground hover:text-red-400 shrink-0"
                  onClick={() => deleteSkill(selected.id)}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
              <div className="flex-1 overflow-hidden">
                <SkillDetail
                  skill={selected}
                  onUpdated={() => {
                    fetchSkills();
                    // 重新获取最新技能卡数据
                    supabase.from('skill_cards').select('*').eq('id', selected.id).maybeSingle().then(({ data }) => {
                      if (data) setSelected(data);
                    });
                  }}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
