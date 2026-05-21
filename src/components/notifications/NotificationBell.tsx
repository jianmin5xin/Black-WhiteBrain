// 通知铃铛组件：铃铛图标 + 未读徽章 + 类型筛选标签 + Popover 通知列表
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, BellRing, Check, CheckCheck, Brain, Info, AlertTriangle, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useNotifications } from '@/hooks/use-notifications';
import type { AppNotification, NotificationType } from '@/types/types';

const TYPE_STYLE: Record<NotificationType, { icon: React.ElementType; cls: string; dot: string; label: string }> = {
  info:    { icon: Info,          cls: 'text-blue-400',   dot: 'bg-blue-400',   label: '信息' },
  success: { icon: Brain,         cls: 'text-primary',    dot: 'bg-primary',    label: '成功' },
  warning: { icon: AlertTriangle, cls: 'text-yellow-400', dot: 'bg-yellow-400', label: '警告' },
  error:   { icon: XCircle,       cls: 'text-red-400',    dot: 'bg-red-400',    label: '错误' },
};

type FilterType = 'all' | NotificationType;

const FILTER_TABS: { key: FilterType; label: string; activeClass: string }[] = [
  { key: 'all',     label: '全部', activeClass: 'border-primary text-primary' },
  { key: 'success', label: '成功', activeClass: 'border-primary text-primary' },
  { key: 'warning', label: '警告', activeClass: 'border-yellow-400 text-yellow-400' },
  { key: 'error',   label: '错误', activeClass: 'border-red-400 text-red-400' },
  { key: 'info',    label: '信息', activeClass: 'border-blue-400 text-blue-400' },
];

export default function NotificationBell() {
  const { notifications, loading, unreadCount, markRead, markAllRead } = useNotifications();
  const [open, setOpen] = useState(false);
  const [filterType, setFilterType] = useState<FilterType>('all');
  const navigate = useNavigate();

  const filtered = filterType === 'all'
    ? notifications
    : notifications.filter(n => n.type === filterType);

  const unreadFor = (type: FilterType) =>
    type === 'all'
      ? notifications.filter(n => !n.read).length
      : notifications.filter(n => n.type === type && !n.read).length;

  /** 点击通知行：标已读，若有关联任务则跳转到 /tasks?task_id=&run_id= */
  const handleNotificationClick = async (n: AppNotification) => {
    if (!n.read) await markRead(n.id);
    if (n.task_id) {
      const params = new URLSearchParams({ task_id: n.task_id });
      if (n.task_run_id) params.set('run_id', n.task_run_id);
      navigate(`/tasks?${params.toString()}`);
      setOpen(false);
    }
  };

  const handleMarkRead = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    markRead(id);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative h-8 w-8 text-muted-foreground hover:text-foreground"
          aria-label="查看通知"
        >
          {unreadCount > 0 ? <BellRing className="w-4 h-4" /> : <Bell className="w-4 h-4" />}
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold leading-none">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-80 p-0 border border-border" sideOffset={8}>

        {/* ── 头部 ── */}
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-border bg-muted/20">
          <div className="flex items-center gap-1.5">
            <Bell className="w-3.5 h-3.5 text-primary" />
            <span className="text-xs font-mono font-bold text-foreground">站内通知</span>
            {unreadCount > 0 && (
              <span className="text-xs font-mono px-1.5 py-0 border border-red-400/40 text-red-400 leading-5">
                {unreadCount} 未读
              </span>
            )}
          </div>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[10px] font-mono text-muted-foreground hover:text-foreground"
              onClick={() => markAllRead()}
            >
              <CheckCheck className="w-3 h-3 mr-1" />全部已读
            </Button>
          )}
        </div>

        {/* ── 筛选标签栏 ── */}
        <div className="flex items-center gap-0 border-b border-border overflow-x-auto">
          {FILTER_TABS.map(tab => {
            const unread = unreadFor(tab.key);
            const isActive = filterType === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setFilterType(tab.key)}
                className={`flex items-center gap-1 px-3 py-2 text-[11px] font-mono whitespace-nowrap border-b-2 transition-colors shrink-0
                  ${isActive
                    ? `${tab.activeClass} bg-transparent`
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                  }`}
              >
                {tab.label}
                {unread > 0 && (
                  <span className={`text-[9px] font-bold px-1 py-0 rounded-sm leading-4
                    ${isActive ? 'bg-current/10' : 'bg-muted text-muted-foreground'}`}>
                    {unread}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* ── 列表 ── */}
        <ScrollArea className="max-h-[320px]">
          {loading ? (
            <div className="p-4 text-center text-xs font-mono text-muted-foreground">加载中…</div>
          ) : filtered.length === 0 ? (
            <div className="p-6 text-center space-y-2">
              <Bell className="w-8 h-8 text-muted-foreground/40 mx-auto" />
              <p className="text-xs font-mono text-muted-foreground">
                {filterType === 'all' ? '暂无通知' : `暂无${TYPE_STYLE[filterType as NotificationType]?.label ?? ''}通知`}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {filtered.map(n => {
                const { icon: Icon, cls, dot } = TYPE_STYLE[n.type] ?? TYPE_STYLE.info;
                const isClickable = !!n.task_id;
                return (
                  <div
                    key={n.id}
                    onClick={() => handleNotificationClick(n)}
                    className={`flex items-start gap-2.5 px-3 py-2.5 transition-colors
                      ${n.read ? 'opacity-60' : 'bg-primary/[0.03]'}
                      ${isClickable ? 'cursor-pointer hover:bg-accent' : ''}`}
                  >
                    <div className={`mt-0.5 shrink-0 ${cls}`}>
                      <Icon className="w-3.5 h-3.5" />
                    </div>
                    <div className="flex-1 min-w-0 space-y-0.5">
                      <div className="flex items-start gap-1.5">
                        {!n.read && <span className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} />}
                        <p className="text-xs font-mono font-semibold text-foreground text-pretty leading-snug">{n.title}</p>
                      </div>
                      {n.body && (
                        <p className="text-[11px] font-mono text-muted-foreground text-pretty leading-snug pl-3">{n.body}</p>
                      )}
                      <div className="flex items-center gap-2 pl-3">
                        <p className="text-[10px] font-mono text-muted-foreground/60">
                          {new Date(n.created_at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                        </p>
                        {isClickable && (
                          <span className="text-[10px] font-mono text-primary/60">点击查看任务 →</span>
                        )}
                      </div>
                    </div>
                    {!n.read && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5 shrink-0 mt-0.5 text-muted-foreground hover:text-primary"
                        title="标为已读"
                        onClick={(e) => handleMarkRead(n.id, e)}
                      >
                        <Check className="w-2.5 h-2.5" />
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
