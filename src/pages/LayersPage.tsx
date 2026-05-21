import { useEffect, useState } from 'react';
import AppLayout from '@/components/layouts/AppLayout';
import { supabase } from '@/db/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import type { Task, SkillCard, TaskRun } from '@/types/types';
import {
  Brain, Zap, Activity, Shield, Database, Cpu, Target,
  CheckCircle, XCircle, Clock, ArrowDown, TrendingUp,
} from 'lucide-react';

interface LayerStat {
  skills: number;
  tasks: number;
  runs: number;
  successRate: number;
  avgLatency: number;
}

export default function LayersPage() {
  const { user } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [skills, setSkills] = useState<SkillCard[]>([]);
  const [runs, setRuns] = useState<TaskRun[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    const load = async () => {
      setLoading(true);
      const [{ data: t }, { data: s }, { data: r }] = await Promise.all([
        supabase.from('tasks').select('*').eq('user_id', user.id),
        supabase.from('skill_cards').select('*').eq('user_id', user.id),
        supabase.from('task_runs').select('*').eq('user_id', user.id).order('started_at', { ascending: false }).limit(50),
      ]);
      setTasks(Array.isArray(t) ? t : []);
      setSkills(Array.isArray(s) ? s : []);
      setRuns(Array.isArray(r) ? r : []);
      setLoading(false);
    };
    load();
  }, [user]);

  const graySkills = skills.filter(s => ['gray_matter', 'mature', 'universal'].includes(s.status));
  const whiteTaskCount = tasks.length;
  const totalRuns = runs.length;
  const successRuns = runs.filter(r => r.status === 'success').length;
  const successRate = totalRuns > 0 ? Math.round(successRuns / totalRuns * 100) : 0;
  const avgLatency = graySkills.length > 0
    ? Math.round(graySkills.reduce((a, s) => a + (s.metrics?.avg_latency_ms || 0), 0) / graySkills.length)
    : 0;

  // 灰质层最近5次执行
  const recentRuns = runs.slice(0, 5);

  // 白质层最近5个任务
  const recentTasks = tasks.slice(0, 5);

  const LAYERS = [
    {
      id: 'meta',
      icon: Target,
      label: '元目标层',
      subtitle: 'Meta-Goal Layer',
      color: 'text-purple-400',
      border: 'border-purple-400/40',
      bg: 'bg-purple-400/5',
      glow: 'shadow-[0_0_20px_hsl(270_68%_62%/0.15)]',
      description: '元驱动系统：生存性 · 安全性 · 效率 · 适应性 · 技能沉淀',
      stats: [
        { label: '综合成功率', value: `${successRate}%` },
        { label: '活跃技能', value: graySkills.length },
        { label: '总任务', value: whiteTaskCount },
      ],
    },
    {
      id: 'white',
      icon: Brain,
      label: '白质层',
      subtitle: 'White Matter Layer — Slow Reasoning',
      color: 'text-blue-400',
      border: 'border-blue-400/40',
      bg: 'bg-blue-400/5',
      glow: 'shadow-[0_0_20px_hsl(217_91%_60%/0.15)]',
      description: '慢速推理系统：任务规划 · 失败解释 · 工具生成 · 技能编译',
      stats: [
        { label: '规划任务数', value: whiteTaskCount },
        { label: '成功执行', value: successRuns },
        { label: '失败分析', value: runs.filter(r => r.status === 'failed').length },
      ],
    },
    {
      id: 'bootstrap',
      icon: Cpu,
      label: '自举层',
      subtitle: 'Bootstrap Layer — Capability Discovery',
      color: 'text-yellow-400',
      border: 'border-yellow-400/40',
      bg: 'bg-yellow-400/5',
      glow: 'shadow-[0_0_20px_hsl(38_95%_55%/0.15)]',
      description: '环境能力发现：感知面 · 执行面 · 反馈面 · 适配器生成',
      stats: [
        { label: '已扫描环境', value: skills.map(s => s.environment_type).filter((v, i, a) => a.indexOf(v) === i).length },
        { label: '感知面', value: graySkills.reduce((a, s) => a + s.perception_sources.length, 0) },
        { label: '执行面', value: graySkills.reduce((a, s) => a + s.execution_surfaces.length, 0) },
      ],
    },
    {
      id: 'gray',
      icon: Zap,
      label: '灰质层',
      subtitle: 'Gray Matter Layer — Fast Execution',
      color: 'text-primary',
      border: 'border-primary/40',
      bg: 'bg-primary/5',
      glow: 'shadow-[0_0_20px_hsl(151_85%_41%/0.15)]',
      description: '低延迟执行系统：技能卡快速调用 · 自动化本能 · 规则表/行为树',
      stats: [
        { label: '灰质技能', value: graySkills.length },
        { label: '平均延迟', value: `${avgLatency}ms` },
        { label: '总技能', value: skills.length },
      ],
    },
    {
      id: 'safety',
      icon: Shield,
      label: '安全层',
      subtitle: 'Safety Layer — Risk Control',
      color: 'text-red-400',
      border: 'border-red-400/40',
      bg: 'bg-red-400/5',
      glow: 'shadow-[0_0_20px_hsl(0_72%_51%/0.15)]',
      description: '风险控制：权限验证 · 风险分级 · 沙盒测试 · 动作拦截 · 回滚机制',
      stats: [
        { label: '沙盒技能', value: skills.filter(s => s.status === 'sandbox').length },
        { label: '低风险技能', value: skills.filter(s => s.safety?.risk_level === 'low').length },
        { label: '安全评分', value: `${successRate}%` },
      ],
    },
    {
      id: 'memory',
      icon: Database,
      label: '海马层',
      subtitle: 'Hippocampus Layer — Episodic Memory',
      color: 'text-indigo-400',
      border: 'border-indigo-400/40',
      bg: 'bg-indigo-400/5',
      glow: 'shadow-[0_0_20px_hsl(239_68%_64%/0.15)]',
      description: '结构化记忆：情节记录 · 失败片段 · 成功轨迹 · 参数补丁',
      stats: [
        { label: '执行记录', value: totalRuns },
        { label: '成功轨迹', value: successRuns },
        { label: '失败片段', value: runs.filter(r => r.status === 'failed').length },
      ],
    },
  ];

  return (
    <AppLayout title="灰质/白质层状态可视化">
      <div className="p-4 md:p-6 space-y-6">
        {/* 说明标题 */}
        <div className="p-4 border border-border bg-card">
          <h2 className="text-sm font-semibold font-mono text-foreground mb-1 text-balance">双速认知架构 — 灰质与白质的协同进化</h2>
          <p className="text-xs font-mono text-muted-foreground leading-relaxed">
            白质层（慢）发现问题 → 自举层提取能力 → 灰质层（快）执行任务 → 海马层记录经验 → 元目标层驱动整体持续优化
          </p>
        </div>

        {/* 架构流图 */}
        <div className="relative">
          <div className="space-y-1">
            {LAYERS.map((layer, idx) => {
              const Icon = layer.icon;
              return (
                <div key={layer.id}>
                  <div className={`border ${layer.border} ${layer.bg} ${layer.glow} p-4`}>
                    <div className="flex items-start gap-4">
                      <div className={`w-10 h-10 flex items-center justify-center border ${layer.border} ${layer.bg} shrink-0`}>
                        <Icon className={`w-5 h-5 ${layer.color}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-0.5">
                          <span className={`text-sm font-bold font-mono ${layer.color}`}>{layer.label}</span>
                          <span className="text-xs font-mono text-muted-foreground">{layer.subtitle}</span>
                        </div>
                        <p className="text-xs font-mono text-muted-foreground">{layer.description}</p>
                        <div className="flex items-center gap-4 mt-2 flex-wrap">
                          {loading ? (
                            layer.stats.map((_, i) => <Skeleton key={i} className="h-5 w-16 bg-muted" />)
                          ) : (
                            layer.stats.map(stat => (
                              <div key={stat.label} className="flex items-center gap-1.5">
                                <span className="text-xs font-mono text-muted-foreground">{stat.label}:</span>
                                <span className={`text-xs font-bold font-mono ${layer.color}`}>{stat.value}</span>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                  {idx < LAYERS.length - 1 && (
                    <div className="flex justify-center py-0.5">
                      <ArrowDown className="w-3.5 h-3.5 text-muted-foreground/40" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* 双列：灰质 vs 白质 实时状态 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* 白质层任务队列 */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Brain className="w-4 h-4 text-blue-400" />
              <h3 className="text-xs font-semibold font-mono text-blue-400 uppercase tracking-wider">白质层 — 任务规划队列</h3>
            </div>
            <div className="border border-blue-400/30 bg-blue-400/5 p-3 space-y-2">
              {loading ? (
                [...Array(3)].map((_, i) => <Skeleton key={i} className="h-10 bg-muted" />)
              ) : recentTasks.length === 0 ? (
                <p className="text-xs font-mono text-muted-foreground text-center py-4">暂无任务</p>
              ) : (
                recentTasks.map(task => {
                  const statusIcons = { pending: Clock, running: Activity, success: CheckCircle, failed: XCircle };
                  const StatusIcon = statusIcons[task.status];
                  return (
                    <div key={task.id} className="flex items-center gap-2 p-2 border border-blue-400/20 bg-background">
                      <StatusIcon className={`w-3.5 h-3.5 shrink-0 ${task.status === 'success' ? 'text-primary' : task.status === 'failed' ? 'text-red-400' : task.status === 'running' ? 'text-blue-400' : 'text-muted-foreground'}`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-mono text-foreground truncate">{task.name}</p>
                        <p className="text-xs font-mono text-muted-foreground truncate">{task.target_url}</p>
                      </div>
                      <span className="text-xs font-mono text-muted-foreground shrink-0">{task.steps_json.length}步</span>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* 灰质层执行流 */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Zap className="w-4 h-4 text-primary" />
              <h3 className="text-xs font-semibold font-mono text-primary uppercase tracking-wider">灰质层 — 执行结果流</h3>
            </div>
            <div className="border border-primary/30 bg-primary/5 p-3 space-y-2">
              {loading ? (
                [...Array(3)].map((_, i) => <Skeleton key={i} className="h-10 bg-muted" />)
              ) : recentRuns.length === 0 ? (
                <p className="text-xs font-mono text-muted-foreground text-center py-4">暂无执行记录</p>
              ) : (
                recentRuns.map(run => (
                  <div key={run.id} className="flex items-center gap-2 p-2 border border-primary/20 bg-background">
                    {run.status === 'success'
                      ? <CheckCircle className="w-3.5 h-3.5 text-primary shrink-0" />
                      : run.status === 'failed'
                      ? <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                      : <Activity className="w-3.5 h-3.5 text-blue-400 shrink-0 animate-spin" />}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-mono text-foreground truncate">
                        {run.status === 'success' ? '执行完成' : run.status === 'failed' ? '执行失败' : '执行中'}
                      </p>
                      <p className="text-xs font-mono text-muted-foreground">
                        {new Date(run.started_at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                    <span className="text-xs font-mono text-muted-foreground shrink-0">
                      {run.duration_ms ? `${run.duration_ms}ms` : '--'}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* 技能卡生命周期分布 */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="w-4 h-4 text-yellow-400" />
            <h3 className="text-xs font-semibold font-mono text-yellow-400 uppercase tracking-wider">技能卡生命周期分布</h3>
          </div>
          <Card className="bg-card border-border">
            <CardContent className="p-4">
              {loading ? (
                <Skeleton className="h-8 w-full bg-muted" />
              ) : skills.length === 0 ? (
                <p className="text-xs font-mono text-muted-foreground text-center py-4">暂无技能卡数据</p>
              ) : (
                <div className="space-y-3">
                  {[
                    { status: 'candidate', label: '候选', color: 'bg-yellow-400' },
                    { status: 'temporary', label: '临时', color: 'bg-orange-400' },
                    { status: 'sandbox', label: '沙盒验证', color: 'bg-blue-400' },
                    { status: 'gray_matter', label: '灰质', color: 'bg-primary' },
                    { status: 'mature', label: '成熟', color: 'bg-emerald-400' },
                    { status: 'universal', label: '通用', color: 'bg-purple-400' },
                  ].map(({ status, label, color }) => {
                    const count = skills.filter(s => s.status === status).length;
                    const pct = skills.length > 0 ? (count / skills.length) * 100 : 0;
                    return (
                      <div key={status} className="flex items-center gap-3">
                        <span className="text-xs font-mono text-muted-foreground w-16 shrink-0">{label}</span>
                        <div className="flex-1 h-3 bg-muted">
                          <div className={`h-3 ${color} transition-all duration-700`} style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-xs font-mono text-foreground w-8 text-right shrink-0">{count}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </AppLayout>
  );
}
