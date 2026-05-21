import { useEffect, useState, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip as RechartsTooltip,
  CartesianGrid, ReferenceLine, BarChart, Bar, Legend,
} from 'recharts';
import AppLayout from '@/components/layouts/AppLayout';
import { supabase } from '@/db/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useRealtimeSync } from '@/hooks/use-realtime-sync';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import type { Task, TaskRun, SkillCard, SkillStatus, TaskStatus } from '@/types/types';
import {
  Brain, Zap, Shield, Database, Cpu, Activity,
  CheckCircle, XCircle, Clock, TrendingUp, Layers,
  Target, BarChart3, AlertTriangle, ListTodo, GitBranch,
} from 'lucide-react';

const SKILL_STATUS_LABELS: Record<SkillStatus, string> = {
  candidate: '候选', temporary: '临时', sandbox: '沙盒验证',
  gray_matter: '灰质', mature: '成熟', universal: '通用', deprecated: '废弃',
};

/** 系统架构层定义（含在线状态字段） */
const LAYER_DEFS = [
  {
    key: 'meta',     icon: Target,    label: '元目标层',   desc: '生存·安全·效率·适应·技能沉淀',
    color: 'text-purple-400', bg: 'bg-purple-400/10', border: 'border-purple-400/30',
    dotColor: 'bg-purple-400',
  },
  {
    key: 'white',    icon: Brain,     label: '白质层',     desc: '推理·规划·失败解释·工具生成',
    color: 'text-blue-400',   bg: 'bg-blue-400/10',   border: 'border-blue-400/30',
    dotColor: 'bg-blue-400',
  },
  {
    key: 'bootstrap', icon: Cpu,      label: '自举层',     desc: '感知面·执行面·反馈面发现',
    color: 'text-yellow-400', bg: 'bg-yellow-400/10', border: 'border-yellow-400/30',
    dotColor: 'bg-yellow-400',
  },
  {
    key: 'compiler', icon: Zap,       label: '灰质编译层', desc: '规则表·行为树·脚本·API封装',
    color: 'text-orange-400', bg: 'bg-orange-400/10', border: 'border-orange-400/30',
    dotColor: 'bg-orange-400',
  },
  {
    key: 'gray',     icon: Activity,  label: '灰质层',     desc: '低延迟技能卡·快速动作·自动化本能',
    color: 'text-primary',    bg: 'bg-primary/10',    border: 'border-primary/30',
    dotColor: 'bg-primary',
  },
  {
    key: 'safety',   icon: Shield,    label: '安全层',     desc: '权限控制·风险分级·沙盒·回滚',
    color: 'text-red-400',    bg: 'bg-red-400/10',    border: 'border-red-400/30',
    dotColor: 'bg-red-400',
  },
  {
    key: 'memory',   icon: Database,  label: '海马层',     desc: '经验记录·失败片段·成功轨迹',
    color: 'text-indigo-400', bg: 'bg-indigo-400/10', border: 'border-indigo-400/30',
    dotColor: 'bg-indigo-400',
  },
];

const TASK_STATUS_MAP: Record<TaskStatus, { label: string; icon: React.ElementType; cls: string }> = {
  pending:  { label: '等待',  icon: Clock,        cls: 'task-pending' },
  running:  { label: '运行中', icon: Activity,    cls: 'task-running' },
  success:  { label: '成功',  icon: CheckCircle,  cls: 'task-success' },
  failed:   { label: '失败',  icon: XCircle,      cls: 'task-failed'  },
};

