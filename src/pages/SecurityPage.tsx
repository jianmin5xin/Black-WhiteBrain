import { useEffect, useState, useMemo } from 'react';
import AppLayout from '@/components/layouts/AppLayout';
import { supabase } from '@/db/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { SecurityLog, RiskLevel } from '@/types/types';
import {
  Shield, CheckCircle, AlertTriangle, XOctagon, Ban, RefreshCw, Search,
  List, ShieldOff, Clock,
} from 'lucide-react';

const RISK_DEFS: Record<RiskLevel, { label: string; icon: React.ElementType; cls: string }> = {
  low:      { label: '低风险', icon: CheckCircle, cls: 'risk-low' },
  medium:   { label: '中风险', icon: AlertTriangle, cls: 'risk-medium' },
  high:     { label: '高风险', icon: XOctagon, cls: 'risk-high' },
  forbidden:{ label: '禁止', icon: Ban, cls: 'risk-forbidden' },
};

// ─── 单条日志行 ────────────────────────────────────────────────────────
function LogRow({ log }: { log: SecurityLog }) {
  const def = RISK_DEFS[log.risk_level];
  const Icon = def.icon;
  return (
    <div className={`flex items-start gap-3 p-3 border ${def.cls} ${log.blocked ? 'opacity-100' : 'opacity-70'}`}>
      <Icon className="w-4 h-4 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold font-mono text-foreground">{log.action_name}</span>
          {log.blocked && (
            <span className="text-xs font-mono px-1.5 py-0.5 border risk-forbidden">已拦截</span>
          )}
        </div>
        {log.action_detail && (
          <p className="text-xs font-mono text-muted-foreground mt-0.5 truncate">{log.action_detail}</p>
        )}
        {log.block_reason && (
          <p className="text-xs font-mono text-red-400 mt-0.5">拦截原因: {log.block_reason}</p>
        )}
      </div>
      <div className="text-right shrink-0">
        <span className={`text-xs font-mono px-1.5 py-0.5 border ${def.cls}`}>{def.label}</span>
        <p className="text-xs text-muted-foreground font-mono mt-1">
          {new Date(log.created_at).toLocaleString('zh-CN', {
            month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
          })}
        </p>
      </div>
    </div>
  );
}

// ─── 空状态 ────────────────────────────────────────────────────────────
function EmptyState({ icon: Icon, text, sub }: { icon: React.ElementType; text: string; sub: string }) {
  return (
    <div className="text-center py-16">
      <Icon className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
      <p className="text-sm font-mono text-muted-foreground">{text}</p>
      <p className="text-xs text-muted-foreground font-mono mt-1">{sub}</p>
    </div>
  );
}

type ActiveTab = 'logs' | 'forbidden';

