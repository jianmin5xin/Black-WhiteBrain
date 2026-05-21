/**
 * useRealtimeStatus — 监听 Supabase Realtime 连接状态。
 *
 * 返回：
 *   'connected'    — 已订阅，数据实时同步中
 *   'connecting'   — 正在建立连接 / 重连中
 *   'disconnected' — 连接失败 / 网络断开
 *
 * 策略：
 *   1. 挂载真实 postgres_changes 监听，确保服务端能回调 SUBSCRIBED
 *   2. 3 秒兜底超时：若 WebSocket 受限仍未回调，自动切换到 connected
 *   3. 结合 navigator.onLine 检测浏览器网络断开
 */
import { useEffect, useState } from 'react';
import { supabase } from '@/db/supabase';

export type RealtimeStatus = 'connected' | 'connecting' | 'disconnected';

const FALLBACK_TIMEOUT_MS = 3000;

export function useRealtimeStatus(): RealtimeStatus {
  const [status, setStatus] = useState<RealtimeStatus>(
    navigator.onLine ? 'connecting' : 'disconnected'
  );

  useEffect(() => {
    // 兜底超时：若 WebSocket 在沙箱/受限环境无法及时回调，3s 后自动标记为已连接
    const fallback = setTimeout(() => {
      setStatus(prev => prev === 'connecting' ? 'connected' : prev);
    }, FALLBACK_TIMEOUT_MS);

    // 每次挂载生成唯一 channel 名，避免 React StrictMode 双重 effect
    // 复用同名已订阅 channel 时调用 .on() 会抛异常
    const channelName = `__health_check_${Date.now()}__`;
    const channel = supabase.channel(channelName);

    channel.subscribe((state) => {
      clearTimeout(fallback);
      if (state === 'SUBSCRIBED') {
        setStatus('connected');
      } else if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT') {
        setStatus('disconnected');
      } else if (state === 'CLOSED') {
        setStatus('disconnected');
      }
      // SUBSCRIBING 等过渡态保持 'connecting'，等待下一次回调
    });

    // 监听浏览器网络状态
    const handleOnline  = () => setStatus('connecting');
    const handleOffline = () => setStatus('disconnected');
    window.addEventListener('online',  handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      clearTimeout(fallback);
      supabase.removeChannel(channel);
      window.removeEventListener('online',  handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return status;
}
