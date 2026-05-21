/**
 * useRealtimeSync — 订阅指定表的 INSERT / UPDATE / DELETE 变更。
 * 返回 lastChange 时间戳：每次收到推送时递增，供调用方在 useEffect 依赖项中触发刷新。
 *
 * 用法：
 *   const { lastChange } = useRealtimeSync({ tables: ['task_runs', 'tasks'], userId: user.id });
 *   useEffect(() => { fetchData(); }, [lastChange]);
 */
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/db/supabase';

interface RealtimeSyncOptions {
  /** 需要监听的表名列表 */
  tables: string[];
  /** 当前用户 ID —— 用于 row-level 过滤 (user_id=eq.<id>) */
  userId: string | undefined;
  /** 可选：额外过滤字段（如 task_id） */
  extraFilter?: { column: string; value: string };
}

interface RealtimeSyncResult {
  /** 每次收到 Realtime 推送时更新，可作为 useEffect 依赖项 */
  lastChange: number;
}

export function useRealtimeSync({
  tables,
  userId,
  extraFilter,
}: RealtimeSyncOptions): RealtimeSyncResult {
  const [lastChange, setLastChange] = useState(0);
  // 用 ref 缓存 extraFilter，避免对象引用每次 render 都触发重新订阅
  const extraFilterRef = useRef(extraFilter);
  extraFilterRef.current = extraFilter;

  useEffect(() => {
    if (!userId) return;

    const channelName = [
      'rt-sync',
      userId.slice(0, 8),
      tables.join('-'),
      extraFilterRef.current ? `${extraFilterRef.current.column}-${extraFilterRef.current.value.slice(0, 8)}` : '',
    ]
      .filter(Boolean)
      .join('_');

    const channel = supabase.channel(channelName);

    tables.forEach((table) => {
      // 优先用 extraFilter，否则 fallback 到 user_id
      const filter = extraFilterRef.current
        ? `${extraFilterRef.current.column}=eq.${extraFilterRef.current.value}`
        : `user_id=eq.${userId}`;

      (['INSERT', 'UPDATE', 'DELETE'] as const).forEach((event) => {
        channel.on(
          'postgres_changes',
          { event, schema: 'public', table, filter },
          () => {
            setLastChange(Date.now());
          }
        );
      });
    });

    channel.subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  // tables 数组内容不变则不重新订阅（通过 join 序列化比较）
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, tables.join(','), extraFilter?.column, extraFilter?.value]);

  return { lastChange };
}
