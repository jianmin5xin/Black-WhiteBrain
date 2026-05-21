import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import { Brain, Zap, Shield } from 'lucide-react';

/* 神经粒子配置 */
const PARTICLES = [
  { cls: 'w-1.5 h-1.5 bg-primary/60',      top: '12%', left: '18%', anim: 'float-a', dur: '6s',  delay: '0s'   },
  { cls: 'w-1 h-1 bg-blue-400/50',          top: '28%', left: '78%', anim: 'float-b', dur: '8s',  delay: '1s'   },
  { cls: 'w-2 h-2 bg-primary/30',           top: '65%', left: '10%', anim: 'float-c', dur: '7s',  delay: '2s'   },
  { cls: 'w-1 h-1 bg-purple-400/50',        top: '72%', left: '85%', anim: 'float-a', dur: '9s',  delay: '0.5s' },
  { cls: 'w-1.5 h-1.5 bg-blue-400/40',     top: '45%', left: '92%', anim: 'float-b', dur: '5s',  delay: '3s'   },
  { cls: 'w-1 h-1 bg-primary/50',           top: '88%', left: '35%', anim: 'float-c', dur: '10s', delay: '1.5s' },
  { cls: 'w-2 h-2 bg-blue-500/20',          top: '20%', left: '55%', anim: 'float-a', dur: '12s', delay: '0.8s' },
  { cls: 'w-1 h-1 bg-primary/40',           top: '55%', left: '40%', anim: 'float-b', dur: '7s',  delay: '4s'   },
];

export default function LoginPage() {
  const navigate = useNavigate();
  const { signInWithUsername, signUpWithUsername } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === 'register' && !agreed) {
      toast.error('请先阅读并同意用户协议和隐私政策');
      return;
    }
    if (!username.trim() || !password.trim()) {
      toast.error('请填写用户名和密码');
      return;
    }
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      toast.error('用户名只允许字母、数字和下划线');
      return;
    }
    setLoading(true);
    try {
      const fn = mode === 'login' ? signInWithUsername : signUpWithUsername;
      const { error } = await fn(username, password);
      if (error) {
        toast.error(mode === 'login' ? '登录失败：' + error.message : '注册失败：' + error.message);
      } else {
        toast.success(mode === 'login' ? '登录成功' : '注册成功');
        navigate('/dashboard');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background neural-grid flex items-center justify-center p-4 relative overflow-hidden">

      {/* ── 背景光晕 ── */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-1/4 left-1/4 w-72 h-72 rounded-full bg-primary/5 blur-3xl" />
        <div className="absolute bottom-1/3 right-1/4 w-96 h-96 rounded-full bg-blue-500/4 blur-3xl" />
        <div className="absolute top-2/3 left-1/2 w-48 h-48 rounded-full bg-purple-500/4 blur-3xl" />
      </div>

      {/* ── 神经粒子 ── */}
      <div className="fixed inset-0 pointer-events-none z-0">
        {PARTICLES.map((p, i) => (
          <div
            key={i}
            className={`absolute rounded-full ${p.cls}`}
            style={{
              top: p.top,
              left: p.left,
              animation: `${p.anim} ${p.dur} ease-in-out ${p.delay} infinite`,
            }}
          />
        ))}
        {/* 连接线装饰 */}
        <svg className="absolute inset-0 w-full h-full opacity-10" xmlns="http://www.w3.org/2000/svg">
          <line x1="18%" y1="12%" x2="55%" y2="20%" stroke="hsl(151 85% 41%)" strokeWidth="0.5" strokeDasharray="4 6" />
          <line x1="55%" y1="20%" x2="78%" y2="28%" stroke="hsl(217 91% 60%)" strokeWidth="0.5" strokeDasharray="4 6" />
          <line x1="10%" y1="65%" x2="40%" y2="55%" stroke="hsl(151 85% 41%)" strokeWidth="0.5" strokeDasharray="4 6" />
          <line x1="40%" y1="55%" x2="85%" y2="72%" stroke="hsl(270 68% 62%)" strokeWidth="0.5" strokeDasharray="4 6" />
        </svg>
      </div>

      <div className="relative z-10 w-full max-w-md">
        {/* ── Logo 区（呼吸动效） ── */}
        <div className="text-center mb-8">
          <div
            className="inline-flex items-center justify-center w-16 h-16 border border-primary/40 bg-primary/10 mb-4"
            style={{ animation: 'breathe 3s ease-in-out infinite' }}
          >
            <Brain className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-2xl font-bold text-balance gradient-text">灰质-白质自举智能体</h1>
          <p className="text-sm text-muted-foreground mt-1 font-mono">网页自动化平台 v1.0</p>
        </div>

        {/* ── 特性标签 ── */}
        <div className="flex gap-2 justify-center mb-6">
          {[
            { icon: Zap,    label: '灰质层执行' },
            { icon: Brain,  label: '白质层推理' },
            { icon: Shield, label: '安全层防护' },
          ].map(({ icon: Icon, label }) => (
            <span key={label} className="flex items-center gap-1 text-xs text-muted-foreground border border-border px-2 py-1 font-mono">
              <Icon className="w-3 h-3" />
              {label}
            </span>
          ))}
        </div>

        {/* ── 登录卡片 ── */}
        <div className="bg-card border border-border p-6">
          {/* 模式切换 */}
          <div className="flex border border-border mb-6">
            {(['login', 'register'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`flex-1 py-2 text-sm font-medium font-mono transition-colors btn-press ${
                  mode === m
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                }`}
              >
                {m === 'login' ? '登录' : '注册'}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="username" className="text-sm font-normal text-muted-foreground font-mono">
                用户名
              </Label>
              <Input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="仅限字母、数字、下划线"
                className="bg-background border-border font-mono text-sm h-9"
                autoComplete="username"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-sm font-normal text-muted-foreground font-mono">
                密码
              </Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="请输入密码"
                className="bg-background border-border font-mono text-sm h-9"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              />
            </div>

            {mode === 'register' && (
              <div className="flex items-start gap-2 pt-1">
                <Checkbox
                  id="agree"
                  checked={agreed}
                  onCheckedChange={(v) => setAgreed(!!v)}
                  className="mt-0.5"
                />
                <Label htmlFor="agree" className="text-xs text-muted-foreground font-mono leading-relaxed cursor-pointer">
                  我已阅读并同意
                  <span className="text-primary"> 《用户协议》</span> 和
                  <span className="text-primary"> 《隐私政策》</span>
                  。本平台收集必要信息用于账号管理，不向第三方共享。
                </Label>
              </div>
            )}

            <Button
              type="submit"
              disabled={loading}
              className="w-full h-9 font-mono text-sm bg-primary text-primary-foreground hover:bg-primary/90 btn-press"
            >
              {loading ? '处理中...' : mode === 'login' ? '登录系统' : '创建账号'}
            </Button>
          </form>

          <p className="text-center text-xs text-muted-foreground mt-4 font-mono">
            {mode === 'login' ? '还没有账号？' : '已有账号？'}
            <button
              onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
              className="text-primary hover:underline ml-1"
            >
              {mode === 'login' ? '立即注册' : '去登录'}
            </button>
          </p>
        </div>

        <p className="text-center text-xs text-muted-foreground/50 mt-4 font-mono">
          灰质-白质自举智能体架构 · 白皮书 v1.0
        </p>
      </div>
    </div>
  );
}
