import React from 'react';
import {
  LayoutDashboard,
  TrendingUp,
  Calendar,
  Scale,
  Navigation,
} from 'lucide-react';

export type NavTab =
  | 'dashboard'
  | 'forecast'
  | 'events'
  | 'fleet'
  | 'supply-demand'
  | 'recommendations'
  | 'demand-map'
  | 'system-health'
  | 'model-performance'
  | 'operations-qa';

interface SidebarProps {
  currentTab: NavTab;
  onTabChange: (tab: NavTab) => void;
  pendingRecsCount: number;
  activeEventsCount: number;
  isOpenOnMobile?: boolean;
  onCloseMobile?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentTab,
  onTabChange,
  pendingRecsCount,
  activeEventsCount,
  isOpenOnMobile,
  onCloseMobile,
}) => {
  const navItems: { id: NavTab; label: string; icon: React.ReactNode; badge?: number }[] = [
    { id: 'dashboard', label: 'Main Dashboard', icon: <LayoutDashboard className="w-4 h-4" /> },
    { id: 'forecast', label: 'Demand Forecast', icon: <TrendingUp className="w-4 h-4" /> },
    {
      id: 'events',
      label: 'Event Intelligence',
      icon: <Calendar className="w-4 h-4" />,
      badge: activeEventsCount > 0 ? activeEventsCount : undefined,
    },
    { id: 'supply-demand', label: 'Supply and Demand', icon: <Scale className="w-4 h-4" /> },
    {
      id: 'recommendations',
      label: 'Driver Recommendations',
      icon: <Navigation className="w-4 h-4" />,
      badge: pendingRecsCount > 0 ? pendingRecsCount : undefined,
    },
  ];

  const handleSelect = (tab: NavTab) => {
    onTabChange(tab);
    if (onCloseMobile) onCloseMobile();
  };

  return (
    <>
      {/* Mobile Backdrop */}
      {isOpenOnMobile && (
        <div
          onClick={onCloseMobile}
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 md:hidden"
        />
      )}

      <aside
        className={`w-64 bg-slate-900 border-r border-slate-800 flex flex-col shrink-0 min-h-[calc(100vh-73px)] z-40 ${
          isOpenOnMobile
            ? 'fixed inset-y-0 left-0 shadow-2xl flex'
            : 'hidden md:flex'
        }`}
      >
        <div className="p-4 border-b border-slate-800/80">
          <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block mb-1">
            Operations Console
          </span>
          <p className="text-xs text-slate-200 font-bold">
            GVMC Metropolitan Mobility
          </p>
        </div>

        <nav className="p-2 space-y-1 flex-1">
          {navItems.map((item) => {
            const isActive = currentTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => handleSelect(item.id)}
                className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-lg text-xs font-medium transition cursor-pointer ${
                  isActive
                    ? 'bg-cyan-600 text-white shadow-sm font-semibold'
                    : 'text-slate-300 hover:text-white hover:bg-slate-800/80'
                }`}
              >
                <div className="flex items-center space-x-2.5">
                  {item.icon}
                  <span>{item.label}</span>
                </div>
                {item.badge !== undefined && (
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
                      isActive ? 'bg-white text-cyan-700' : 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-800 text-slate-300 text-[11px] bg-slate-950/40">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-slate-400">Zone Network</span>
            <span className="font-semibold text-cyan-400">30 GVMC Zones</span>
          </div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-slate-400">Virtual Fleet</span>
            <span className="font-semibold text-white">1,200 Vehicles</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-400">Persistence</span>
            <span className="font-semibold text-emerald-400">JSON File Store</span>
          </div>
        </div>
      </aside>
    </>
  );
};
