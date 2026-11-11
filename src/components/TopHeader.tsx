import React from 'react';
import { LogOut, Globe } from 'lucide-react';
import { NavTab } from './Sidebar';

interface TopHeaderProps {
  currentTab: NavTab;
  user: any;
  onLogout: () => void;
}

export const TopHeader: React.FC<TopHeaderProps> = ({
  currentTab,
  user,
  onLogout,
}) => {
  const getTabTitle = (tab: NavTab) => {
    switch (tab) {
      case 'dashboard': return 'Dashboard';
      case 'keys': return 'API Keys';
      case 'playground': return 'Playground';
      case 'models': return 'Models';
      case 'admin': return 'Admin Panel';
      case 'settings': return 'Settings';
      default: return 'Overview';
    }
  };

  return (
    <header className="sticky top-0 z-20 h-16 bg-white/95 backdrop-blur-sm border-b border-zinc-200/80 px-6 sm:px-8 flex items-center justify-between">
      {/* Left: Current Page Title Only */}
      <div>
        <h1 className="text-xl font-semibold text-zinc-900 tracking-tight">
          {getTabTitle(currentTab)}
        </h1>
      </div>

      {/* Right: Clean User Profile & Logout */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2.5">
          {user?.photoURL ? (
            <img
              src={user.photoURL}
              alt={user.displayName || 'User'}
              className="w-7 h-7 rounded-full border border-zinc-200"
            />
          ) : (
            <div className="w-7 h-7 rounded-full bg-zinc-900 text-white flex items-center justify-center text-xs font-semibold">
              {(user?.displayName || user?.email || 'U')[0].toUpperCase()}
            </div>
          )}
          <span className="hidden sm:inline-block text-xs font-medium text-zinc-700 max-w-[150px] truncate">
            {user?.displayName || user?.email || 'Account'}
          </span>
        </div>

        <button
          onClick={onLogout}
          className="text-zinc-400 hover:text-zinc-700 p-1.5 rounded-lg hover:bg-zinc-100 transition-colors cursor-pointer"
          title="Sign Out"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
};
