import { useEffect, useState } from 'react';
import AppLayout from '@/components/layouts/AppLayout';
import { supabase } from '@/db/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { MemoryEpisode, EpisodeType } from '@/types/types';
import ReasoningCompare, { EvolutionChart } from '@/components/white-matter/ReasoningCompare';
import EpisodeDetail from '@/components/memory/EpisodeDetail';
import {
  Database, CheckCircle, XCircle, Activity, Wrench, Search, RefreshCw,
  ChevronDown, ChevronUp, Link, Brain, Tag, BarChart2, RotateCcw, TrendingUp,
} from 'lucide-react';

const EPISODE_TYPE_LABELS: Record<EpisodeType, string> = {
  episode: '事件', failure: '失败', success: '成功', parameter_patch: '参数补丁',
  patch_evaluation: '补丁评估', rollback_applied: '回滚执行',
  environment_bootstrap: '环境自举', skill_compilation: '技能编译',
};

const EPISODE_TYPE_ICONS: Record<EpisodeType, React.ElementType> = {
  episode: Activity, failure: XCircle, success: CheckCircle, parameter_patch: Wrench,
  patch_evaluation: BarChart2, rollback_applied: RotateCcw,
  environment_bootstrap: Database, skill_compilation: Wrench,
};

// ── episode 类型对应的展开区标题 ─────────────────────────
const DETAIL_TITLES: Record<EpisodeType, string> = {
  failure: '失败片段详情',
  success: '成功轨迹回放',
  parameter_patch: '参数补丁详情',
  patch_evaluation: '补丁效果评估',
  episode: '记录详情',
  rollback_applied: '回滚执行详情',
  environment_bootstrap: '环境自举详情',
  skill_compilation: '技能编译详情',
};

function getDetailTitle(ep: MemoryEpisode): string {
  if (ep.type === 'failure' && ep.tags.includes('white_matter')) return '失败片段详情（白质层分析）';
  if (ep.type === 'episode' && ep.tags.includes('env_profile')) return '环境能力画像';
  return DETAIL_TITLES[ep.type] ?? '记录详情';
}

