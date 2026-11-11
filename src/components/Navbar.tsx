import React from 'react';
import { 
  Zap, 
  ShieldCheck, 
  LayoutDashboard, 
  Terminal, 
  BookOpen, 
  LogOut, 
  LogIn, 
  User, 
  Sparkles,
  Server
} from 'lucide-react';
import { DESIGNATED_ADMIN_EMAIL } from '../lib/firebase';

interface NavbarProps {
  currentTab: 'dashboard' | 'playground' | 'docs' | 'admin';
  onSelectTab: (tab: 'dashboard' | 'playground' | 'docs' | 'admin') => void;
  user: any;
  isAdmin: boolean;
  onLogin: () => void;
  onLogout: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentTab,
  onSelectTab,
  user,
  isAdmin,
  onLogin,
  onLogout,
}) => {
  return (
    <header className="sticky top-0 z-40 bg-white/85 backdrop-blur-md border-b border-slate-200/80">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
        {/* Brand */}
        <div className="flex items-center gap-6">
          <button
            onClick={() => onSelectTab('dashboard')}
            className="flex items-center gap-2.5 group cursor-pointer text-left"
          >
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-violet-600 to-purple-600 flex items-center justify-center text-white shadow-md shadow-violet-500/25 transition-transform group-hover:scale-105">
              <Zap className="w-5 h-5 fill-white" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-lg font-black tracking-tight text-slate-900 group-hover:text-violet-600 transition-colors">
                  Nexus<span className="text-violet-600">Gate</span>
                </span>
                <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-violet-100 text-violet-700">
                  v1.0
                </span>
              </div>
              <span className="text-[10px] text-slate-400 font-medium tracking-wider uppercase block">
                Universal AI Gateway
              </span>
            </div>
          </button>

          {/* Navigation Links (Desktop) */}
          <nav className="hidden md:flex items-center gap-1 text-xs font-semibold">
            <button
              onClick={() => onSelectTab('dashboard')}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl transition-all cursor-pointer ${
                currentTab === 'dashboard'
                  ? 'bg-violet-50 text-violet-700 font-bold'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
              }`}
            >
              <LayoutDashboard className="w-4 h-4" />
              <span>Dashboard</span>
            </button>

            <button
              onClick={() => onSelectTab('playground')}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl transition-all cursor-pointer ${
                currentTab === 'playground'
                  ? 'bg-violet-50 text-violet-700 font-bold'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
              }`}
            >
              <Terminal className="w-4 h-4" />
              <span>Playground</span>
            </button>

            <button
              onClick={() => onSelectTab('docs')}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl transition-all cursor-pointer ${
                currentTab === 'docs'
                  ? 'bg-violet-50 text-violet-700 font-bold'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
              }`}
            >
              <BookOpen className="w-4 h-4" />
              <span>API Reference</span>
            </button>

            {/* Admin Tab */}
            <button
              onClick={() => onSelectTab('admin')}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl transition-all cursor-pointer ${
                currentTab === 'admin'
                  ? 'bg-violet-600 text-white font-bold shadow-sm shadow-violet-500/25'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
              }`}
            >
              <ShieldCheck className="w-4 h-4" />
              <span>Admin Panel</span>
              {isAdmin && (
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              )}
            </button>
          </nav>
        </div>

        {/* Right Status & Auth */}
        <div className="flex items-center gap-3">
          {/* Operational Indicator */}
          <div className="hidden lg:flex items-center gap-2 px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 text-[11px] font-medium">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
            <span>Router Online</span>
          </div>

          {user ? (
            <div className="flex items-center gap-2.5">
              <div className="flex items-center gap-2 bg-slate-50 px-2.5 py-1.5 rounded-xl border border-slate-200">
                {user.photoURL ? (
                  <img
                    src={user.photoURL}
                    alt={user.displayName || 'User'}
                    className="w-6 h-6 rounded-full border border-slate-300"
                  />
                ) : (
                  <div className="w-6 h-6 rounded-full bg-violet-600 text-white flex items-center justify-center text-xs font-bold">
                    {(user.displayName || user.email || 'U')[0].toUpperCase()}
                  </div>
                )}
                <div className="hidden sm:block text-left">
                  <span className="text-xs font-bold text-slate-800 block truncate max-w-[120px]">
                    {user.displayName || user.email?.split('@')[0]}
                  </span>
                  {isAdmin && (
                    <span className="text-[10px] text-violet-600 font-semibold block">Admin</span>
                  )}
                </div>
              </div>

              <button
                onClick={onLogout}
                className="text-slate-400 hover:text-slate-700 p-2 rounded-xl hover:bg-slate-100 transition-colors cursor-pointer"
                title="Sign Out"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <button
              onClick={onLogin}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white font-semibold text-xs shadow-md shadow-violet-500/20 transition-all cursor-pointer"
            >
              <LogIn className="w-4 h-4" />
              <span>Sign In with Google</span>
            </button>
          )}
        </div>
      </div>

      {/* Mobile Nav Bar */}
      <div className="md:hidden flex items-center justify-around border-t border-slate-100 px-2 py-1.5 text-xs font-medium">
        <button
          onClick={() => onSelectTab('dashboard')}
          className={`py-1.5 px-3 rounded-lg ${currentTab === 'dashboard' ? 'text-violet-700 font-bold bg-violet-50' : 'text-slate-600'}`}
        >
          Dashboard
        </button>
        <button
          onClick={() => onSelectTab('playground')}
          className={`py-1.5 px-3 rounded-lg ${currentTab === 'playground' ? 'text-violet-700 font-bold bg-violet-50' : 'text-slate-600'}`}
        >
          Playground
        </button>
        <button
          onClick={() => onSelectTab('docs')}
          className={`py-1.5 px-3 rounded-lg ${currentTab === 'docs' ? 'text-violet-700 font-bold bg-violet-50' : 'text-slate-600'}`}
        >
          Docs
        </button>
        <button
          onClick={() => onSelectTab('admin')}
          className={`py-1.5 px-3 rounded-lg ${currentTab === 'admin' ? 'text-violet-700 font-bold bg-violet-50' : 'text-slate-600'}`}
        >
          Admin
        </button>
      </div>
    </header>
  );
};
