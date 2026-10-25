import React, { useState, useEffect } from 'react';
import {
  Navigation,
  CheckCircle2,
  XCircle,
  Clock,
  Sparkles,
  MapPin,
  TrendingUp,
  ShieldAlert,
  ArrowRight,
  RefreshCw,
  Car,
  Layers,
  AlertCircle,
  Activity,
  Battery,
} from 'lucide-react';
import { DriverRecommendation, RecommendationStatus, VirtualVehicle } from '../../lib/types';
import { api } from '../../services/api';

interface RecommendationsViewProps {
  recommendations: DriverRecommendation[];
  onRefreshRecommendations: () => void;
}

export const RecommendationsView: React.FC<RecommendationsViewProps> = ({
  recommendations,
  onRefreshRecommendations,
}) => {
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [pipelineStatus, setPipelineStatus] = useState<any>(null);
  const [fleetSummary, setFleetSummary] = useState<any>(null);
  const [activeMovements, setActiveMovements] = useState<VirtualVehicle[]>([]);
  const [dispatchStatus, setDispatchStatus] = useState<any>(null);

  const loadPipelineAndFleet = async () => {
    try {
      const [pipe, fleet, movements, disp] = await Promise.all([
        api.getPipelineStatus(),
        api.getFleet(),
        api.getActiveMovements(),
        api.getDispatchStatus(),
      ]);
      if (pipe) setPipelineStatus(pipe);
      if (fleet?.summary) setFleetSummary(fleet.summary);
      if (movements) setActiveMovements(movements);
      if (disp) setDispatchStatus(disp);
    } catch (e) {
      console.warn('[Recommendations] Context temporarily unavailable:', e);
    }
  };

  useEffect(() => {
    loadPipelineAndFleet();
    // 4-second polling ticker to smoothly update active movement progress and arrival states
    const timer = setInterval(loadPipelineAndFleet, 4000);
    return () => clearInterval(timer);
  }, [recommendations]);

  const handleGenerate = async () => {
    setIsGenerating(true);
    try {
      await api.triggerPipelineCycle();
      await loadPipelineAndFleet();
      onRefreshRecommendations();
    } catch (err) {
      console.error('Failed to run cycle', err);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleComplete = async (id: string) => {
    setActionInProgress(id);
    try {
      await api.completeRecommendation(id);
      await loadPipelineAndFleet();
      onRefreshRecommendations();
    } catch (err) {
      console.error('Failed to complete recommendation', err);
    } finally {
      setActionInProgress(null);
    }
  };

  const handleCancel = async (id: string) => {
    setActionInProgress(id);
    try {
      await api.cancelRecommendation(id);
      await loadPipelineAndFleet();
      onRefreshRecommendations();
    } catch (err) {
      console.error('Failed to cancel recommendation', err);
    } finally {
      setActionInProgress(null);
    }
  };

  const filteredRecs = recommendations.filter((r) => {
    if (statusFilter === 'ALL') return true;
    return r.status === statusFilter;
  });

  const latestCycle = pipelineStatus?.latestCompletedCycle;

  return (
    <div className="space-y-6">
      {/* Latest Processing Time & Autonomous Engine Context Bar */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4 pb-3 border-b border-slate-800">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <Navigation className="w-4 h-4 text-cyan-400" />
                Forecast-Driven Driver Repositioning
              </h2>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800 font-semibold">
                60-MIN HORIZON SYNCHRONIZED
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Identifies zones where expected demand exceeds service capacity and automatically dispatches surplus vehicles.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleGenerate}
              disabled={isGenerating}
              className="px-3.5 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer shadow-sm disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isGenerating ? 'animate-spin' : ''}`} />
              Re-evaluate Forecast & Dispatch
            </button>
          </div>
        </div>

        {/* Telemetry and Fleet Status Summary Row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-3 text-xs">
          <div className="bg-slate-950/80 p-2.5 rounded-lg border border-slate-800/80">
            <span className="text-slate-500 block text-[10px] uppercase font-semibold">Operational Cycle</span>
            <span className="font-mono text-cyan-300 font-bold">
              {latestCycle?.timestamp
                ? new Date(latestCycle.timestamp).toLocaleTimeString('en-IN', {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    timeZone: 'Asia/Kolkata',
                  }) + ' IST'
                : '15-min scheduled'}
            </span>
          </div>

          <div className="bg-slate-950/80 p-2.5 rounded-lg border border-slate-800/80">
            <span className="text-slate-500 block text-[10px] uppercase font-semibold">Available Fleet</span>
            <span className="font-mono text-emerald-400 font-bold">
              {fleetSummary?.available || 0} vehicles ready
            </span>
          </div>

          <div className="bg-slate-950/80 p-2.5 rounded-lg border border-slate-800/80">
            <span className="text-slate-500 block text-[10px] uppercase font-semibold">En Route (In Transit)</span>
            <span className="font-mono text-purple-300 font-bold">
              {fleetSummary?.enRoute || activeMovements.length} moving
            </span>
          </div>

          <div className="bg-slate-950/80 p-2.5 rounded-lg border border-slate-800/80">
            <span className="text-slate-500 block text-[10px] uppercase font-semibold">Fleet Utilization</span>
            <span className="font-mono text-white font-bold">
              {fleetSummary?.utilizationRate || 0}% active
            </span>
          </div>

          <div className="bg-slate-950/80 p-2.5 rounded-lg border border-slate-800/80 col-span-2 sm:col-span-1">
            <span className="text-slate-500 block text-[10px] uppercase font-semibold">Operational Range</span>
            <span className="font-mono text-cyan-400 font-bold">
              ≤12 km • ≤32 min
            </span>
          </div>
        </div>

        {/* Autonomous Dispatch Status Banner */}
        {dispatchStatus && (
          <div className="bg-emerald-950/60 border border-emerald-800 p-3 rounded-lg text-xs text-emerald-200 flex items-start gap-2">
            <Sparkles className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span className="font-bold text-emerald-300 uppercase tracking-wide text-[10px] bg-emerald-900 px-2 py-0.5 rounded border border-emerald-700">
                AUTONOMOUS DISPATCH ENABLED
              </span>
              <span className="text-emerald-400">
                En Route: <strong className="text-white">{dispatchStatus.enRouteVehicles}</strong> vehicles
              </span>
              <span className="text-emerald-400">
                Dispatched Recommendations: <strong className="text-white">{dispatchStatus.dispatchedCount}</strong>
              </span>
              {dispatchStatus.pendingCount > 0 && (
                <span className="text-amber-400">
                  {dispatchStatus.pendingCount} queued for next cycle
                </span>
              )}
            </div>
          </div>
        )}

        {/* Simulation Notice */}
        <div className="bg-slate-950/60 border border-slate-800 p-3 rounded-lg text-[11px] text-slate-400 flex items-start gap-2">
          <ShieldAlert className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
          <span>
            <strong className="text-slate-200">Tracking Protocol (Simulated):</strong> En-route vehicle progression and arrival times are calculated from deterministic movement durations. No physical GPS hardware or live vehicle trackers are connected.
          </span>
        </div>
      </div>

      {/* SECTION 1: DEDICATED ACTIVE EN-ROUTE MOVEMENTS TRACKER */}
      <div className="bg-slate-900 border border-purple-900/60 rounded-xl overflow-hidden shadow-sm">
        <div className="p-4 bg-slate-950/70 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="relative flex items-center justify-center">
              <div className="w-3 h-3 rounded-full bg-purple-500 animate-ping absolute" />
              <div className="w-2.5 h-2.5 rounded-full bg-purple-400 relative" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                Active En-Route Movements & Transit Progression
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-800">
                  SIMULATED
                </span>
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Real-time tracking of vehicles dispatched to cover forecast deficits. Automatically verified upon arrival.
              </p>
            </div>
          </div>

          <span className="text-xs font-mono bg-purple-950 text-purple-300 border border-purple-800 px-2.5 py-1 rounded font-bold">
            {activeMovements.length} Vehicles in Transit
          </span>
        </div>

        {activeMovements.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-xs">
            <CheckCircle2 className="w-7 h-7 text-emerald-400 mx-auto mb-2 opacity-80" />
            <p className="font-semibold text-white">No Vehicles Currently in Transit</p>
            <p className="text-slate-500 mt-1">
              All vehicles are staged in available or busy status. New repositioning will dispatch when demand deficits are forecast.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-slate-950/90 text-slate-400 uppercase text-[10px] tracking-wider border-b border-slate-800 font-semibold">
                <tr>
                  <th className="py-2.5 px-4">Vehicle ID</th>
                  <th className="py-2.5 px-3">Transit Corridor</th>
                  <th className="py-2.5 px-3">Departure</th>
                  <th className="py-2.5 px-3">Est. Arrival</th>
                  <th className="py-2.5 px-3">Elapsed / Remaining</th>
                  <th className="py-2.5 px-4">Progress</th>
                  <th className="py-2.5 px-3">Recommendation</th>
                  <th className="py-2.5 px-3 text-right">Battery</th>
                  <th className="py-2.5 px-3 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono text-[11px]">
                {activeMovements.map((v) => {
                  const progressPct = v.movementProgressPct ?? 10;
                  return (
                    <tr key={v.id} className="hover:bg-slate-800/40 transition">
                      <td className="py-3 px-4 font-bold text-cyan-400 flex items-center gap-1.5">
                        <Car className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span>{v.id}</span>
                      </td>
                      <td className="py-3 px-3">
                        <div className="flex items-center gap-1.5 font-bold text-white font-sans text-xs">
                          <span className="text-slate-300">{v.zoneId}</span>
                          <ArrowRight className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                          <span className="text-purple-300">{v.targetZoneName || v.targetZoneId}</span>
                        </div>
                      </td>
                      <td className="py-3 px-3 text-slate-300 font-sans text-[11px]">
                        {v.movementStartedAt
                          ? new Date(v.movementStartedAt).toLocaleTimeString('en-IN', {
                              hour: '2-digit',
                              minute: '2-digit',
                              timeZone: 'Asia/Kolkata',
                            })
                          : 'Recent'}
                      </td>
                      <td className="py-3 px-3 text-slate-300 font-sans text-[11px]">
                        {v.estimatedArrivalAt
                          ? new Date(v.estimatedArrivalAt).toLocaleTimeString('en-IN', {
                              hour: '2-digit',
                              minute: '2-digit',
                              timeZone: 'Asia/Kolkata',
                            })
                          : 'In 12m'}
                      </td>
                      <td className="py-3 px-3 font-sans text-[11px]">
                        <span className="text-slate-300">{v.elapsedMinutes !== undefined ? `${v.elapsedMinutes}m el.` : '—'}</span>
                        {' • '}
                        <span className="text-cyan-400 font-semibold">{v.remainingMinutes !== undefined ? `${v.remainingMinutes}m left` : '—'}</span>
                      </td>
                      <td className="py-3 px-4 font-sans">
                        <div className="w-28 bg-slate-950 rounded-full h-2 border border-slate-800 overflow-hidden mb-1">
                          <div
                            className="bg-gradient-to-r from-purple-600 to-cyan-500 h-2 rounded-full transition-all duration-300"
                            style={{ width: `${progressPct}%` }}
                          />
                        </div>
                        <span className="text-[10px] text-purple-300 font-mono block">
                          {progressPct}% (Simulated)
                        </span>
                      </td>
                      <td className="py-3 px-3 text-slate-400 text-[10px]">
                        {v.assignedRecommendationId || 'REPOSITION-AUTO'}
                      </td>
                      <td className="py-3 px-3 text-right font-sans">
                        <span className="text-emerald-400 font-semibold">{v.batteryOrFuelLevel}%</span>
                      </td>
                      <td className="py-3 px-3 text-center">
                        {v.assignedRecommendationId && (
                          <button
                            onClick={() => handleComplete(v.assignedRecommendationId!)}
                            disabled={actionInProgress === v.assignedRecommendationId}
                            className="px-2 py-1 bg-emerald-950 hover:bg-emerald-900 text-emerald-300 border border-emerald-800 rounded text-[10px] font-sans font-medium transition cursor-pointer disabled:opacity-50"
                            title="Verify Arrival (Simulated)"
                          >
                            Verify Arrival
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* SECTION 2: FORECAST-DRIVEN RECOMMENDATIONS LIST */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center space-x-1 bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs">
            {['ALL', 'DISPATCHED', 'PENDING', 'COMPLETED', 'CANCELLED'].map((st) => (
              <button
                key={st}
                onClick={() => setStatusFilter(st)}
                className={`px-3 py-1 rounded font-medium transition cursor-pointer text-[11px] ${
                  statusFilter === st ? 'bg-cyan-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'
                }`}
              >
                {st === 'ALL'
                  ? 'All Recommendations'
                  : st === 'DISPATCHED'
                  ? 'En Route / Dispatched'
                  : st === 'PENDING'
                  ? 'Queued'
                  : st === 'COMPLETED'
                  ? 'Completed'
                  : 'Cancelled'}
              </button>
            ))}
          </div>

          <span className="text-xs text-slate-400">
            Showing <strong>{filteredRecs.length}</strong> recommendations ({recommendations.filter(r => r.status === 'DISPATCHED').length} active en route)
          </span>
        </div>

        {/* Recommendations Cards Grid */}
        {filteredRecs.length === 0 ? (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-12 text-center text-slate-400 text-xs">
            <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto mb-2 opacity-80" />
            <p className="font-semibold text-white">No Recommendations Match Current Filter</p>
            <p className="text-slate-500 mt-1">
              Change the filter or trigger an operational cycle to evaluate upcoming forecast windows.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {filteredRecs.map((rec) => {
              const isActing = actionInProgress === rec.id;

              return (
                <div
                  key={rec.id}
                  className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col justify-between shadow-sm hover:border-slate-700 transition"
                >
                  <div>
                    {/* Card Header */}
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-xs font-bold text-slate-300 bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                          {rec.id}
                        </span>
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800">
                          60M FORECAST
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase ${
                            rec.priority === 'CRITICAL'
                              ? 'bg-red-950 text-red-400 border border-red-800/60'
                              : rec.priority === 'HIGH'
                              ? 'bg-amber-950 text-amber-400 border border-amber-800/60'
                              : 'bg-blue-950 text-blue-400 border border-blue-800/60'
                          }`}
                        >
                          {rec.priority}
                        </span>
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase ${
                            rec.status === 'PENDING'
                              ? 'bg-yellow-950/80 text-yellow-300 border border-yellow-800/60'
                              : rec.status === 'DISPATCHED'
                              ? 'bg-purple-950/80 text-purple-300 border border-purple-800/60'
                              : rec.status === 'COMPLETED'
                              ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-800/60'
                              : 'bg-slate-800 text-slate-400'
                          }`}
                        >
                          {rec.status === 'DISPATCHED' ? 'EN ROUTE' : rec.status}
                        </span>
                      </div>
                    </div>

                    {/* Route corridor */}
                    <div className="text-sm font-bold text-white mb-3 flex items-center gap-2">
                      <span>{rec.sourceZoneName}</span>
                      <ArrowRight className="w-4 h-4 text-cyan-400 shrink-0" />
                      <span className="text-cyan-300">{rec.targetZoneName}</span>
                    </div>

                    {/* FORECAST EVIDENCE PANEL */}
                    <div className="bg-slate-950/90 border border-slate-800 p-3 rounded-lg text-xs space-y-1.5 mb-3">
                      <div className="text-[10px] font-semibold uppercase text-slate-400 tracking-wider flex items-center gap-1 mb-1 border-b border-slate-800/60 pb-1">
                        <TrendingUp className="w-3 h-3 text-cyan-400" />
                        Forecast Evidence & Demand Analysis
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">Target 60m Demand:</span>
                        <strong className="text-white font-mono">
                          {rec.supportingData?.targetDemand ?? '—'} trips
                        </strong>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">Shortage Deficit:</span>
                        <strong className="text-red-400 font-mono">
                          -{rec.supportingData?.targetShortage ?? 0} trips
                        </strong>
                      </div>
                      {rec.supportingData?.peak15mDemand && (
                        <div className="flex justify-between">
                          <span className="text-slate-400">Peak 15m Surge:</span>
                          <span className="text-amber-300 font-mono">
                            {rec.supportingData.peak15mDemand} trips ({rec.supportingData.peak15mInterval || 'sub-hourly'})
                          </span>
                        </div>
                      )}
                      <div className="flex justify-between">
                        <span className="text-slate-400">Source Surplus Pool:</span>
                        <span className="text-emerald-400 font-mono">
                          {rec.supportingData?.sourceSurplus ?? 0} idle vehicles
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">Reposition Volume:</span>
                        <strong className="text-cyan-300 font-mono">
                          {rec.recommendedVehicleCount} vehicles
                        </strong>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">Distance & Travel Time:</span>
                        <span className="text-slate-300">
                          {rec.estimatedTravelDistanceKm} km (~{rec.estimatedTravelTimeMin} min)
                        </span>
                      </div>
                    </div>

                    {/* Allocated Vehicle IDs */}
                    {rec.allocatedVehicleIds && rec.allocatedVehicleIds.length > 0 && (
                      <div className="mb-3">
                        <span className="text-[10px] text-slate-500 uppercase font-semibold block mb-1">
                          Dispatched Vehicles:
                        </span>
                        <div className="flex flex-wrap gap-1">
                          {rec.allocatedVehicleIds.slice(0, 6).map((vid) => (
                            <span
                              key={vid}
                              className="text-[10px] font-mono bg-slate-950 text-cyan-300 px-1.5 py-0.5 rounded border border-slate-800"
                            >
                              {vid}
                            </span>
                          ))}
                          {rec.allocatedVehicleIds.length > 6 && (
                            <span className="text-[10px] text-slate-500 self-center">
                              +{rec.allocatedVehicleIds.length - 6} more
                            </span>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Rationale explanation */}
                    <p className="text-[11px] text-slate-400 mb-4 bg-slate-950/40 p-2.5 rounded border border-slate-800/40">
                      <strong className="text-slate-300 block mb-0.5">Dispatch Reason:</strong>
                      {rec.reason}
                    </p>
                  </div>

                  {/* Actions Footer */}
                  <div className="pt-3 border-t border-slate-800 flex flex-col gap-2">
                    {/* dispatchError alert row if rejected */}
                    {rec.dispatchError && (
                      <div className="text-[10px] text-red-400 bg-red-950/40 border border-red-900/30 p-2 rounded flex items-start gap-1.5">
                        <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" />
                        {rec.dispatchError}
                      </div>
                    )}

                    {/* dispatchedAt display */}
                    {rec.dispatchedAt && (
                      <span className="text-[10px] text-slate-400">
                        Autonomously Dispatched:{' '}
                        {new Date(rec.dispatchedAt).toLocaleTimeString('en-IN', {
                          timeZone: 'Asia/Kolkata',
                        })}{' '}
                        IST
                      </span>
                    )}

                    <div className="flex items-center justify-between gap-2">
                      {rec.status === 'PENDING' && (
                        <>
                          <div className="flex-1 py-1.5 text-center text-xs text-amber-300 bg-amber-950/40 rounded border border-amber-900/40 flex items-center justify-center gap-1.5">
                            <Clock className="w-3.5 h-3.5" />
                            Queued for next evaluation
                          </div>
                          <button
                            onClick={() => handleCancel(rec.id)}
                            disabled={isActing}
                            className="py-1.5 px-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded text-xs transition cursor-pointer"
                            title="Dismiss recommendation"
                          >
                            <XCircle className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}

                      {rec.status === 'DISPATCHED' && (
                        <>
                          <button
                            onClick={() => handleComplete(rec.id)}
                            disabled={isActing}
                            className="flex-1 py-1.5 px-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs font-semibold transition cursor-pointer flex items-center justify-center gap-1.5 shadow-sm disabled:opacity-50"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            {isActing ? 'Verifying Arrival...' : 'Verify Arrival (Sim)'}
                          </button>
                          <button
                            onClick={() => handleCancel(rec.id)}
                            disabled={isActing}
                            className="py-1.5 px-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded text-xs transition cursor-pointer"
                            title="Cancel movement"
                          >
                            <XCircle className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}

                      {rec.status === 'COMPLETED' && (
                        <div className="w-full py-1.5 text-center text-xs text-emerald-400 font-semibold bg-emerald-950/40 rounded border border-emerald-900/40">
                          ✓ Movement Completed & Verified
                        </div>
                      )}

                      {rec.status === 'CANCELLED' && (
                        <div className="w-full py-1.5 text-center text-xs text-slate-500 italic bg-slate-950 rounded">
                          Recommendation Cancelled
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
