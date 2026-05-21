// 分析行为偏好设置面板
// 功能：失败后自动分析开关 + 分析完成浏览器推送开关
import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/db/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Loader2, Brain, Zap, Bell, BellOff, ShieldCheck } from 'lucide-react';
import { requestBrowserNotifyPermission } from '@/lib/notifications';

export default function AnalysisSettingsPanel() {
  const { user, profile, refreshProfile } = useAuth();
  const [autoAnalyze, setAutoAnalyze] = useState(false);
  const [notifyOnAnalysis, setNotifyOnAnalysis] = useState(true);
  const [savingAuto, setSavingAuto] = useState(false);
  const [savingNotify, setSavingNotify] = useState(false);
  const [browserPermission, setBrowserPermission] = useState<NotificationPermission>('default');

  // 从 profile 同步初始值
  useEffect(() => {
    if (profile) {
      setAutoAnalyze(profile.auto_analyze_on_failure ?? false);
      setNotifyOnAnalysis(profile.notify_on_analysis ?? true);
    }
  }, [profile]);

  // 读取当前浏览器通知权限状态
  useEffect(() => {
    if ('Notification' in window) {
      setBrowserPermission(Notification.permission);
    }
  }, []);

  const handleToggleAutoAnalyze = async (checked: boolean) => {
    if (!user) return;
    setSavingAuto(true);
    setAutoAnalyze(checked);
    const { error } = await supabase.from('profiles').update({ auto_analyze_on_failure: checked }).eq('id', user.id);
    if (error) {
      toast.error('保存失败，请重试');
      setAutoAnalyze(!checked);
    } else {
      toast.success(checked ? '已开启失败后自动分析' : '已关闭失败后自动分析');
      await refreshProfile();
    }
    setSavingAuto(false);
  };

  const handleToggleNotify = async (checked: boolean) => {
    if (!user) return;
    // 开启时先检查/申请浏览器权限
    if (checked && browserPermission !== 'granted') {
      const granted = await requestBrowserNotifyPermission();
      setBrowserPermission(Notification.permission);
      if (!granted) {
        toast.error('浏览器通知权限被拒绝，请在浏览器设置中手动允许');
        return;
      }
    }
    setSavingNotify(true);
    setNotifyOnAnalysis(checked);
    const { error } = await supabase.from('profiles').update({ notify_on_analysis: checked }).eq('id', user.id);
    if (error) {
      toast.error('保存失败，请重试');
      setNotifyOnAnalysis(!checked);
    } else {
      toast.success(checked ? '已开启分析完成推送通知' : '已关闭推送通知');
      await refreshProfile();
    }
    setSavingNotify(false);
  };

  const handleRequestPermission = async () => {
    const granted = await requestBrowserNotifyPermission();
    setBrowserPermission(Notification.permission);
    if (granted) toast.success('浏览器通知权限已授权');
    else toast.error('权限申请被拒绝，请在浏览器设置中手动允许');
  };

  return (
    <div className="border border-border space-y-0">
      {/* 标题栏 */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border bg-muted/20">
        <Brain className="w-3.5 h-3.5 text-primary shrink-0" />
        <span className="text-xs font-mono font-bold text-foreground uppercase tracking-wider">推理行为设置</span>
      </div>

      {/* 开关 1：失败后自动分析 */}
      <div className="px-3 py-3 flex items-center justify-between gap-4 border-b border-border/50">
        <div className="flex-1 min-w-0 space-y-0.5">
          <div className="flex items-center gap-2">
            <Zap className="w-3.5 h-3.5 text-yellow-400 shrink-0" />
            <span className="text-xs font-mono font-semibold text-foreground">失败后自动分析</span>
            {savingAuto && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground shrink-0" />}
          </div>
          <p className="text-xs font-mono text-muted-foreground text-pretty pl-5">
            任务执行失败时，自动调用白质层 AI 进行根因分析，无需手动点击「启动白质层推理」按钮
          </p>
        </div>
        <Switch checked={autoAnalyze} onCheckedChange={handleToggleAutoAnalyze} disabled={savingAuto} className="shrink-0" />
      </div>

      {/* 开关 2：分析完成浏览器推送 */}
      <div className="px-3 py-3 space-y-2.5">
        <div className="flex items-center justify-between gap-4">
          <div className="flex-1 min-w-0 space-y-0.5">
            <div className="flex items-center gap-2">
              <Bell className="w-3.5 h-3.5 text-blue-400 shrink-0" />
              <span className="text-xs font-mono font-semibold text-foreground">分析完成推送通知</span>
              {savingNotify && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground shrink-0" />}
            </div>
            <p className="text-xs font-mono text-muted-foreground text-pretty pl-5">
              白质层 AI 分析完成后，通过站内通知 + 浏览器推送提醒你查看结果
            </p>
          </div>
          <Switch checked={notifyOnAnalysis} onCheckedChange={handleToggleNotify} disabled={savingNotify} className="shrink-0" />
        </div>

        {/* 浏览器权限状态行 */}
        {'Notification' in window && (
          <div className="flex items-center gap-2 pl-5">
            {browserPermission === 'granted' ? (
              <div className="flex items-center gap-1.5 text-xs font-mono text-primary">
                <ShieldCheck className="w-3 h-3" />浏览器通知权限已授权
              </div>
            ) : browserPermission === 'denied' ? (
              <div className="flex items-center gap-1.5 text-xs font-mono text-red-400">
                <BellOff className="w-3 h-3" />浏览器通知权限已拒绝，请在浏览器设置中手动允许
              </div>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[11px] font-mono text-blue-400 hover:text-blue-300 border border-blue-400/30"
                onClick={handleRequestPermission}
              >
                <Bell className="w-3 h-3 mr-1" />申请浏览器通知权限
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
