import React from 'react';
import { 
  LayoutDashboard, 
  Key, 
  Terminal, 
  Layers, 
  Settings, 
  ShieldCheck, 
  LogOut, 
  Zap
} from 'lucide-react';

export type NavTab = 
  | 'dashboard' 
  | 'keys' 
  | 'playground' 
  | 'models' 
  | 'admin' 
  | 'settings';

interface SidebarProps {
  currentTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  user: any;
  isAdmin: boolean;
  onLogout: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentTab,
  onSelectTab,
  user,
  isAdmin,
  onLogout,
}) => {
  const navItems: { id: NavTab; label: string; icon: React.ElementType; badge?: string }[] = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'keys', label: 'API Keys', icon: Key },
    { id: 'playground', label: 'Playground', icon: Terminal },
    { id: 'models', label: 'Models', icon: Layers },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  return (
    <aside className="w-[260px] h-screen sticky top-0 shrink-0 z-30 bg-white border-r border-zinc-200/80 flex flex-col justify-between text-zinc-900 select-none">
      {/* 1. Brand Logo */}
      <div>
        <div className="px-6 py-5 border-b border-zinc-100 flex items-center justify-between">
          <div 
            onClick={() => onSelectTab('dashboard')} 
            className="flex items-center gap-2.5 cursor-pointer group"
          >
            <div className="w-8 h-8 rounded-lg bg-violet-600 flex items-center justify-center text-white shadow-xs group-hover:bg-violet-700 transition-colors">
              <Zap className="w-4 h-4 fill-white text-white" />
            </div>
            <div>
              <span className="font-bold text-base tracking-tight text-zinc-900 block leading-tight">
                FreeAIModel
              </span>
              <span className="text-[11px] text-zinc-400 font-medium">Universal AI Gateway</span>
            </div>
          </div>
        </div>

        {/* 2. Navigation List - Directly visible on screen without extra clicks */}
        <nav className="px-3 py-4 space-y-1">
          <div className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
            Platform Menu
          </div>

          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentTab === item.id;

            return (
              <button
                key={item.id}
                onClick={() => onSelectTab(item.id)}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                  isActive
                    ? 'bg-zinc-100 text-zinc-950 font-semibold'
                    : 'text-zinc-600 hover:text-zinc-950 hover:bg-zinc-50'
                }`}
              >
                <div className="flex items-center gap-3">
                  <Icon
                    className={`w-4 h-4 transition-colors ${
                      isActive ? 'text-violet-600' : 'text-zinc-400'
                    }`}
                  />
                  <span>{item.label}</span>
                </div>

                {item.badge && (
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-violet-100 text-violet-700">
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* 3. Bottom User Profile & Sign Out */}
      <div className="p-4 border-t border-zinc-100 space-y-2.5">
        {isAdmin && (
          <button
            onClick={() => onSelectTab('admin')}
            className="w-full flex items-center justify-between px-3 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer"
          >
            <span className="flex items-center gap-2">
              <ShieldCheck className="w-3.5 h-3.5 text-violet-400" />
              <span>Admin Console</span>
            </span>
            <span className="text-[10px] font-mono text-zinc-400">/admin</span>
          </button>
        )}
        <div className="flex items-center justify-between p-2 rounded-xl bg-zinc-50 border border-zinc-200/60">
          <div className="flex items-center gap-2.5 min-w-0">
            {user?.photoURL ? (
              <img
                src={user.photoURL}
                alt={user.displayName || 'User'}
                className="w-7 h-7 rounded-full border border-zinc-200 shrink-0"
              />
            ) : (
              <div className="w-7 h-7 rounded-full bg-zinc-900 text-white flex items-center justify-center text-xs font-semibold shrink-0">
                {(user?.displayName || user?.email || 'U')[0].toUpperCase()}
              </div>
            )}
            <div className="min-w-0 text-left">
              <p className="text-xs font-semibold text-zinc-900 truncate">
                {user?.displayName || user?.email?.split('@')[0] || 'User'}
              </p>
              <p className="text-[10px] text-zinc-400 truncate">
                {user?.email || 'Active'}
              </p>
            </div>
          </div>

          <button
            onClick={onLogout}
            className="text-zinc-400 hover:text-rose-600 p-1.5 rounded-lg hover:bg-rose-50 transition-colors cursor-pointer"
            title="Sign Out"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </aside>
  );
};
