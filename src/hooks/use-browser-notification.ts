/**
 * useBrowserNotification — 浏览器系统通知（Notification API）。
 *
 * 用法：
 *   const { notify, permission, requestPermission } = useBrowserNotification();
 *   notify({ title: '任务完成', body: '执行成功！', icon: '/favicon.ico' });
 *
 * 说明：
 *   - 首次调用 notify() 时若权限未授权，自动弹出授权请求
 *   - 浏览器不支持 Notification API 时静默降级（不报错）
 *   - 页面在前台时不弹出（避免与 toast 重复），仅页面隐藏时弹出
 */
import { useCallback, useEffect, useState } from 'react';

export type NotificationPermission = 'default' | 'granted' | 'denied';

interface NotifyOptions {
  title: string;
  body?: string;
  icon?: string;
  /** 点击通知时的回调 */
  onClick?: () => void;
}

interface UseBrowserNotificationResult {
  permission: NotificationPermission;
  supported: boolean;
  requestPermission: () => Promise<NotificationPermission>;
  notify: (options: NotifyOptions) => void;
}

const ICON = '/favicon.ico';

export function useBrowserNotification(): UseBrowserNotificationResult {
  const supported = typeof window !== 'undefined' && 'Notification' in window;

  const [permission, setPermission] = useState<NotificationPermission>(
    supported ? Notification.permission : 'denied'
  );

  // 同步外部权限变更（如用户在浏览器设置中手动修改）
  useEffect(() => {
    if (!supported) return;
    setPermission(Notification.permission);
  }, [supported]);

  const requestPermission = useCallback(async (): Promise<NotificationPermission> => {
    if (!supported) return 'denied';
    const result = await Notification.requestPermission();
    setPermission(result);
    return result;
  }, [supported]);

  const notify = useCallback((options: NotifyOptions) => {
    if (!supported) return;

    // 页面在前台时不弹出（toast 已足够）
    if (!document.hidden) return;

    const send = (perm: NotificationPermission) => {
      if (perm !== 'granted') return;
      const n = new Notification(options.title, {
        body:   options.body,
        icon:   options.icon ?? ICON,
        silent: false,
      });
      if (options.onClick) {
        n.onclick = () => {
          window.focus();
          options.onClick?.();
          n.close();
        };
      }
      // 8 秒后自动关闭
      setTimeout(() => n.close(), 8000);
    };

    if (permission === 'granted') {
      send('granted');
    } else if (permission === 'default') {
      // 懒授权：第一次 notify 时请求
      Notification.requestPermission().then((p) => {
        setPermission(p);
        send(p);
      });
    }
    // denied：静默降级
  }, [supported, permission]);

  return { permission, supported, requestPermission, notify };
}
