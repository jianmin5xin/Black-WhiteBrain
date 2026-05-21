// 设置页面
import AppLayout from '@/components/layouts/AppLayout';
import ModelConfigPanel from '@/components/settings/ModelConfigPanel';
import AnalysisSettingsPanel from '@/components/settings/AnalysisSettingsPanel';
import { Settings } from 'lucide-react';

export default function SettingsPage() {
  return (
    <AppLayout title="设置">
      <div className="p-4 md:p-6 max-w-2xl space-y-6">
        {/* 页面标题 */}
        <div className="flex items-center gap-3">
          <Settings className="w-5 h-5 text-primary shrink-0" />
          <div>
            <h2 className="text-sm font-mono font-bold text-foreground">系统设置</h2>
            <p className="text-xs font-mono text-muted-foreground mt-0.5">
              管理 AI 模型配置及系统偏好
            </p>
          </div>
        </div>

        {/* 推理行为设置 */}
        <AnalysisSettingsPanel />

        {/* 模型配置模块 */}
        <ModelConfigPanel />
      </div>
    </AppLayout>
  );
}
