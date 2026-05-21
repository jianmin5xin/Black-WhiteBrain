/**
 * SyncStatusIndicator — 实时同步连接状态指示器。
 *
 * 导出两个组件：
 *   <SyncStatusDot />  — header 右侧小指示灯（放在 flex 行内）
 *   <SyncStatusBanner /> — header 下方横幅条（放在 header 外、main 上方）
 *
 * 两者都调用同一个 hook，React 会自动合并（同进程内 hook 状态独立，但开销极小）。
 */
import { useEffect, useState } from 'react';
import { Wifi, WifiOff, Loader2 } from 'lucide-react';
import { useRealtimeStatus } from '@/hooks/use-realtime-status';

/** header 右侧行内指示灯 */
export function SyncStatusDot() {
  const status = useRealtimeStatus();

  if (status === 'connected') return (
    <div className="flex items-center gap-1.5">
      <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
      <span className="text-xs text-muted-foreground font-mono hidden md:block">已同步</span>
    </div>
  );
  if (status === 'connecting') return (
    <div className="flex items-center gap-1.5">
      <Loader2 className="w-3 h-3 text-yellow-400 animate-spin" />
      <span className="text-xs text-yellow-400 font-mono hidden md:block">连接中</span>
    </div>
  );
  return (
    <div className="flex items-center gap-1.5">
      <WifiOff className="w-3 h-3 text-red-400" />
      <span className="text-xs text-red-400 font-mono hidden md:block">断线</span>
    </div>
  );
}

/** header 下方横幅条（非 connected 时滑出，恢复后 1.5s 收起） */
export function SyncStatusBanner() {
  const status = useRealtimeStatus();
  const [showBanner, setShowBanner] = useState(false);

  useEffect(() => {
    if (status !== 'connected') {
      setShowBanner(true);
    } else {
      const t = setTimeout(() => setShowBanner(false), 1500);
      return () => clearTimeout(t);
    }
  }, [status]);

  const cfg = (() => {
    if (status === 'connecting') return {
      bg:   'bg-yellow-500/10 border-yellow-500/30',
      text: 'text-yellow-400',
      icon: <Loader2 className="w-3 h-3 animate-spin shrink-0" />,
      msg:  '正在连接云端同步服务，请稍候…',
    };
    if (status === 'disconnected') return {
      bg:   'bg-red-500/10 border-red-500/30',
      text: 'text-red-400',
      icon: <WifiOff className="w-3 h-3 shrink-0" />,
      msg:  '实时同步已断开，数据可能延迟更新，正在尝试重新连接…',
    };
    return {
      bg:   'bg-primary/10 border-primary/30',
      text: 'text-primary',
      icon: <Wifi className="w-3 h-3 shrink-0" />,
      msg:  '云端同步已恢复，数据实时更新中',
    };
  })();

  return (
    <div
      className={`
        overflow-hidden transition-all duration-500 ease-in-out border-b font-mono
        ${cfg.bg} ${cfg.text}
        ${showBanner ? 'max-h-10 py-1.5' : 'max-h-0 py-0 border-transparent'}
      `}
      aria-live="polite"
    >
      <div className="flex items-center justify-center gap-2 px-4 text-xs">
        {cfg.icon}
        <span>{cfg.msg}</span>
      </div>
    </div>
  );
}

/** 默认导出行内指示灯（向后兼容） */
export default SyncStatusDot;
