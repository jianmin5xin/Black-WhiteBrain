// 站内通知 hook：读取列表、未读计数、Realtime 订阅、标已读
import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/db/supabase';
import { useAuth } from '@/contexts/AuthContext';
import type { AppNotification } from '@/types/types';

export function useNotifications() {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(false);

  const unreadCount = notifications.filter(n => !n.read).length;

  const fetchNotifications = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50);
    setNotifications(Array.isArray(data) ? data : []);
    setLoading(false);
  }, [user]);

  // 首次加载
  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  // Realtime 实时推送
  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel('notifications-realtime')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` },
        (payload) => {
          setNotifications(prev => [payload.new as AppNotification, ...prev]);
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` },
        (payload) => {
          setNotifications(prev =>
            prev.map(n => n.id === (payload.new as AppNotification).id ? payload.new as AppNotification : n)
          );
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user]);

  const markRead = useCallback(async (id: string) => {
    await supabase.from('notifications').update({ read: true }).eq('id', id);
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
  }, []);

  const markAllRead = useCallback(async () => {
    if (!user) return;
    await supabase.from('notifications').update({ read: true }).eq('user_id', user.id).eq('read', false);
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  }, [user]);

  return { notifications, loading, unreadCount, markRead, markAllRead, refetch: fetchNotifications };
}
