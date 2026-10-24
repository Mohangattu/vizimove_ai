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

  useEffect(() => {
    const loadPipelineAndFleet = async () => {
      try {
        const [pipe, fleet, movements] = await Promise.all([
          api.getPipelineStatus(),
          api.getFleet(),
          api.getActiveMovements(),
        ]);
        if (pipe) setPipelineStatus(pipe);
        if (fleet?.summary) setFleetSummary(fleet.summary);
        if (movements) setActiveMovements(movements);
      } catch (e) {
        console.warn('[Recommendations] Context temporarily unavailable:', e);
      }
      api.getDispatchStatus().then(s => setDispatchStatus(s)).catch(() => {});
    };
    loadPipelineAndFleet();
  }, [recommendations]);

  const handleGenerate = async () => {
    setIsGenerating(true);
    try {
      await api.triggerPipelineCycle();
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
                Driver Repositioning Recommendations
              </h2>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800 font-semibold">
                15-MIN PIPELINE SYNCHRONIZED
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Constraint-aware vehicle repositioning generated on the 15-minute operational schedule.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleGenerate}
              disabled={isGenerating}
              className="px-3.5 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer shadow-sm disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isGenerating ? 'animate-spin' : ''}`} />
              Re-evaluate 15m Cycle
            </button>
          </div>
        </div>

        {/* Telemetry and Fleet Status Summary Row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-3 text-xs">
          <div className="bg-slate-950/80 p-2.5 rounded-lg border border-slate-800/80">
            <span className="text-slate-500 block text-[10px] uppercase font-semibold">Latest Processing Time</span>
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
            <span className="text-slate-500 block text-[10px] uppercase font-semibold">Assigned / En Route</span>
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
            <span className="text-slate-500 block text-[10px] uppercase font-semibold">Capacity Constant</span>
            <span className="font-mono text-emerald-400 font-bold">
              0.55 trips/veh/15m
            </span>
          </div>
        </div>

        {/* Autonomous Dispatch Status Banner */}
        {dispatchStatus && (
          <div className="bg-emerald-950/60 border border-emerald-800 p-3 rounded-lg text-xs text-emerald-200 flex items-start gap-2">
            <Sparkles className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span className="font-bold text-emerald-300 uppercase tracking-wide text-[10px] bg-emerald-900 px-2 py-0.5 rounded border border-emerald-700">
                AUTONOMOUS DISPATCH ACTIVE
              </span>
              {dispatchStatus.lastCycleTimestamp && (
                <span className="text-emerald-400">
                  Last cycle:{' '}
                  {new Date(dispatchStatus.lastCycleTimestamp).toLocaleTimeString('en-IN', {
                    timeZone: 'Asia/Kolkata',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}{' '}
                  IST
                </span>
              )}
              <span className="text-emerald-400">
                Dispatched this cycle:{' '}
                <strong className="text-white">{dispatchStatus.dispatchedThisCycle}</strong>
              </span>
              {dispatchStatus.pendingCount > 0 && (
                <span className="text-amber-400">
                  {dispatchStatus.pendingCount} queued for next cycle
                </span>
              )}
            </div>
          </div>
        )}

        {/* Real-World Dispatch Separation Disclaimer */}
        <div className="bg-slate-950/60 border border-slate-800 p-3 rounded-lg text-[11px] text-slate-400 flex items-start gap-2">
          <ShieldAlert className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
          <span>
            <strong className="text-slate-200">Dispatch Separation Guard:</strong> Automatic repositioning algorithms operate strictly within the deterministic virtual fleet simulation sandbox. Physical real-world driver commands are disengaged until an authorized fleet management telematics integration is authenticated.
          </span>
        </div>
      </div>

      {/* Filter and Count Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center space-x-1 bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs">
          {['ALL', 'PENDING', 'DISPATCHED', 'COMPLETED', 'CANCELLED'].map((st) => (
            <button
              key={st}
              onClick={() => setStatusFilter(st)}
              className={`px-2.5 py-1 rounded font-medium transition cursor-pointer text-[11px] ${
                statusFilter === st ? 'bg-cyan-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              {st}
            </button>
          ))}
        </div>

        <span className="text-xs text-slate-400">
          Showing <strong>{filteredRecs.length}</strong> recommendations ({recommendations.filter(r => r.status === 'PENDING').length} queued for next cycle)
        </span>
      </div>

      {/* Recommendations Grid */}
      {filteredRecs.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-12 text-center text-slate-400 text-xs">
          <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto mb-2 opacity-80" />
          <p className="font-semibold text-white">No Recommendations Match Current Filter</p>
          <p className="text-slate-500 mt-1">
            All zones are within balanced supply thresholds or existing movements are currently fulfilling demand.
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
                    <span className="font-mono text-xs font-bold text-slate-300 bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                      {rec.id}
                    </span>
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
                        {rec.status}
                      </span>
                    </div>
                  </div>

                  {/* Route corridor */}
                  <div className="text-sm font-bold text-white mb-2 flex items-center gap-2">
                    <span>{rec.sourceZoneName}</span>
                    <ArrowRight className="w-4 h-4 text-cyan-400 shrink-0" />
                    <span className="text-cyan-300">{rec.targetZoneName}</span>
                  </div>

                  {/* Move Details */}
                  <div className="bg-slate-950/80 border border-slate-800/80 p-3 rounded-lg text-xs space-y-1.5 mb-3">
                    <div className="flex justify-between">
                      <span className="text-slate-400">Rebalance Volume:</span>
                      <strong className="text-white font-mono">
                        {rec.recommendedVehicleCount} Available Vehicles
                      </strong>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Deadhead Distance:</span>
                      <span className="text-slate-200">
                        {rec.estimatedTravelDistanceKm} km (~{rec.estimatedTravelTimeMin} min driving)
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Expected Net Trips Served:</span>
                      <strong className="text-emerald-400">+{rec.expectedNetTripsServed} trips</strong>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Algorithm Confidence:</span>
                      <span className="text-cyan-300 font-bold">
                        {Math.round(rec.confidenceScore * 100)}%
                      </span>
                    </div>
                  </div>

                  {/* Allocated Vehicle IDs */}
                  {rec.allocatedVehicleIds && rec.allocatedVehicleIds.length > 0 && (
                    <div className="mb-3">
                      <span className="text-[10px] text-slate-500 uppercase font-semibold block mb-1">
                        Allocated Virtual Vehicles:
                      </span>
                      <div className="flex flex-wrap gap-1">
                        {rec.allocatedVehicleIds.slice(0, 5).map((vid) => (
                          <span
                            key={vid}
                            className="text-[10px] font-mono bg-slate-950 text-cyan-300 px-1.5 py-0.5 rounded border border-slate-800"
                          >
                            {vid}
                          </span>
                        ))}
                        {rec.allocatedVehicleIds.length > 5 && (
                          <span className="text-[10px] text-slate-500 self-center">
                            +{rec.allocatedVehicleIds.length - 5} more
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Rationale explanation */}
                  <p className="text-[11px] text-slate-400 mb-4 bg-slate-950/40 p-2.5 rounded border border-slate-800/40">
                    <strong className="text-slate-300 block mb-0.5">Decision Evidence:</strong>
                    {rec.reason}
                  </p>
                </div>

                {/* Actions Footer */}
                <div className="pt-3 border-t border-slate-800 flex flex-col gap-2">
                  {/* dispatchError alert row */}
                  {rec.dispatchError && (
                    <div className="text-[10px] text-red-400 bg-red-950/40 border border-red-900/30 p-2 rounded flex items-start gap-1.5">
                      <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" />
                      {rec.dispatchError}
                    </div>
                  )}

                  {/* dispatchedAt display */}
                  {rec.dispatchedAt && (
                    <span className="text-[10px] text-slate-400">
                      Dispatched:{' '}
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
                          Queued — next 15-min cycle
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
                          {isActing ? 'Verifying Arrival...' : 'Mark Completed (Sim Arrival)'}
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
  );
};
