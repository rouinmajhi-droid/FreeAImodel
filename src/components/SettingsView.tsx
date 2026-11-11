import React from 'react';
import { Settings, ShieldCheck, Globe, Key, CheckCircle2, Lock, Server } from 'lucide-react';
import { DESIGNATED_ADMIN_EMAIL } from '../lib/firebase';
import { useToast } from './Toast';

interface SettingsViewProps {
  userEmail?: string | null;
  isAdmin: boolean;
}

export const SettingsView: React.FC<SettingsViewProps> = ({ userEmail, isAdmin }) => {
  const { showToast } = useToast();
  const currentOrigin = typeof window !== 'undefined' ? window.location.origin : 'https://api.yourdomain.com';

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    showToast('Settings Saved', 'Gateway preferences updated successfully.', 'success');
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-200 max-w-4xl">
      {/* 1. Header */}
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900 tracking-tight">Settings</h1>
        <p className="text-sm text-zinc-600 mt-1">
          Configure gateway routing parameters, failover timeouts, and workspace access policies.
        </p>
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        {/* Gateway URL Configuration */}
        <div className="bg-white rounded-xl border border-zinc-200/80 p-5 sm:p-6 shadow-xs">
          <h2 className="text-base font-semibold text-zinc-900 mb-1">Gateway Endpoint Configuration</h2>
          <p className="text-xs text-zinc-500 mb-4">The public base address your clients use to route completions.</p>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-zinc-700 mb-1.5">
                Base URL
              </label>
              <input
                type="text"
                readOnly
                value={`${currentOrigin}/v1`}
                className="w-full px-3.5 py-2 font-mono text-xs rounded-lg border border-zinc-200 bg-zinc-50 text-zinc-700 outline-none select-all"
              />
              <span className="text-[11px] text-zinc-400 mt-1 block">
                Standard OpenAI SDK `base_url` target.
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-zinc-700 mb-1.5">
                  Failover 429 Cooldown Duration
                </label>
                <select className="w-full px-3 py-2 text-xs rounded-lg border border-zinc-200 bg-white outline-none focus:border-violet-600 font-medium text-zinc-700">
                  <option value="60">60 seconds (Standard)</option>
                  <option value="120">120 seconds (Aggressive)</option>
                  <option value="30">30 seconds (Aggressive retry)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-700 mb-1.5">
                  Maximum Failover Hops
                </label>
                <select className="w-full px-3 py-2 text-xs rounded-lg border border-zinc-200 bg-white outline-none focus:border-violet-600 font-medium text-zinc-700">
                  <option value="5">5 Sequential Keys</option>
                  <option value="10">10 Sequential Keys</option>
                  <option value="unlimited">Unlimited (Traverse full pool)</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* Access & Administration */}
        <div className="bg-white rounded-xl border border-zinc-200/80 p-5 sm:p-6 shadow-xs">
          <h2 className="text-base font-semibold text-zinc-900 mb-1">Admin Access Control</h2>
          <p className="text-xs text-zinc-500 mb-4">Privileged route `/admin` access control and master credentials.</p>

          <div className="space-y-3 text-xs">
            <div className="p-3 bg-zinc-50 rounded-lg border border-zinc-200/60 flex items-center justify-between">
              <div>
                <span className="font-semibold text-zinc-800 block">Designated Master Administrator</span>
                <span className="text-zinc-500 font-mono text-[11px]">{DESIGNATED_ADMIN_EMAIL}</span>
              </div>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-violet-100 text-violet-700">
                Primary Owner
              </span>
            </div>

            <div className="p-3 bg-zinc-50 rounded-lg border border-zinc-200/60 flex items-center justify-between">
              <div>
                <span className="font-semibold text-zinc-800 block">Your Active Session</span>
                <span className="text-zinc-500 font-mono text-[11px]">{userEmail || 'Authenticated'}</span>
              </div>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                isAdmin ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/60' : 'bg-zinc-200 text-zinc-700'
              }`}>
                {isAdmin ? 'Admin Privileges Active' : 'Developer User'}
              </span>
            </div>
          </div>
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            className="px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-xs font-semibold shadow-xs transition-colors cursor-pointer"
          >
            Save Preferences
          </button>
        </div>
      </form>
    </div>
  );
};
