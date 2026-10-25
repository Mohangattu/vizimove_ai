import React, { useState, useEffect } from 'react';
import { Activity, ShieldCheck, Clock, MapPin, RefreshCw, Play, CheckCircle2 } from 'lucide-react';
import { SystemHealthStatus } from '../lib/provenance';
import { OperationsSummary } from '../lib/types';
import { api } from '../services/api';

interface HeaderProps {
  health: SystemHealthStatus | null;
  operationsSummary: OperationsSummary | null;
  onRefresh: () => void;
  isRefreshing: boolean;
  onToggleMobileMenu?: () => void;
  isMobileMenuOpen?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  health,
  operationsSummary,
  onRefresh,
  isRefreshing,
  onToggleMobileMenu,
  isMobileMenuOpen,
}) => {
  const [vizagTime, setVizagTime] = useState<string>('');
  const [isTriggeringCycle, setIsTriggeringCycle] = useState<boolean>(false);
  const [cycleSuccessNotice, setCycleSuccessNotice] = useState<string | null>(null);

  useEffect(() => {
    const updateTime = () => {
      // Visakhapatnam is in Indian Standard Time (UTC+5:30)
      const now = new Date();
      const istString = now.toLocaleTimeString('en-IN', {
        timeZone: 'Asia/Kolkata',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
      });
      setVizagTime(`${istString} IST`);
    };

    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  const handleTriggerCycle = async () => {
    setIsTriggeringCycle(true);
    try {
      const res = await api.triggerPipelineCycle();
      setCycleSuccessNotice(`Cycle ${res.cycleRun?.runId} done (${res.cycleRun?.durationMs}ms)`);
      setTimeout(() => setCycleSuccessNotice(null), 4000);
      onRefresh();
    } catch (e: any) {
      console.error(e);
      alert(`Cycle trigger error: ${e.message}`);
    } finally {
      setIsTriggeringCycle(false);
    }
  };

  return (
    <>
      <header className="bg-slate-900 border-b border-slate-800 text-white px-4 md:px-6 py-3 flex flex-wrap items-center justify-between gap-3 sticky top-0 z-30 shadow-md">
        {/* Brand & City Title */}
        <div className="flex items-center space-x-3">
          {onToggleMobileMenu && (
            <button
              onClick={onToggleMobileMenu}
              className="md:hidden p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg border border-slate-700 transition cursor-pointer"
              aria-label="Toggle Navigation Menu"
            >
              <div className="w-4 h-3.5 flex flex-col justify-between">
                <span className={`h-0.5 bg-white transition-all ${isMobileMenuOpen ? 'rotate-45 translate-y-1.5' : ''}`} />
                <span className={`h-0.5 bg-white transition-all ${isMobileMenuOpen ? 'opacity-0' : ''}`} />
                <span className={`h-0.5 bg-white transition-all ${isMobileMenuOpen ? '-rotate-45 -translate-y-1.5' : ''}`} />
              </div>
            </button>
          )}
          <div className="w-9 h-9 rounded-lg bg-gradient-to-tr from-cyan-600 to-blue-600 flex items-center justify-center font-black text-lg shadow-inner tracking-tight">
            VM
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="text-xl font-bold tracking-tight text-white">ViziMove AI</h1>
              <span className="bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 text-xs px-2 py-0.5 rounded-full font-medium">
                Operations Center
              </span>
            </div>
            <p className="text-xs text-slate-400 flex items-center gap-1.5 mt-0.5">
              <MapPin className="w-3 h-3 text-cyan-400" />
              Visakhapatnam (Vizag) Metropolitan Region • Andhra Pradesh, India
            </p>
          </div>
        </div>

        {/* Operational Stats & Time Bar */}
        <div className="flex items-center flex-wrap gap-2.5">
          {/* Local IST Clock */}
          <div className="bg-slate-800/80 border border-slate-700/60 rounded-lg px-2.5 py-1.5 flex items-center space-x-2 text-xs text-slate-300">
            <Clock className="w-3.5 h-3.5 text-cyan-400" />
            <span className="font-mono text-cyan-200">{vizagTime || '08:30:00 PM IST'}</span>
          </div>

          {/* 15-Minute Operational Loop Badge & Trigger */}
          <div className="flex items-center bg-slate-800/90 border border-cyan-800/60 rounded-lg p-1 text-xs">
            <div className="px-2 py-0.5 flex items-center gap-1.5 text-cyan-300">
              <div className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
              <span className="font-semibold text-[11px]">15-Min Operational Loop</span>
            </div>
            <button
              onClick={handleTriggerCycle}
              disabled={isTriggeringCycle}
              className="px-2.5 py-1 bg-cyan-600 hover:bg-cyan-500 text-white rounded text-[11px] font-semibold flex items-center gap-1 transition cursor-pointer disabled:opacity-50"
              title="Run 15-Minute Operational Pipeline Cycle immediately"
            >
              <Play className={`w-3 h-3 ${isTriggeringCycle ? 'animate-spin' : ''}`} />
              {isTriggeringCycle ? 'Running...' : 'Run Cycle'}
            </button>
          </div>

          {cycleSuccessNotice && (
            <div className="bg-emerald-950/90 border border-emerald-600/60 text-emerald-300 text-xs px-2.5 py-1.5 rounded-lg flex items-center gap-1 animate-in fade-in">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              <span>{cycleSuccessNotice}</span>
            </div>
          )}

          {/* Refresh Button */}
          <button
            onClick={onRefresh}
            disabled={isRefreshing}
            className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-lg border border-slate-700 transition flex items-center justify-center cursor-pointer disabled:opacity-50"
            title="Refresh Operations State"
            aria-label="Refresh Operations State"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-cyan-400' : ''}`} />
          </button>
        </div>
      </header>
    </>
  );
};

