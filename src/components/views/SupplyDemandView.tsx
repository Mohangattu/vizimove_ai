import React, { useState } from 'react';
import { Scale, Sliders, AlertTriangle, CheckCircle2, ShieldAlert } from 'lucide-react';
import { SupplyDemandAnalysis } from '../../lib/types';

interface SupplyDemandViewProps {
  supplyDemand: SupplyDemandAnalysis[];
  onCapacityChange?: (newCapacity: number) => void;
}

export const SupplyDemandView: React.FC<SupplyDemandViewProps> = ({
  supplyDemand,
}) => {
  const [operationalMode, setOperationalMode] = useState<'hourly' | '15min'>('hourly');
  const [capacityAssumption, setCapacityAssumption] = useState<number>(2.2);

  const effectiveCapacity = operationalMode === '15min' ? 0.55 : capacityAssumption;

  // Recalculate metrics dynamically based on slider and operational mode
  const dynamicAnalyses = supplyDemand.map((item) => {
    const demand = operationalMode === '15min' ? Math.max(1, Math.round(item.eventAdjustedDemand / 4)) : item.eventAdjustedDemand;
    const capacity = Math.round(item.availableVehicles * effectiveCapacity * 10) / 10;
    const unmet = Math.max(0, Math.round(demand - capacity));
    const excess = Math.max(0, item.availableVehicles - Math.ceil(demand / effectiveCapacity));

    let severity: 'CRITICAL' | 'MODERATE' | 'BALANCED' | 'SURPLUS' = 'BALANCED';
    if (unmet >= (operationalMode === '15min' ? 4 : 12) || (capacity > 0 && demand / capacity >= 1.6)) {
      severity = 'CRITICAL';
    } else if (unmet > 0) {
      severity = 'MODERATE';
    } else if (excess >= (operationalMode === '15min' ? 2 : 3)) {
      severity = 'SURPLUS';
    }

    return {
      ...item,
      displayDemand: demand,
      displayCapacity: capacity,
      unmet,
      excess,
      severity,
    };
  });

  const totalUnmet = dynamicAnalyses.reduce((sum, d) => sum + d.unmet, 0);
  const totalExcess = dynamicAnalyses.reduce((sum, d) => sum + d.excess, 0);

  return (
    <div className="space-y-6">
      {/* Header and Capacity Parameter Controller */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <Scale className="w-4 h-4 text-cyan-400" />
              Supply-Demand Joint Analysis & Service Capacity
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              30-Zone Operational Comparison • Unfulfilled Passenger Requests vs Idle Vehicle Availability
            </p>
          </div>

          <div className="flex items-center gap-3 text-xs">
            {/* Mode Switcher */}
            <div className="flex items-center bg-slate-950 p-1 rounded-lg border border-slate-800">
              <button
                onClick={() => setOperationalMode('hourly')}
                className={`px-3 py-1 rounded font-medium transition cursor-pointer text-xs ${
                  operationalMode === 'hourly'
                    ? 'bg-cyan-600 text-white font-semibold'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Hourly View
              </button>
              <button
                onClick={() => setOperationalMode('15min')}
                className={`px-3 py-1 rounded font-medium transition cursor-pointer text-xs ${
                  operationalMode === '15min'
                    ? 'bg-cyan-600 text-white font-semibold'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                15-Min Operational
              </button>
            </div>

            <span className="bg-red-950/80 text-red-400 border border-red-800/60 px-2.5 py-1 rounded font-semibold">
              Total Deficit: -{totalUnmet} trips
            </span>
            <span className="bg-emerald-950/80 text-emerald-400 border border-emerald-800/60 px-2.5 py-1 rounded font-semibold">
              Total Surplus: +{totalExcess} vehicles
            </span>
          </div>
        </div>

        {/* Capacity Slider Card */}
        <div className="bg-slate-950/80 border border-slate-800 p-4 rounded-lg flex flex-wrap items-center justify-between gap-4 text-xs">
          <div className="space-y-1">
            <div className="flex items-center space-x-2 font-semibold text-white">
              <Sliders className="w-3.5 h-3.5 text-cyan-400" />
              <span>Service Capacity Assumption:</span>
              <span className="text-cyan-300 font-bold font-mono text-sm">
                {effectiveCapacity} trips / vehicle / {operationalMode === '15min' ? '15m' : 'hour'}
              </span>
            </div>
            <p className="text-[11px] text-slate-400 max-w-xl leading-relaxed">
              {operationalMode === '15min'
                ? 'Empirical 15-minute operational dispatch capacity: 0.55 trips completed per active vehicle.'
                : 'Based on empirical ~27-minute trip turnaround cycles in Visakhapatnam arterial traffic (4 min dispatch + 5 min approach + 14 min trip + 4 min turnaround).'}
            </p>
          </div>

          {operationalMode === 'hourly' && (
            <div className="flex items-center space-x-3">
              <span className="text-slate-400 text-[11px]">1.5 (Congested)</span>
              <input
                type="range"
                min="1.5"
                max="3.5"
                step="0.1"
                value={capacityAssumption}
                onChange={(e) => setCapacityAssumption(parseFloat(e.target.value))}
                className="w-36 accent-cyan-500 cursor-pointer"
              />
              <span className="text-slate-400 text-[11px]">3.5 (Rapid)</span>
            </div>
          )}
        </div>
      </div>

      {/* 30-Zone Matrix Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-950 text-slate-400 uppercase text-[10px] tracking-wider border-b border-slate-800 font-semibold">
              <tr>
                <th className="py-3 px-4">Zone ID & Name</th>
                <th className="py-3 px-3">Base Demand</th>
                <th className="py-3 px-3">Event Lift</th>
                <th className="py-3 px-3 font-bold text-white">Adjusted Demand ({operationalMode === '15min' ? '15m' : '1h'})</th>
                <th className="py-3 px-3 text-emerald-400 font-bold">Avail. Fleet</th>
                <th className="py-3 px-3">Service Capacity</th>
                <th className="py-3 px-4 text-right">Net Shortage / Surplus</th>
                <th className="py-3 px-4 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {dynamicAnalyses.map((item) => (
                <tr key={item.zoneId} className="hover:bg-slate-800/40 transition">
                  <td className="py-3 px-4">
                    <div className="flex items-center space-x-2">
                      <span className="font-mono text-cyan-400 font-bold text-[11px] bg-slate-950 px-1.5 py-0.5 rounded border border-slate-800">
                        {item.zoneId}
                      </span>
                      <span className="font-semibold text-white">{item.zoneName}</span>
                    </div>
                  </td>
                  <td className="py-3 px-3 text-slate-400">
                    {operationalMode === '15min' ? Math.max(1, Math.round(item.baseDemand / 4)) : item.baseDemand} {operationalMode === '15min' ? '/15m' : '/hr'}
                  </td>
                  <td className="py-3 px-3">
                    {item.displayDemand > (operationalMode === '15min' ? Math.max(1, Math.round(item.baseDemand / 4)) : item.baseDemand) ? (
                      <span className="text-purple-400 font-bold">
                        +{item.displayDemand - (operationalMode === '15min' ? Math.max(1, Math.round(item.baseDemand / 4)) : item.baseDemand)}
                      </span>
                    ) : (
                      <span className="text-slate-500">—</span>
                    )}
                  </td>
                  <td className="py-3 px-3 font-bold text-white">
                    {item.displayDemand} <span className="text-slate-500 font-normal">{operationalMode === '15min' ? 'trips/15m' : 'trips/hr'}</span>
                  </td>
                  <td className="py-3 px-3 font-bold text-emerald-400">
                    {item.availableVehicles} <span className="text-slate-500 font-normal">veh</span>
                  </td>
                  <td className="py-3 px-3 text-slate-300">
                    {item.displayCapacity} {operationalMode === '15min' ? 'trips/15m' : 'trips/hr'}
                  </td>
                  <td className="py-3 px-4 text-right">
                    {item.unmet > 0 ? (
                      <span className="font-extrabold text-red-400">
                        -{item.unmet} trips
                      </span>
                    ) : item.excess > 0 ? (
                      <span className="font-extrabold text-emerald-400">
                        +{item.excess} veh idle
                      </span>
                    ) : (
                      <span className="text-slate-400 font-medium">Balanced</span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-center">
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider ${
                        item.severity === 'CRITICAL'
                          ? 'bg-red-950 text-red-400 border border-red-800'
                          : item.severity === 'MODERATE'
                          ? 'bg-amber-950 text-amber-400 border border-amber-800'
                          : item.severity === 'SURPLUS'
                          ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                          : 'bg-blue-950 text-blue-400 border border-blue-800'
                      }`}
                    >
                      {item.severity}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