export default function MemoryPage() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<'records' | 'compare' | 'evolution'>('records');
  const [episodes, setEpisodes] = useState<MemoryEpisode[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState<EpisodeType | 'all'>('all');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const fetchEpisodes = async () => {
    if (!user) return;
    setLoading(true);
    let q = supabase.from('memory_episodes').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(100);
    if (filterType !== 'all') q = q.eq('type', filterType);
    const { data } = await q;
    setEpisodes(Array.isArray(data) ? data : []);
    setLoading(false);
  };

  useEffect(() => { fetchEpisodes(); }, [user, filterType]);

  const filtered = search
    ? episodes.filter(e => e.title.toLowerCase().includes(search.toLowerCase()) || e.tags.some(t => t.includes(search)))
    : episodes;

  return (
    <AppLayout title="海马层记忆库">
      <div className="p-4 md:p-6 space-y-4">
        {/* 主标签切换 */}
        <div className="flex items-center gap-0 border-b border-border">
          <button
            onClick={() => setActiveTab('records')}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-mono border-b-2 transition-colors
              ${activeTab === 'records' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
          >
            <Database className="w-3.5 h-3.5" />
            记忆记录
          </button>
          <button
            onClick={() => setActiveTab('compare')}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-mono border-b-2 transition-colors
              ${activeTab === 'compare' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
          >
            <Brain className="w-3.5 h-3.5" />
            推理对比
          </button>
          <button
            onClick={() => setActiveTab('evolution')}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-mono border-b-2 transition-colors
              ${activeTab === 'evolution' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
          >
            <TrendingUp className="w-3.5 h-3.5" />
            演进轨迹
          </button>
        </div>

        {/* ---- 记忆记录标签 ---- */}
        {activeTab === 'records' && (
          <>
            {/* 头部 */}
            <div className="flex flex-col md:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="搜索记忆记录..."
                  className="h-8 text-xs font-mono bg-background border-border pl-8"
                />
              </div>
              <Select value={filterType} onValueChange={v => setFilterType(v as EpisodeType | 'all')}>
                <SelectTrigger className="h-8 w-full md:w-36 text-xs font-mono bg-background border-border">
                  <SelectValue placeholder="全部类型" />
                </SelectTrigger>
                <SelectContent className="bg-card border-border">
                  <SelectItem value="all" className="text-xs font-mono">全部类型</SelectItem>
                  {(Object.keys(EPISODE_TYPE_LABELS) as EpisodeType[]).map(t => (
                    <SelectItem key={t} value={t} className="text-xs font-mono">{EPISODE_TYPE_LABELS[t]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground shrink-0"
                onClick={fetchEpisodes}
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </Button>
            </div>

            {/* 统计 */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {(Object.keys(EPISODE_TYPE_LABELS) as EpisodeType[]).map(type => {
                const Icon = EPISODE_TYPE_ICONS[type];
                const count = episodes.filter(e => e.type === type).length;
                return (
                  <button
                    key={type}
                    onClick={() => setFilterType(filterType === type ? 'all' : type)}
                    className={`flex items-center gap-2 p-3 border transition-colors episode-${type} ${filterType === type ? 'opacity-100' : 'opacity-60 hover:opacity-80'}`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <div className="text-left">
                      <div className="text-lg font-bold font-mono">{count}</div>
                      <div className="text-xs font-mono">{EPISODE_TYPE_LABELS[type]}</div>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* 记录列表 */}
            {loading ? (
              <div className="space-y-2">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-14 bg-muted" />)}</div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-16">
                <Database className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                <p className="text-sm font-mono text-muted-foreground">海马层暂无记忆记录</p>
                <p className="text-xs text-muted-foreground font-mono mt-1">执行任务后，系统将自动记录成功与失败经验</p>
              </div>
            ) : (
              <div className="space-y-2">
                {filtered.map(ep => {
                  const Icon = EPISODE_TYPE_ICONS[ep.type];
                  const isExpanded = expanded === ep.id;
                  return (
                    <div key={ep.id} className={`border episode-${ep.type}`}>
                      <button
                        className="w-full flex items-start gap-3 p-3 hover:bg-white/5 transition-colors text-left"
                        onClick={() => setExpanded(isExpanded ? null : ep.id)}
                      >
                        <Icon className="w-4 h-4 shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold font-mono text-foreground text-balance">{ep.title}</p>
                          <div className="flex items-center gap-2 mt-1 flex-wrap">
                            <span className={`text-xs font-mono px-1.5 py-0.5 border episode-${ep.type}`}>{EPISODE_TYPE_LABELS[ep.type]}</span>
                            <span className="text-xs text-muted-foreground font-mono">
                              {new Date(ep.created_at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                            </span>
                            {ep.tags.slice(0, 3).map(tag => (
                              <span key={tag} className="text-xs font-mono text-muted-foreground border border-border px-1.5 py-0.5 flex items-center gap-1">
                                <Tag className="w-2.5 h-2.5" />{tag}
                              </span>
                            ))}
                          </div>
                        </div>
                        {isExpanded ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />}
                      </button>
                      {isExpanded && (
                        <div className="border-t border-current/20 p-3 bg-black/10 space-y-3">
                          {/* 结构化标题 */}
                          <p className="text-xs font-mono font-bold text-muted-foreground uppercase tracking-wide">
                            {getDetailTitle(ep)}
                          </p>

                          {/* 结构化详情组件（根据 type+tags 自动选择渲染方式） */}
                          <EpisodeDetail episode={ep} />

                          {/* 关联信息 */}
                          <div className="flex flex-wrap gap-3 pt-1 border-t border-border/30">
                            {ep.task_id && (
                              <div className="flex items-center gap-1.5 text-xs font-mono text-muted-foreground">
                                <Link className="w-3 h-3" />关联任务 ID: <span className="text-foreground/70">{ep.task_id}</span>
                              </div>
                            )}
                            {ep.skill_card_id && (
                              <div className="flex items-center gap-1.5 text-xs font-mono text-muted-foreground">
                                <Link className="w-3 h-3" />关联技能卡 ID: <span className="text-foreground/70">{ep.skill_card_id}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* ---- 推理对比标签 ---- */}
        {activeTab === 'compare' && <ReasoningCompare />}

        {/* ---- 演进轨迹标签 ---- */}
        {activeTab === 'evolution' && <EvolutionTab />}
      </div>
    </AppLayout>
  );
}

// ---- 独立演进轨迹标签 ────────────────────────────────────────────────
// 直接从数据库拉取白质层 failure episodes，按任务分组渲染演进折线图。
// EvolutionChart 本身负责再拉取 parameter_patch 已应用记录（双轨数据）。
function EvolutionTab() {
  const { user } = useAuth();
  const [episodes, setEpisodes] = useState<MemoryEpisode[]>([]);
  const [loading, setLoading] = useState(true);
  const [taskKey, setTaskKey] = useState('');

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    supabase
      .from('memory_episodes')
      .select('*')
      .eq('user_id', user.id)
      .eq('type', 'failure')
      .contains('tags', ['white_matter'])
      .order('created_at', { ascending: true })
      .limit(200)
      .then(({ data }) => {
        setEpisodes(Array.isArray(data) ? data : []);
        setLoading(false);
      });
  }, [user]);

  // 按 task_id 分组
  const taskGroups = (() => {
    const map = new Map<string, { taskId: string | null; label: string; episodes: MemoryEpisode[] }>();
    episodes.forEach(ep => {
      const key = ep.task_id ?? ep.title;
      if (!map.has(key)) {
        map.set(key, {
          taskId: ep.task_id,
          label: ep.title.replace('[白质分析] ', '').split(' — ')[0],
          episodes: [],
        });
      }
      map.get(key)!.episodes.push(ep);
    });
    return [...map.values()];
  })();

  const activeGroup = taskGroups.find(g => (g.taskId ?? g.label) === taskKey) ?? taskGroups[0] ?? null;

  if (loading) {
    return (
      <div className="space-y-2 pt-2">
        {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-10 bg-muted" />)}
      </div>
    );
  }

  if (taskGroups.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 space-y-3">
        <TrendingUp className="w-12 h-12 text-muted-foreground" />
        <p className="text-sm font-mono text-muted-foreground">暂无推理记录</p>
        <p className="text-xs font-mono text-muted-foreground/70">执行任务并触发白质层分析后，参数演进轨迹将显示在此处</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 页头说明 */}
      <div className="border border-border bg-card/50 p-3">
        <div className="flex items-start gap-2">
          <TrendingUp className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-mono font-semibold text-foreground">参数演进轨迹图</p>
            <p className="text-xs font-mono text-muted-foreground mt-0.5">
              实线 = 已应用到技能卡的参数值 · 虚线 = 白质层推理建议值（尚未写入技能卡）
            </p>
          </div>
        </div>
      </div>

      {/* 任务切换 */}
      {taskGroups.length > 1 && (
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-muted-foreground shrink-0">选择任务</span>
          <Select
            value={taskKey || (taskGroups[0].taskId ?? taskGroups[0].label)}
            onValueChange={setTaskKey}
          >
            <SelectTrigger className="h-8 flex-1 md:max-w-xs text-xs font-mono bg-background border-border">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-card border-border">
              {taskGroups.map(g => (
                <SelectItem key={g.taskId ?? g.label} value={g.taskId ?? g.label} className="text-xs font-mono">
                  {g.label}（{g.episodes.length} 条推理）
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* 演进图 */}
      <EvolutionChart
        taskId={activeGroup?.taskId ?? null}
        failureEpisodes={activeGroup?.episodes ?? []}
      />
    </div>
  );
}
