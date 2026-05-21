import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import NotificationBell from '@/components/notifications/NotificationBell';
import SyncStatusIndicator, { SyncStatusBanner } from '@/components/layouts/SyncStatusIndicator';
import {
  Brain,
  LayoutDashboard,
  ListTodo,
  Layers,
  Database,
  Cpu,
  Shield,
  LogOut,
  User,
  Menu,
  Zap,
  Activity,
  GitBranch,
  Settings,
  Search,
} from 'lucide-react';

const navItems = [
  { path: '/dashboard',  icon: LayoutDashboard, label: '仪表盘',    desc: '总览',      tooltip: '平台运行总览与元目标评分' },
  { path: '/tasks',      icon: ListTodo,        label: '任务管理',  desc: '自动化',    tooltip: '创建并执行网页自动化任务' },
  { path: '/skills',     icon: Layers,          label: '技能卡',    desc: '灰质层',    tooltip: '灰质层技能卡库与版本管理' },
  { path: '/memory',     icon: Database,        label: '海马层',    desc: '记忆库',    tooltip: '经验记录、失败片段与成功轨迹' },
  { path: '/bootstrap',  icon: Cpu,             label: '环境自举器', desc: '能力发现', tooltip: '自动发现网页环境执行能力' },
  { path: '/layers',     icon: GitBranch,       label: '层状态',    desc: '架构可视化', tooltip: '双速认知架构层状态可视化' },
  { path: '/security',   icon: Shield,          label: '安全监控',  desc: '安全层',    tooltip: '风险等级与动作拦截日志' },
  { path: '/settings',   icon: Settings,        label: '设置',      desc: '模型配置',  tooltip: '配置 AI 模型与系统偏好' },
];

/** 从用户名提取首字母头像 */
function UserAvatar({ name }: { name: string }) {
  const initials = name
    .split(/[\s_@]/)[0]
    .slice(0, 2)
    .toUpperCase();
  return (
    <div className="w-6 h-6 flex items-center justify-center bg-primary/20 border border-primary/40 text-primary font-bold text-[10px] font-mono shrink-0">
      {initials}
    </div>
  );
}