/** 径向进度环 SVG 组件 */
function RadialProgress({
  value,
  color,
  icon: Icon,
  label,
  loading,
}: {
  value: number;
  color: string;
  icon: React.ElementType;
  label: string;
  loading: boolean;
}) {
  const r = 28;
  const circ = 2 * Math.PI * r;          // ≈175.9
  const offset = circ * (1 - value / 100);

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative w-20 h-20">
        <svg className="w-full h-full -rotate-90" viewBox="0 0 72 72">
          {/* 背景轨道 */}
          <circle cx="36" cy="36" r={r} fill="none" strokeWidth="4" className="stroke-muted" />
          {/* 进度弧 */}
          {!loading && (
            <circle
              cx="36" cy="36" r={r} fill="none" strokeWidth="4"
              stroke={`hsl(var(${color}))`}
              strokeLinecap="butt"
              strokeDasharray={circ}
              strokeDashoffset={offset}
              style={{ animation: 'dash-fill 0.8s ease-out forwards', transition: 'stroke-dashoffset 0.6s ease' }}
            />
          )}
        </svg>
        {/* 中心图标 + 数值 */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          {loading
            ? <Skeleton className="w-8 h-4 bg-muted" />
            : <span className="text-sm font-bold font-mono text-foreground leading-none">{value}%</span>
          }
          <Icon className={`w-3 h-3 mt-0.5 ${color === '--primary' ? 'text-primary' : ''}`} style={{ color: `hsl(var(${color}))` }} />
        </div>
      </div>
      <span className="text-xs font-mono text-muted-foreground">{label}</span>
    </div>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [recentRuns, setRecentRuns] = useState<(TaskRun & { task?: Task })[]>([]);
  const [weekRuns, setWeekRuns] = useState<TaskRun[]>([]);
  const [skills, setSkills] = useState<SkillCard[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const [{ data: t }, { data: r }, { data: w }, { data: s }] = await Promise.all([
      supabase.from('tasks').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(20),
      supabase.from('task_runs').select('*, task:tasks(id,name,target_url)').eq('user_id', user.id).order('started_at', { ascending: false }).limit(10),
      supabase.from('task_runs').select('id,status,started_at').eq('user_id', user.id).gte('started_at', weekAgo).order('started_at', { ascending: true }),
      supabase.from('skill_cards').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(50),
    ]);
    setTasks(Array.isArray(t) ? t : []);
    setRecentRuns(Array.isArray(r) ? r : []);
    setWeekRuns((Array.isArray(w) ? w : []) as TaskRun[]);
    setSkills(Array.isArray(s) ? s : []);
    setLoading(false);
  }, [user]);

  // 首次加载
  useEffect(() => { load(); }, [load]);

  // Realtime 订阅 task_runs + tasks：有任何变更时重新拉取看板数据
  const { lastChange } = useRealtimeSync({
    tables: ['task_runs', 'tasks'],
    userId: user?.id,
  });
  useEffect(() => {
    if (lastChange === 0) return; // 跳过初始值
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastChange]);

  /* ── 近7天每日成功率折线数据 ── */
  const trendData = useMemo(() => {
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (6 - i));
      return {
        label: `${d.getMonth() + 1}/${d.getDate()}`,
        date:  d.toISOString().slice(0, 10),
      };
    });
    return days.map(({ label, date }) => {
      const dayRuns = weekRuns.filter(r => r.started_at.slice(0, 10) === date);
      const total   = dayRuns.length;
      const success = dayRuns.filter(r => r.status === 'success').length;
      const failed  = dayRuns.filter(r => r.status === 'failed').length;
      return {
        date:   label,
        rate:   total > 0 ? Math.round((success / total) * 100) : null,
        total,
        failed,
      };
    });
  }, [weekRuns]);


  /* ── 计算元目标分 ── */
  const totalTasks = tasks.length;
  const taskSuccessRate = totalTasks > 0
    ? Math.round(tasks.reduce((a, t) => a + (t.run_count > 0 ? t.success_count / t.run_count : 0), 0) / totalTasks * 100)
    : 0;
  const skillsByStatus = skills.reduce<Record<string, number>>((acc, s) => {
    acc[s.status] = (acc[s.status] || 0) + 1;
    return acc;
  }, {});
  const avgLatency = skills.length > 0
    ? Math.round(skills.reduce((a, s) => a + (s.metrics?.avg_latency_ms || 0), 0) / skills.length)
    : 0;
  const safetyScore = recentRuns.length > 0
    ? Math.round(recentRuns.filter(r => r.status !== 'failed').length / recentRuns.length * 100)
    : 100;

  const metaGoals = [
    { label: '成功率', value: taskSuccessRate, icon: CheckCircle, color: '--primary' },
    { label: '执行效率', value: avgLatency > 0 ? Math.max(0, 100 - Math.round(avgLatency / 50)) : 100, icon: Zap, color: '--warning' },
    { label: '适应性', value: Math.min(100, skills.length * 10), icon: TrendingUp, color: '--info' },
    { label: '安全性', value: safetyScore, icon: Shield, color: '--destructive' },
  ] as const;

  /* 架构层活跃状态（有数据=活跃） */
  const layerActive: Record<string, boolean> = {
    gray:      skills.filter(s => ['gray_matter', 'mature', 'universal'].includes(s.status)).length > 0,
    white:     tasks.length > 0,
    memory:    recentRuns.length > 0,
    meta:      true,
    compiler:  skills.length > 0,
    bootstrap: true,
    safety:    true,
  };

  return (
    <AppLayout title="仪表盘">
      <div className="p-4 md:p-6 space-y-6">

        {/* ── 元目标评分（进度环） ── */}
        <div>
          <h2 className="section-title mb-4">元目标评分面板</h2>
          <Card className="bg-card border-border">
            <CardContent className="p-6">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-6 justify-items-center">
                {metaGoals.map(({ label, value, icon, color }) => (
                  <RadialProgress
                    key={label}
                    value={value}
                    color={color}
                    icon={icon}
                    label={label}
                    loading={loading}
                  />
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ── 系统架构可视化 ── */}
        <div>
          <h2 className="section-title mb-4">系统架构 — 双速认知结构</h2>
          <Card className="bg-card border-border">
            <CardContent className="p-4">
              <div className="space-y-1.5">
                {LAYER_DEFS.map(({ key, icon: Icon, label, desc, color, bg, border, dotColor }) => {
                  const active = layerActive[key] ?? false;
                  return (
                    <div key={key} className={`flex items-center gap-3 p-2.5 border ${border} ${bg} transition-all`}>
                      <Icon className={`w-4 h-4 shrink-0 ${color}`} />
                      <div className="flex-1 min-w-0">
                        <span className={`text-xs font-semibold font-mono ${color}`}>{label}</span>
                        <span className="text-xs text-muted-foreground font-mono ml-2 hidden md:inline">{desc}</span>
                      </div>
                      {/* 活跃状态指示灯 */}
                      <div className="flex items-center gap-1.5 shrink-0">
                        <div
                          className={`w-1.5 h-1.5 rounded-full ${dotColor} ${active ? 'animate-pulse' : 'opacity-25'}`}
                        />
                        <span className={`text-xs font-mono ${active ? color : 'text-muted-foreground/40'}`}>
                          {active ? '活跃' : '待机'}
                        </span>
                      </div>
                      <div className={`text-xs font-mono ${color} shrink-0 opacity-60 hidden md:block`}>
                        {key === 'gray'   ? `${skills.filter(s => ['gray_matter','mature','universal'].includes(s.status)).length} 技能` :
                         key === 'white'  ? `${tasks.length} 任务` :
                         key === 'memory' ? `${recentRuns.length} 记录` : ''}
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground font-mono mt-3 text-center">
                白质层制造灰质层 · 灰质层释放白质层 · 元目标层驱动二者共同进化
              </p>
            </CardContent>
          </Card>
        </div>


        {/* ── 近7天数据分析：折线 + 柱状 ── */}
        <div>
          <h2 className="section-title mb-4">近7天执行数据分析</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

            {/* 左：成功率折线图 */}
            <Card className="bg-card border-border h-full">
              <CardContent className="p-4">
                <p className="text-xs font-mono text-muted-foreground mb-3">成功率趋势</p>
                {loading ? (
                  <Skeleton className="w-full h-40 bg-muted" />
                ) : weekRuns.length === 0 ? (
                  <div className="h-40 flex flex-col items-center justify-center gap-2">
                    <BarChart3 className="w-7 h-7 text-muted-foreground/40" />
                    <p className="text-xs font-mono text-muted-foreground">暂无执行记录</p>
                  </div>
                ) : (
                  <div className="w-full min-w-0 overflow-hidden" style={{ height: 160 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={trendData} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                        <XAxis
                          dataKey="date"
                          tick={{ fontSize: 10, fontFamily: 'monospace', fill: 'hsl(var(--muted-foreground))' }}
                          axisLine={false} tickLine={false}
                        />
                        <YAxis
                          domain={[0, 100]}
                          tickFormatter={(v) => `${v}%`}
                          tick={{ fontSize: 10, fontFamily: 'monospace', fill: 'hsl(var(--muted-foreground))' }}
                          axisLine={false} tickLine={false}
                          ticks={[0, 50, 100]}
                        />
                        <ReferenceLine
                          y={80}
                          stroke="hsl(var(--primary))"
                          strokeDasharray="4 4"
                          strokeOpacity={0.4}
                          label={{ value: '80%', position: 'insideTopRight', fontSize: 10, fontFamily: 'monospace', fill: 'hsl(var(--primary))' }}
                        />
                        <RechartsTooltip
                          contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 0, fontSize: 11, fontFamily: 'monospace', color: 'hsl(var(--foreground))' }}
                          formatter={(value: unknown, _: string, props: { payload?: { total: number } }) => {
                            if (value === null || value === undefined) return ['无数据', '成功率'];
                            return [`${value}%（${props.payload?.total ?? 0} 次）`, '成功率'];
                          }}
                          cursor={{ stroke: 'hsl(var(--primary))', strokeWidth: 1, strokeDasharray: '3 3' }}
                        />
                        <Line
                          type="monotone" dataKey="rate"
                          stroke="hsl(var(--primary))" strokeWidth={2}
                          dot={{ r: 3, fill: 'hsl(var(--primary))', strokeWidth: 0 }}
                          activeDot={{ r: 5, fill: 'hsl(var(--primary))', strokeWidth: 0 }}
                          connectNulls={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* 右：执行总数 vs 失败次数柱状图 */}
            <Card className="bg-card border-border h-full">
              <CardContent className="p-4">
                <p className="text-xs font-mono text-muted-foreground mb-3">执行次数对比</p>
                {loading ? (
                  <Skeleton className="w-full h-40 bg-muted" />
                ) : weekRuns.length === 0 ? (
                  <div className="h-40 flex flex-col items-center justify-center gap-2">
                    <BarChart3 className="w-7 h-7 text-muted-foreground/40" />
                    <p className="text-xs font-mono text-muted-foreground">暂无执行记录</p>
                  </div>
                ) : (
                  <div className="w-full min-w-0 overflow-hidden" style={{ height: 160 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={trendData} margin={{ top: 6, right: 8, left: -18, bottom: 0 }} barCategoryGap="30%">
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                        <XAxis
                          dataKey="date"
                          tick={{ fontSize: 10, fontFamily: 'monospace', fill: 'hsl(var(--muted-foreground))' }}
                          axisLine={false} tickLine={false}
                        />
                        <YAxis
                          allowDecimals={false}
                          tick={{ fontSize: 10, fontFamily: 'monospace', fill: 'hsl(var(--muted-foreground))' }}
                          axisLine={false} tickLine={false}
                        />
                        <RechartsTooltip
                          contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 0, fontSize: 11, fontFamily: 'monospace', color: 'hsl(var(--foreground))' }}
                          cursor={{ fill: 'hsl(var(--muted) / 0.4)' }}
                        />
                        <Legend
                          wrapperStyle={{ fontSize: 10, fontFamily: 'monospace', paddingTop: 6 }}
                          formatter={(value) => value === 'total' ? '总次数' : '失败次数'}
                          layout="horizontal"
                        />
                        <Bar dataKey="total"  name="total"  fill="hsl(var(--primary) / 0.5)"  radius={[2, 2, 0, 0]} maxBarSize={20} />
                        <Bar dataKey="failed" name="failed" fill="hsl(var(--destructive) / 0.7)" radius={[2, 2, 0, 0]} maxBarSize={20} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>

          </div>
        </div>


        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* ── 技能库统计 ── */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="section-title">技能库统计</h2>
              <Link to="/skills" className="text-xs text-primary font-mono hover:underline">查看全部</Link>
            </div>
            <Card className="bg-card border-border h-full">
              <CardContent className="p-4">
                {loading ? (
                  <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-8 bg-muted" />)}</div>
                ) : skills.length === 0 ? (
                  <div className="text-center py-8">
                    <Layers className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                    <p className="text-xs text-muted-foreground font-mono mb-1">暂无技能卡</p>
                    <Link to="/skills" className="text-xs text-primary font-mono hover:underline">创建第一个技能卡</Link>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between py-1 border-b border-border">
                      <span className="text-xs font-mono text-muted-foreground">技能卡总数</span>
                      <span className="text-sm font-bold font-mono text-foreground">{skills.length}</span>
                    </div>
                    {(Object.keys(SKILL_STATUS_LABELS) as SkillStatus[])
                      .filter(s => (skillsByStatus[s] || 0) > 0)
                      .map(status => (
                        <div key={status} className="flex items-center justify-between py-1">
                          <span className={`text-xs font-mono px-2 py-0.5 border status-${status}`}>
                            {SKILL_STATUS_LABELS[status]}
                          </span>
                          <span className="text-xs font-mono text-foreground">{skillsByStatus[status]}</span>
                        </div>
                      ))
                    }
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* ── 最近执行记录 ── */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="section-title">最近执行记录</h2>
              <Link to="/tasks" className="text-xs text-primary font-mono hover:underline">查看全部</Link>
            </div>
            <Card className="bg-card border-border h-full">
              <CardContent className="p-4">
                {loading ? (
                  <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10 bg-muted" />)}</div>
                ) : recentRuns.length === 0 ? (
                  <div className="text-center py-8">
                    <BarChart3 className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                    <p className="text-xs text-muted-foreground font-mono mb-1">暂无执行记录</p>
                    <Link to="/tasks" className="text-xs text-primary font-mono hover:underline">创建第一个任务</Link>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {recentRuns.map((run) => {
                      const sm = TASK_STATUS_MAP[run.status];
                      const Icon = sm.icon;
                      return (
                        <div key={run.id} className="flex items-center gap-2 py-1.5 border-b border-border last:border-0">
                          <Icon className={`w-3.5 h-3.5 shrink-0 ${
                            run.status === 'success' ? 'text-primary' :
                            run.status === 'failed'  ? 'text-red-400'  :
                            run.status === 'running' ? 'text-blue-400' : 'text-muted-foreground'}`} />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-mono text-foreground truncate">{run.task?.name || '未知任务'}</p>
                            <p className="text-xs text-muted-foreground font-mono">
                              {new Date(run.started_at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                            </p>
                          </div>
                          <span className={`text-xs font-mono px-1.5 py-0.5 border shrink-0 task-${run.status}`}>{sm.label}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        {/* ── 快速操作（card-interactive 动效） ── */}
        <div>
          <h2 className="section-title mb-4">快速操作</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { to: '/tasks',    icon: ListTodo, label: '创建任务',   desc: '配置自动化流程',   color: 'text-primary' },
              { to: '/skills',   icon: Layers,   label: '管理技能卡', desc: '灰质层技能库',    color: 'text-blue-400' },
              { to: '/bootstrap', icon: Cpu,     label: '环境自举',   desc: '发现执行能力',   color: 'text-yellow-400' },
              { to: '/security', icon: Shield,   label: '安全监控',   desc: '查看风险日志',   color: 'text-red-400' },
            ].map(({ to, icon: Icon, label, desc, color }) => (
              <Link key={to} to={to} className="card-interactive block">
                <Card className="bg-card border-border h-full">
                  <CardContent className="p-4 flex flex-col items-start gap-2">
                    <Icon className={`w-5 h-5 ${color}`} />
                    <div>
                      <p className="text-xs font-semibold font-mono text-foreground">{label}</p>
                      <p className="text-xs text-muted-foreground font-mono">{desc}</p>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </div>

      </div>
    </AppLayout>
  );
}
