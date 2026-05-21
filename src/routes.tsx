import { Navigate } from 'react-router-dom';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import TasksPage from './pages/TasksPage';
import SkillsPage from './pages/SkillsPage';
import MemoryPage from './pages/MemoryPage';
import BootstrapPage from './pages/BootstrapPage';
import SecurityPage from './pages/SecurityPage';
import LayersPage from './pages/LayersPage';
import SettingsPage from './pages/SettingsPage';
import type { ReactNode } from 'react';

export interface RouteConfig {
  name: string;
  path: string;
  element: ReactNode;
  visible?: boolean;
  /** Accessible without login. Routes without this flag require authentication. Has no effect when RouteGuard is not in use. */
  public?: boolean;
}

export const routes: RouteConfig[] = [
  {
    name: '登录',
    path: '/login',
    element: <LoginPage />,
    public: true,
  },
  {
    name: '首页重定向',
    path: '/',
    element: <Navigate to="/dashboard" replace />,
    public: false,
  },
  {
    name: '仪表盘',
    path: '/dashboard',
    element: <DashboardPage />,
    visible: true,
  },
  {
    name: '任务管理',
    path: '/tasks',
    element: <TasksPage />,
    visible: true,
  },
  {
    name: '技能卡管理',
    path: '/skills',
    element: <SkillsPage />,
    visible: true,
  },
  {
    name: '海马层记忆库',
    path: '/memory',
    element: <MemoryPage />,
    visible: true,
  },
  {
    name: '环境自举器',
    path: '/bootstrap',
    element: <BootstrapPage />,
    visible: true,
  },
  {
    name: '安全监控',
    path: '/security',
    element: <SecurityPage />,
    visible: true,
  },
  {
    name: '层状态可视化',
    path: '/layers',
    element: <LayersPage />,
    visible: true,
  },
  {
    name: '设置',
    path: '/settings',
    element: <SettingsPage />,
    visible: true,
  },
];
