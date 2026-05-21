// 站内通知工具函数
import { supabase } from '@/db/supabase';
import type { NotificationType } from '@/types/types';

export interface InsertNotificationParams {
  userId: string;
  title: string;
  body?: string;
  type?: NotificationType;
  taskId?: string | null;
  taskRunId?: string | null;
}

/** 写入一条站内通知 */
export async function insertNotification(params: InsertNotificationParams): Promise<void> {
  const { userId, title, body = '', type = 'info', taskId = null, taskRunId = null } = params;
  await supabase.from('notifications').insert({
    user_id: userId,
    title,
    body,
    type,
    task_id: taskId,
    task_run_id: taskRunId,
  });
}

/** 请求浏览器通知权限（已授权时直接返回 true） */
export async function requestBrowserNotifyPermission(): Promise<boolean> {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  const result = await Notification.requestPermission();
  return result === 'granted';
}

/** 发送浏览器通知（仅在已授权时生效） */
export function sendBrowserNotification(title: string, body: string, icon?: string): void {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  new Notification(title, { body, icon: icon ?? '/favicon.ico' });
}