function NavContent({ onNavigate }: { onNavigate?: () => void }) {
  const location = useLocation();
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  const userName = profile?.username || profile?.email?.split('@')[0] || '未知用户';

  return (
    <TooltipProvider delayDuration={400}>
      <div className="flex flex-col h-full bg-sidebar">
        {/* Logo */}
        <div className="flex items-center gap-2 px-4 py-4 border-b border-sidebar-border">
          <div className="w-8 h-8 flex items-center justify-center border border-primary/40 bg-primary/10">
            <Brain className="w-4 h-4 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-bold text-sidebar-foreground font-mono truncate">GW-Agent</p>
            <p className="text-xs text-muted-foreground font-mono">自举平台 v1.0</p>
          </div>
        </div>

        {/* 状态指示 */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-sidebar-border">
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
            <span className="text-xs text-muted-foreground font-mono">系统运行中</span>
          </div>
          <Activity className="w-3 h-3 text-muted-foreground ml-auto" />
        </div>

        {/* 导航 */}
        <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
          <p className="section-title px-2 py-1 mb-1">核心模块</p>
          {navItems.map(({ path, icon: Icon, label, desc, tooltip }) => {
            const active = location.pathname === path;
            return (
              <Tooltip key={path}>
                <TooltipTrigger asChild>
                  <Link
                    to={path}
                    onClick={onNavigate}
                    className={`relative flex items-center gap-3 px-2 py-2 transition-colors group overflow-hidden ${
                      active
                        ? 'text-sidebar-primary'
                        : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                    }`}
                  >
                    {/* 激活态：左侧 accent 条 + 背景渐变 */}
                    {active && (
                      <>
                        <span className="absolute left-0 top-0 bottom-0 w-0.5 bg-primary" />
                        <span className="absolute inset-0 bg-gradient-to-r from-primary/15 to-transparent pointer-events-none" />
                      </>
                    )}
                    <Icon className={`w-4 h-4 shrink-0 relative ${active ? 'text-primary' : 'text-muted-foreground group-hover:text-sidebar-accent-foreground'}`} />
                    <div className="min-w-0 flex-1 relative">
                      <p className="text-xs font-medium font-mono truncate">{label}</p>
                      <p className="text-xs text-muted-foreground/70 font-mono">{desc}</p>
                    </div>
                    {active && <div className="w-1 h-1 rounded-full bg-primary shrink-0 relative" />}
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="right" className="text-xs font-mono">
                  {tooltip}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </nav>

        {/* 用户区（头像字母缩写） */}
        <div className="border-t border-sidebar-border p-3 space-y-1">
          <div className="flex items-center gap-2 px-2 py-1.5">
            <UserAvatar name={userName} />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-mono text-foreground truncate">{userName}</p>
              <p className="text-xs text-muted-foreground font-mono">{profile?.role === 'admin' ? '管理员' : '用户'}</p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2 h-8 text-xs font-mono text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            onClick={handleSignOut}
          >
            <LogOut className="w-3 h-3" />
            退出登录
          </Button>
        </div>
      </div>
    </TooltipProvider>
  );
}

/** 根据路径返回页面描述 */
function getPageMeta(pathname: string): { title: string; subtitle: string } {
  const found = navItems.find(n => n.path === pathname);
  return {
    title:    found?.label   ?? 'GW-Agent 平台',
    subtitle: found?.tooltip ?? '网页自动化智能体平台',
  };
}

interface AppLayoutProps {
  children: React.ReactNode;
  title?: string;
}

export default function AppLayout({ children, title }: AppLayoutProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const { title: pageTitle, subtitle } = getPageMeta(location.pathname);

  return (
    <div className="flex min-h-screen w-full bg-background">
      {/* 桌面侧边栏 */}
      <aside className="hidden lg:flex flex-col w-56 shrink-0 border-r border-border">
        <NavContent />
      </aside>

      {/* 主内容区 */}
      <div className="flex-1 min-w-0 overflow-x-hidden flex flex-col">
        {/* 顶部栏 */}
        <header className="h-14 border-b border-border flex items-center px-4 gap-3 shrink-0 bg-card">
          {/* 移动端汉堡菜单 */}
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="sm" className="lg:hidden h-8 w-8 p-0 text-muted-foreground hover:text-foreground">
                <Menu className="w-4 h-4" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="p-0 w-56 bg-sidebar border-sidebar-border">
              <NavContent onNavigate={() => setMobileOpen(false)} />
            </SheetContent>
          </Sheet>

          {/* 页面标题 + 副标题 */}
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <Zap className="w-3.5 h-3.5 text-primary shrink-0" />
            <div className="min-w-0">
              <h2 className="text-sm font-semibold font-mono truncate text-foreground leading-tight">
                {title || pageTitle}
              </h2>
              <p className="text-[10px] font-mono text-muted-foreground/70 truncate hidden md:block leading-tight">
                {subtitle}
              </p>
            </div>
          </div>

          {/* 右侧操作区 */}
          <div className="flex items-center gap-2 shrink-0">
            {/* 全局搜索占位（仅UI） */}
            <button
              className="hidden md:flex items-center gap-2 h-7 px-3 border border-border text-muted-foreground hover:text-foreground hover:border-border/80 transition-colors font-mono text-xs"
              aria-label="搜索"
              disabled
            >
              <Search className="w-3 h-3" />
              <span className="text-[11px]">搜索…</span>
              <kbd className="ml-1 text-[9px] px-1 py-0 border border-border/60 text-muted-foreground/60 font-mono">⌘K</kbd>
            </button>

            <NotificationBell />

            <SyncStatusIndicator />
          </div>
        </header>

        {/* 页面内容 */}
        <SyncStatusBanner />
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
