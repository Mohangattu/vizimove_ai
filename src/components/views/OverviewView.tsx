import React, { useState, useEffect } from 'react';
import {
  TrendingUp,
  AlertTriangle,
  Car,
  Activity,
  Calendar,
  ArrowRight,
  ShieldAlert,
  CheckCircle2,
  Navigation,
  Layers,
  MapPin,
  Sparkles,
  Clock,
  Play,
  Database,
  RefreshCw,
} from 'lucide-react';
import {
  OperationsSummary,
  SupplyDemandAnalysis,
  DriverRecommendation,
  EventRecord,
  ZoneRecord,
  VirtualVehicle,
} from '../../lib/types';
import { api } from '../../services/api';

interface OverviewViewProps {
  summary: OperationsSummary | null;
  supplyDemand: SupplyDemandAnalysis[];
  recommendations: DriverRecommendation[];
  events: EventRecord[];
  zones: ZoneRecord[];
  vehicles: VirtualVehicle[];
  onNavigateTab: (tab: any) => void;
  onDispatchRec: (id: string) => void;
}

export const OverviewView: React.FC<OverviewViewProps> = ({
  summary,
  supplyDemand,
  recommendations,
  events,
  zones,
  vehicles,
  onNavigateTab,
  onDispatchRec,
}) => {
  const [selectedZoneId, setSelectedZoneId] = useState<string>('VZ-01');
  const [mapLayer, setMapLayer] = useState<'imbalance' | 'demand' | 'fleet'>('imbalance');
  const [pipelineStatus, setPipelineStatus] = useState<any>(null);
  const [isTriggering, setIsTriggering] = useState<boolean>(false);
  const [dispatchStatus, setDispatchStatus] = useState<any>(null);

  useEffect(() => {
    api.getPipelineStatus()
      .then(setPipelineStatus)
      .catch((err) => console.error('Failed to fetch pipeline status in overview', err));
    api.getDispatchStatus().then(setDispatchStatus).catch(() => {});
  }, []);

  const handleTriggerCycle = async () => {
    setIsTriggering(true);
    try {
      const res = await api.triggerPipelineCycle();
      setPipelineStatus((prev: any) => ({
        ...prev,
        latestCompletedCycle: res.cycleRun,
      }));
    } catch (e: any) {
      console.error(e);
      alert(`Cycle error: ${e.message}`);
    } finally {
      setIsTriggering(false);
    }
  };

  if (!summary) {
    return (
      <div className="flex items-center justify-center p-12 text-slate-400">
        <Activity className="w-6 h-6 animate-spin mr-2 text-cyan-400" />
        Loading Main Dashboard...
      </div>
    );
  }

  const topShortages = supplyDemand
    .filter((s) => s.unmetDemand > 0)
    .sort((a, b) => b.unmetDemand - a.unmetDemand)
    .slice(0, 4);

  const topSurpluses = supplyDemand
    .filter((s) => s.excessVehicles > 0)
    .sort((a, b) => b.excessVehicles - a.excessVehicles)
    .slice(0, 4);

  const pendingRecs = recommendations
    .filter((r) => r.status === 'PENDING')
    .slice(0, 3);

  const upcomingEvents = events
    .filter((e) => e.status === 'ACTIVE' || e.status === 'UPCOMING')
    .slice(0, 2);

  // Geographic SVG projection for 30 Visakhapatnam zones
  const minLat = 17.56;
  const maxLat = 17.94;
  const minLng = 83.06;
  const maxLng = 83.47;
  const svgWidth = 760;
  const svgHeight = 440;

  const project = (lat: number, lng: number) => {
    const x = ((lng - minLng) / (maxLng - minLng)) * (svgWidth - 60) + 30;
    const y = ((maxLat - lat) / (maxLat - minLat)) * (svgHeight - 60) + 30;
    return { x, y };
  };

  const selectedZone = zones.find((z) => z.id === selectedZoneId) || zones[0];
  const selectedAnalysis = supplyDemand.find((s) => s.zoneId === selectedZoneId);

  const getZoneFillColor = (zoneId: string) => {
    const analysis = supplyDemand.find((s) => s.zoneId === zoneId);
    if (!analysis) return '#334155';

    if (mapLayer === 'demand') {
      const d = analysis.eventAdjustedDemand;
      if (d > 55) return 'rgba(239, 68, 68, 0.60)';
      if (d > 40) return 'rgba(249, 115, 22, 0.50)';
      if (d > 25) return 'rgba(234, 179, 8, 0.45)';
      return 'rgba(59, 130, 246, 0.35)';
    } else if (mapLayer === 'fleet') {
      const v = analysis.availableVehicles;
      if (v >= 25) return 'rgba(16, 185, 129, 0.65)';
      if (v >= 15) return 'rgba(34, 197, 94, 0.50)';
      if (v >= 8) return 'rgba(234, 179, 8, 0.45)';
      return 'rgba(239, 68, 68, 0.55)';
    } else {
      if (analysis.shortageSeverity === 'CRITICAL') return 'rgba(239, 68, 68, 0.65)';
      if (analysis.shortageSeverity === 'MODERATE') return 'rgba(245, 158, 11, 0.55)';
      if (analysis.shortageSeverity === 'SURPLUS') return 'rgba(16, 185, 129, 0.55)';
      return 'rgba(59, 130, 246, 0.40)';
    }
  };

  return (
    <div className="space-y-6">
      {/* KPI Cards Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {/* Next Hour Demand */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Metropolitan Demand</span>
            <TrendingUp className="w-4 h-4 text-cyan-400" />
          </div>
          <div className="text-2xl font-bold text-white mb-1">
            {summary.totalPredictedDemandNextHour}{' '}
            <span className="text-xs font-normal text-slate-400">trips / hr</span>
          </div>
          <p className="text-[11px] text-slate-400">
            Calibrated forecast across 30 Visakhapatnam zones
          </p>
        </div>

        {/* Unmet Shortage */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Projected Shortage</span>
            <AlertTriangle className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-2xl font-bold text-amber-400 mb-1">
            {summary.totalUnmetDemand}{' '}
            <span className="text-xs font-normal text-slate-400">trips unserved</span>
          </div>
          <p className="text-[11px] text-slate-400">
            {summary.criticalDeficitZones.length} critical deficit corridors detected
          </p>
        </div>

        {/* Available Fleet */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Available Fleet</span>
            <Car className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-bold text-emerald-400 mb-1">
            {summary.availableFleetCount}{' '}
            <span className="text-xs font-normal text-slate-400">
              / {summary.activeFleetCount} active
            </span>
          </div>
          <p className="text-[11px] text-slate-400">
            {summary.busyFleetCount} busy • {summary.fleetUtilizationRate}% utilization
          </p>
        </div>

        {/* Pending Repositionings */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Pending Rebalances</span>
            <Navigation className="w-4 h-4 text-blue-400" />
          </div>
          <div className="text-2xl font-bold text-blue-400 mb-1">
            {summary.pendingRecommendationsCount}{' '}
            <span className="text-xs font-normal text-slate-400">repositioning tasks</span>
          </div>
          <p className="text-[11px] text-slate-400">
            Optimized for minimal deadhead transit times
          </p>
        </div>

        {/* Autonomous Dispatch KPI */}
        <div className="bg-slate-900 border border-emerald-800/40 rounded-xl p-5 shadow-sm">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Autonomous Dispatch</span>
            <Sparkles className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-bold text-emerald-400 mb-1">
            ENABLED
          </div>
          <p className="text-[11px] text-slate-400">
            {dispatchStatus?.lastCycleTimestamp
              ? `Last cycle: ${new Date(dispatchStatus.lastCycleTimestamp).toLocaleTimeString('en-IN', {
                  timeZone: 'Asia/Kolkata',
                  hour: '2-digit',
                  minute: '2-digit',
                })} IST`
              : 'Pipeline active — 15-min cycles'}
          </p>
        </div>
      </div>

      {/* 15-Minute Operational Scheduled Pipeline Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
          <div className="flex items-center space-x-2.5">
            <div className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-ping" />
            <div>
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                15-Minute Scheduled Operational Pipeline
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800">
                  {pipelineStatus?.latestCompletedCycle ? 'CYCLE ACTIVE' : 'INITIALIZING'}
                </span>
              </h2>
              <p className="text-[11px] text-slate-400">
                Idempotent execution • Input freshness verification • 15m sub-hourly forecast & capacity balancing
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleTriggerCycle}
              disabled={isTriggering}
              className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50"
            >
              <Play className={`w-3.5 h-3.5 ${isTriggering ? 'animate-spin' : ''}`} />
              {isTriggering ? 'Running Cycle...' : 'Run Pipeline Cycle Now'}
            </button>
          </div>
        </div>

        {pipelineStatus?.latestCompletedCycle && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-xs">
            <div className="bg-slate-950/80 p-2.5 rounded-lg border border-slate-800/80">
              <span className="text-slate-500 block text-[10px] uppercase font-semibold">Latest Cycle ID</span>
              <span className="font-mono text-cyan-300 font-bold">
                {pipelineStatus.latestCompletedCycle.runId}
              </span>
            </div>
            <div className="bg-slate-950/80 p-2.5 rounded-lg border border-slate-800/80">
              <span className="text-slate-500 block text-[10px] uppercase font-semibold">Run Duration</span>
              <span className="font-mono text-white font-bold">
                {pipelineStatus.latestCompletedCycle.durationMs} ms
              </span>
            </div>
            <div className="bg-slate-950/80 p-2.5 rounded-lg border border-slate-800/80">
              <span className="text-slate-500 block text-[10px] uppercase font-semibold">15m Sub-Hourly Demand</span>
              <span className="font-mono text-emerald-400 font-bold">
                {pipelineStatus.latestCompletedCycle.totalEventAdjustedDemand15m} trips/15m
              </span>
            </div>
            <div className="bg-slate-950/80 p-2.5 rounded-lg border border-slate-800/80">
              <span className="text-slate-500 block text-[10px] uppercase font-semibold">Zones Forecasted</span>
              <span className="font-mono text-white font-bold">
                {pipelineStatus.latestCompletedCycle.zonesForecastedCount} zones
              </span>
            </div>
            <div className="bg-slate-950/80 p-2.5 rounded-lg border border-slate-800/80">
              <span className="text-slate-500 block text-[10px] uppercase font-semibold">Event Spatial Impacts</span>
              <span className="font-mono text-purple-300 font-bold">
                {pipelineStatus.latestCompletedCycle.activeEventsEvaluated} evaluated
              </span>
            </div>
            <div className="bg-slate-950/80 p-2.5 rounded-lg border border-slate-800/80">
              <span className="text-slate-500 block text-[10px] uppercase font-semibold">Input Freshness</span>
              <span className="font-mono text-emerald-400 font-bold">
                {pipelineStatus.latestCompletedCycle.inputFreshness?.dataFreshnessSeconds}s age • VALID
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Executive Command Briefing */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-900 to-cyan-950/40 border border-cyan-800/40 rounded-xl p-6 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center space-x-2">
            <div className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-ping" />
            <h2 className="text-base font-bold text-white tracking-tight">
              Operational Decision Briefing • Visakhapatnam Command
            </h2>
          </div>
          <span className="text-xs text-cyan-300 font-mono bg-cyan-950/80 px-2.5 py-1 rounded border border-cyan-800/60">
            Deterministic Engine
          </span>
        </div>

        <ul className="space-y-2">
          {summary.executiveBriefing.map((item, idx) => (
            <li key={idx} className="flex items-start text-xs text-slate-200 leading-relaxed">
              <span className="text-cyan-400 font-bold mr-2 mt-0.5">•</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Integrated Spatial Demand Map of Visakhapatnam */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Layers className="w-4 h-4 text-cyan-400" />
              Visakhapatnam Metropolitan Spatial Imbalance Map (30 Zones)
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Click any zone polygon to inspect real-time demand, fleet supply, and shortages
            </p>
          </div>

          <div className="flex items-center space-x-1 bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs">
            <button
              onClick={() => setMapLayer('imbalance')}
              className={`px-3 py-1.5 rounded-md font-medium transition cursor-pointer ${
                mapLayer === 'imbalance' ? 'bg-cyan-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              Imbalance
            </button>
            <button
              onClick={() => setMapLayer('demand')}
              className={`px-3 py-1.5 rounded-md font-medium transition cursor-pointer ${
                mapLayer === 'demand' ? 'bg-cyan-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              Demand Heat
            </button>
            <button
              onClick={() => setMapLayer('fleet')}
              className={`px-3 py-1.5 rounded-md font-medium transition cursor-pointer ${
                mapLayer === 'fleet' ? 'bg-cyan-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              Fleet Supply
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Spatial SVG Map */}
          <div className="lg:col-span-2 bg-slate-950 border border-slate-800 rounded-xl p-3 relative overflow-hidden flex items-center justify-center min-h-[360px]">
            <svg viewBox={`0 0 ${svgWidth} ${svgHeight}`} className="w-full h-auto select-none">
              {/* Bay of Bengal Sea Coastline */}
              <path
                d="M 460,0 Q 560,120 530,240 T 680,440 L 760,440 L 760,0 Z"
                fill="#082f49"
                opacity="0.35"
              />
              <text
                x={svgWidth - 90}
                y={svgHeight / 2}
                fill="#0284c7"
                fontSize="11"
                fontWeight="bold"
                letterSpacing="2"
                opacity="0.4"
                transform={`rotate(75, ${svgWidth - 90}, ${svgHeight / 2})`}
              >
                BAY OF BENGAL
              </text>

              {/* Zone Polygons */}
              {zones.map((zone) => {
                const points = zone.boundary
                  .map((coord) => {
                    const p = project(coord.lat, coord.lng);
                    return `${p.x},${p.y}`;
                  })
                  .join(' ');

                const centroid = project(zone.centroid.lat, zone.centroid.lng);
                const isSelected = zone.id === selectedZoneId;
                const analysis = supplyDemand.find((s) => s.zoneId === zone.id);

                return (
                  <g key={zone.id} className="cursor-pointer" onClick={() => setSelectedZoneId(zone.id)}>
                    <polygon
                      points={points}
                      fill={getZoneFillColor(zone.id)}
                      stroke={isSelected ? '#38bdf8' : '#475569'}
                      strokeWidth={isSelected ? 2.5 : 1}
                      strokeDasharray={isSelected ? undefined : '2,2'}
                      className="transition-all hover:opacity-90"
                    />
                    <circle
                      cx={centroid.x}
                      cy={centroid.y}
                      r={isSelected ? 5.5 : 3.5}
                      fill={isSelected ? '#38bdf8' : '#ffffff'}
                      stroke="#0f172a"
                      strokeWidth={1.5}
                    />
                    <text
                      x={centroid.x}
                      y={centroid.y - 7}
                      textAnchor="middle"
                      fill="#ffffff"
                      fontSize="9"
                      fontWeight="bold"
                      className="pointer-events-none drop-shadow"
                    >
                      {zone.id}
                    </text>
                  </g>
                );
              })}

              {/* Event Pins */}
              {events.filter((evt) => evt.latitude !== null && evt.longitude !== null).map((evt) => {
                const p = project(evt.latitude!, evt.longitude!);
                return (
                  <g key={evt.id} className="pointer-events-none">
                    <circle cx={p.x} cy={p.y} r={10} fill="none" stroke="#c084fc" strokeWidth={1} strokeDasharray="2,2" />
                    <circle cx={p.x} cy={p.y} r={4.5} fill="#a855f7" stroke="#ffffff" strokeWidth={1} />
                  </g>
                );
              })}
            </svg>
          </div>

          {/* Zone Mini Inspector */}
          <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-4 flex flex-col justify-between text-xs">
            {selectedZone && selectedAnalysis ? (
              <div className="space-y-3">
                <div className="border-b border-slate-800 pb-2.5">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-mono text-cyan-400 font-bold bg-cyan-950 px-1.5 py-0.5 rounded border border-cyan-800">
                      {selectedZone.id}
                    </span>
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase ${
                        selectedAnalysis.shortageSeverity === 'CRITICAL'
                          ? 'bg-red-950 text-red-400 border border-red-800'
                          : selectedAnalysis.shortageSeverity === 'SURPLUS'
                          ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                          : 'bg-blue-950 text-blue-400 border border-blue-800'
                      }`}
                    >
                      {selectedAnalysis.shortageSeverity}
                    </span>
                  </div>
                  <h4 className="text-sm font-bold text-white">{selectedZone.name}</h4>
                  <p className="text-[11px] text-slate-400 mt-1 line-clamp-2">
                    {selectedZone.description}
                  </p>
                </div>

                <div className="space-y-2 text-[11px]">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Demand (Next Hr):</span>
                    <strong className="text-white">{selectedAnalysis.eventAdjustedDemand} trips/hr</strong>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Available Vehicles:</span>
                    <strong className="text-emerald-400">{selectedAnalysis.availableVehicles} vehicles</strong>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Hourly Capacity:</span>
                    <span className="text-slate-200">{selectedAnalysis.hourlySupplyCapacity} trips/hr</span>
                  </div>
                  <div className="flex justify-between pt-2 border-t border-slate-800">
                    <span className="text-slate-400">Net Delta:</span>
                    {selectedAnalysis.unmetDemand > 0 ? (
                      <strong className="text-red-400">-{selectedAnalysis.unmetDemand} trips (DEFICIT)</strong>
                    ) : (
                      <strong className="text-emerald-400">+{selectedAnalysis.excessVehicles} veh (SURPLUS)</strong>
                    )}
                  </div>
                </div>
              </div>
            ) : null}

            <button
              onClick={() => onNavigateTab('supply-demand')}
              className="mt-3 w-full py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded text-xs font-semibold transition cursor-pointer flex items-center justify-center gap-1"
            >
              Open Full 30-Zone Matrix <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Two Column: Deficit Corridors vs Staging Surplus Reserves */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Shortages */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center space-x-2">
              <ShieldAlert className="w-4 h-4 text-red-400" />
              <h3 className="text-sm font-semibold text-white">
                Deficit Corridors (Shortage Alert)
              </h3>
            </div>
            <button
              onClick={() => onNavigateTab('supply-demand')}
              className="text-xs text-cyan-400 hover:text-cyan-300 flex items-center gap-1 font-medium cursor-pointer"
            >
              All 30 Zones <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {topShortages.length === 0 ? (
            <p className="text-xs text-slate-400 py-4 text-center">
              No zones currently exhibit fleet shortages.
            </p>
          ) : (
            <div className="space-y-2.5">
              {topShortages.map((item) => (
                <div
                  key={item.zoneId}
                  className="bg-slate-950/60 border border-red-900/30 p-3 rounded-lg flex items-center justify-between"
                >
                  <div>
                    <div className="flex items-center space-x-2">
                      <span className="text-xs font-bold text-white">{item.zoneName}</span>
                      <span className="text-[10px] bg-red-950/80 text-red-400 px-1.5 py-0.5 rounded border border-red-800/40 font-mono">
                        {item.zoneId}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-400 mt-1 flex gap-3">
                      <span>Demand: <strong className="text-slate-200">{item.eventAdjustedDemand}</strong></span>
                      <span>Avail: <strong className="text-emerald-400">{item.availableVehicles}</strong></span>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-base font-extrabold text-red-400">
                      -{item.unmetDemand}
                    </span>
                    <span className="text-[10px] text-slate-400 block">trips unserved</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Surpluses */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center space-x-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <h3 className="text-sm font-semibold text-white">
                Staging Reserves (Surplus Idle Vehicles)
              </h3>
            </div>
            <button
              onClick={() => onNavigateTab('fleet')}
              className="text-xs text-cyan-400 hover:text-cyan-300 flex items-center gap-1 font-medium cursor-pointer"
            >
              Fleet View <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {topSurpluses.length === 0 ? (
            <p className="text-xs text-slate-400 py-4 text-center">
              All zones are currently balanced.
            </p>
          ) : (
            <div className="space-y-2.5">
              {topSurpluses.map((item) => (
                <div
                  key={item.zoneId}
                  className="bg-slate-950/60 border border-emerald-900/30 p-3 rounded-lg flex items-center justify-between"
                >
                  <div>
                    <div className="flex items-center space-x-2">
                      <span className="text-xs font-bold text-white">{item.zoneName}</span>
                      <span className="text-[10px] bg-emerald-950/80 text-emerald-400 px-1.5 py-0.5 rounded border border-emerald-800/40 font-mono">
                        {item.zoneId}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-400 mt-1 flex gap-3">
                      <span>Demand: <strong className="text-slate-200">{item.eventAdjustedDemand}</strong></span>
                      <span>Avail: <strong className="text-emerald-400">{item.availableVehicles}</strong></span>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-base font-extrabold text-emerald-400">
                      +{item.excessVehicles}
                    </span>
                    <span className="text-[10px] text-slate-400 block">idle surplus</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Top Repositioning Actions Panel */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-2">
            <Navigation className="w-4 h-4 text-cyan-400" />
            <h3 className="text-sm font-semibold text-white">
              Queued Repositionings
            </h3>
          </div>
          <button
            onClick={() => onNavigateTab('recommendations')}
            className="text-xs text-cyan-400 hover:text-cyan-300 flex items-center gap-1 font-medium cursor-pointer"
          >
            All Recommendations <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {pendingRecs.length === 0 ? (
          <p className="text-xs text-slate-400 py-4 text-center">
            No pending repositioning recommendations.
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {pendingRecs.map((rec) => (
              <div
                key={rec.id}
                className="bg-slate-950/60 border border-slate-800 p-4 rounded-lg flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-white font-mono">{rec.id}</span>
                    <div className="flex items-center gap-1.5">
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
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase ${
                          rec.priority === 'CRITICAL'
                            ? 'bg-red-950/80 text-red-400 border border-red-800/50'
                            : rec.priority === 'HIGH'
                            ? 'bg-amber-950/80 text-amber-400 border border-amber-800/50'
                            : 'bg-blue-950/80 text-blue-400 border border-blue-800/50'
                        }`}
                      >
                        {rec.priority}
                      </span>
                    </div>
                  </div>

                  <div className="text-xs text-slate-200 mb-2 font-semibold">
                    {rec.sourceZoneName} → <span className="text-cyan-300">{rec.targetZoneName}</span>
                  </div>

                  <p className="text-[11px] text-slate-400 line-clamp-2 mb-3">
                    {rec.reason}
                  </p>

                  <div className="flex items-center justify-between text-[11px] text-slate-400 mb-3 bg-slate-900/60 p-2 rounded">
                    <span>Move: <strong className="text-white">{rec.recommendedVehicleCount} vehicles</strong></span>
                    <span>~{rec.estimatedTravelTimeMin} min ({rec.estimatedTravelDistanceKm} km)</span>
                  </div>
                </div>

                <button
                  onClick={() => onNavigateTab('recommendations')}
                  className="w-full py-1.5 px-3 bg-slate-700 hover:bg-slate-600 text-white rounded text-xs font-semibold transition cursor-pointer flex items-center justify-center gap-1.5 shadow-sm"
                >
                  <Navigation className="w-3.5 h-3.5" />
                  View Details
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