export default function SecurityPage() {
  const { user } = useAuth();
  const [logs, setLogs] = useState<SecurityLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<RiskLevel | 'all'>('all');
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<ActiveTab>('logs');

  const fetchLogs = async () => {
    if (!user) return;
    setLoading(true);
    const { data } = await supabase
      .from('security_logs')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(500);
    setLogs(Array.isArray(data) ? data : []);
    setLoading(false);
  };

  useEffect(() => { fetchLogs(); }, [user]);

  // 动作日志：按 risk_level 筛选 + 搜索
  const filteredLogs = useMemo(() => {
    let list = filter !== 'all' ? logs.filter(l => l.risk_level === filter) : logs;
    if (search) {
      const s = search.toLowerCase();
      list = list.filter(l =>
        l.action_name.toLowerCase().includes(s) ||
        (l.action_detail ?? '').toLowerCase().includes(s),
      );
    }
    return list;
  }, [logs, filter, search]);

  // 禁止动作记录：仅 blocked=true
  const forbiddenLogs = useMemo(() => {
    let list = logs.filter(l => l.blocked);
    if (search) {
      const s = search.toLowerCase();
      list = list.filter(l =>
        l.action_name.toLowerCase().includes(s) ||
        (l.action_detail ?? '').toLowerCase().includes(s) ||
        (l.block_reason ?? '').toLowerCase().includes(s),
      );
    }
    return list;
  }, [logs, search]);

  // 按动作名聚合禁止次数（用于频率统计）
  const forbiddenStats = useMemo(() => {
    const map = new Map<string, { count: number; lastAt: string; risk_level: RiskLevel; block_reason: string | null }>();
    logs.filter(l => l.blocked).forEach(l => {
      const cur = map.get(l.action_name);
      if (!cur || l.created_at > cur.lastAt) {
        map.set(l.action_name, {
          count: (cur?.count ?? 0) + 1,
          lastAt: l.created_at,
          risk_level: l.risk_level,
          block_reason: l.block_reason,
        });
      } else {
        map.set(l.action_name, { ...cur, count: cur.count + 1 });
      }
    });
    return [...map.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .map(([name, v]) => ({ name, ...v }));
  }, [logs]);

  const stats = {
    total: logs.length,
    low: logs.filter(l => l.risk_level === 'low').length,
    medium: logs.filter(l => l.risk_level === 'medium').length,
    high: logs.filter(l => l.risk_level === 'high').length,
    blocked: logs.filter(l => l.blocked).length,
  };

  const overallRisk: RiskLevel = stats.blocked > 0 ? 'high' : stats.high > 0 ? 'medium' : 'low';

  return (
    <AppLayout title="安全层监控">
      <div className="p-4 md:p-6 space-y-4">

        {/* 实时风险等级 */}
        <div className={`flex items-center gap-3 p-4 border ${RISK_DEFS[overallRisk].cls}`}>
          <div className="relative shrink-0">
            <Shield className="w-8 h-8" />
            {overallRisk !== 'low' && (
              <div className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-current animate-ping opacity-75" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-mono opacity-70">当前系统风险等级</p>
            <p className="text-lg font-bold font-mono">{RISK_DEFS[overallRisk].label}</p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-xs font-mono opacity-70">拦截动作</p>
            <p className="text-2xl font-bold font-mono">{stats.blocked}</p>
          </div>
        </div>

        {/* 统计卡片 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {([
            { label: '总记录', value: stats.total, cls: 'border-border text-foreground' },
            { label: '低风险', value: stats.low,    cls: 'risk-low' },
            { label: '中风险', value: stats.medium, cls: 'risk-medium' },
            { label: '高风险', value: stats.high,   cls: 'risk-high' },
          ] as { label: string; value: number; cls: string }[]).map(({ label, value, cls }) => (
            <div key={label} className={`p-3 border text-center ${cls}`}>
              <div className="text-2xl font-bold font-mono">{value}</div>
              <div className="text-xs font-mono opacity-70">{label}</div>
            </div>
          ))}
        </div>

        {/* 标签切换 */}
        <div className="flex items-center border-b border-border">
          <button
            onClick={() => setActiveTab('logs')}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-mono border-b-2 transition-colors
              ${activeTab === 'logs'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'}`}
          >
            <List className="w-3.5 h-3.5" />
            动作日志
          </button>
          <button
            onClick={() => setActiveTab('forbidden')}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-mono border-b-2 transition-colors
              ${activeTab === 'forbidden'
                ? 'border-red-400 text-red-400'
                : 'border-transparent text-muted-foreground hover:text-foreground'}`}
          >
            <ShieldOff className="w-3.5 h-3.5" />
            禁止动作记录
            {stats.blocked > 0 && (
              <Badge variant="outline" className="ml-1 text-xs font-mono border-red-400/50 text-red-400 h-4 px-1">
                {stats.blocked}
              </Badge>
            )}
          </button>
        </div>

        {/* 搜索栏（两个标签公用） */}
        <div className="flex flex-col md:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={activeTab === 'forbidden' ? '搜索动作名称或拦截原因...' : '搜索动作名称...'}
              className="h-8 text-xs font-mono bg-background border-border pl-8"
            />
          </div>

          {/* 风险等级筛选（仅动作日志标签） */}
          {activeTab === 'logs' && (
            <div className="flex gap-1.5 flex-wrap">
              {(['all', 'low', 'medium', 'high', 'forbidden'] as const).map(r => (
                <button
                  key={r}
                  onClick={() => setFilter(r)}
                  className={`text-xs font-mono px-2.5 py-1.5 border transition-colors ${
                    filter === r
                      ? r === 'all'
                        ? 'border-primary text-primary bg-primary/10'
                        : `${RISK_DEFS[r as RiskLevel]?.cls} opacity-100`
                      : r === 'all'
                        ? 'border-border text-muted-foreground hover:border-primary/40'
                        : `${RISK_DEFS[r as RiskLevel]?.cls} opacity-40 hover:opacity-70`
                  }`}
                >
                  {r === 'all' ? '全部' : RISK_DEFS[r as RiskLevel].label}
                </button>
              ))}
            </div>
          )}

          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground shrink-0"
            onClick={fetchLogs}
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </Button>
        </div>

        {/* ── 动作日志标签 ── */}
        {activeTab === 'logs' && (
          loading ? (
            <div className="space-y-2">
              {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-12 bg-muted" />)}
            </div>
          ) : filteredLogs.length === 0 ? (
            <EmptyState
              icon={Shield}
              text="暂无安全日志"
              sub="执行任务后，安全层将记录所有动作"
            />
          ) : (
            <div className="space-y-1.5">
              <p className="text-xs font-mono text-muted-foreground">共 {filteredLogs.length} 条记录</p>
              {filteredLogs.map(log => <LogRow key={log.id} log={log} />)}
            </div>
          )
        )}

        {/* ── 禁止动作记录标签 ── */}
        {activeTab === 'forbidden' && (
          loading ? (
            <div className="space-y-2">
              {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-16 bg-muted" />)}
            </div>
          ) : forbiddenLogs.length === 0 ? (
            <EmptyState
              icon={ShieldOff}
              text="暂无禁止动作记录"
              sub="当安全层拦截高危或违禁操作时，记录将显示在此处"
            />
          ) : (
            <div className="space-y-4">
              {/* 频率聚合卡片 */}
              <div className="border border-border">
                <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-card/50">
                  <Ban className="w-3.5 h-3.5 text-red-400" />
                  <span className="text-xs font-mono font-bold text-red-400">
                    高频禁止动作（按拦截次数排序）
                  </span>
                </div>
                <div className="divide-y divide-border/40">
                  {forbiddenStats.slice(0, 5).map(s => {
                    const def = RISK_DEFS[s.risk_level];
                    return (
                      <div key={s.name} className="flex items-center gap-3 px-3 py-2.5">
                        <Ban className="w-3.5 h-3.5 text-red-400 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-mono font-semibold text-foreground truncate">{s.name}</p>
                          {s.block_reason && (
                            <p className="text-xs font-mono text-muted-foreground truncate">{s.block_reason}</p>
                          )}
                        </div>
                        <span className={`text-xs font-mono px-1.5 py-0.5 border shrink-0 ${def.cls}`}>
                          {def.label}
                        </span>
                        <div className="text-right shrink-0">
                          <span className="text-xs font-mono font-bold text-red-400">{s.count} 次</span>
                          <p className="text-xs font-mono text-muted-foreground/70 flex items-center gap-1 justify-end mt-0.5">
                            <Clock className="w-3 h-3" />
                            {new Date(s.lastAt).toLocaleString('zh-CN', {
                              month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
                            })}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 完整禁止记录列表 */}
              <div className="space-y-1.5">
                <p className="text-xs font-mono text-muted-foreground">
                  全部拦截记录（{forbiddenLogs.length} 条）
                </p>
                {forbiddenLogs.map(log => <LogRow key={log.id} log={log} />)}
              </div>
            </div>
          )
        )}
      </div>
    </AppLayout>
  );
}
