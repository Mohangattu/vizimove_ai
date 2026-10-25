import React, { useState, useEffect } from 'react';
import {
  Car,
  Play,
  RotateCcw,
  Battery,
  Navigation,
  CheckCircle2,
  Clock,
  Filter,
  ArrowRight,
  ShieldAlert,
  Search,
  Activity,
  Zap,
} from 'lucide-react';
import { VirtualVehicle, VehicleState, ZoneRecord } from '../../lib/types';
import { VIZAG_ZONES } from '../../lib/zones';
import { api } from '../../services/api';

interface FleetOperationsViewProps {
  fleetSummary: {
    total: number;
    available: number;
    busy: number;
    enRoute: number;
    offline: number;
    assigned: number;
    utilizationRate: number;
  } | null;
  vehicles: VirtualVehicle[];
  onRefreshFleet: () => void;
}

export const FleetOperationsView: React.FC<FleetOperationsViewProps> = ({
  fleetSummary,
  vehicles,
  onRefreshFleet,
}) => {
  const [pipelineStatus, setPipelineStatus] = useState<any>(null);
  const [activeMovements, setActiveMovements] = useState<VirtualVehicle[]>([]);
  const [isTriggeringCycle, setIsTriggeringCycle] = useState<boolean>(false);
  const [filterState, setFilterState] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedSubTab, setSelectedSubTab] = useState<'movements' | 'allocations' | 'roster'>('movements');

  useEffect(() => {
    const loadStatus = async () => {
      try {
        const [status, movements] = await Promise.all([
          api.getPipelineStatus(),
          api.getActiveMovements(),
        ]);
        if (status) setPipelineStatus(status);
        if (movements) setActiveMovements(movements);
      } catch (e) {
        console.warn('[Fleet Operations] Pipeline status or movements temporarily unavailable:', e);
      }
    };
    loadStatus();
    const interval = setInterval(loadStatus, 4000);
    return () => clearInterval(interval);
  }, [vehicles]);

  const handleTriggerCycleNow = async () => {
    setIsTriggeringCycle(true);
    try {
      const res = await api.triggerPipelineCycle();
      setPipelineStatus((prev: any) => ({
        ...prev,
        latestCompletedCycle: res.cycleRun,
      }));
      onRefreshFleet();
    } catch (err: any) {
      console.error('Trigger cycle failed', err);
    } finally {
      setIsTriggeringCycle(false);
    }
  };

  // Compute 30-zone fleet allocation totals
  const zoneAllocations = VIZAG_ZONES.map((zone) => {
    const zoneVehicles = vehicles.filter((v) => v.zoneId === zone.id);
    const available = zoneVehicles.filter((v) => v.state === 'AVAILABLE').length;
    const busy = zoneVehicles.filter((v) => v.state === 'BUSY').length;
    const enRoute = zoneVehicles.filter((v) => v.state === 'EN_ROUTE').length;
    const offline = zoneVehicles.filter((v) => v.state === 'OFFLINE').length;
    return {
      zoneId: zone.id,
      zoneName: zone.name,
      category: zone.category,
      total: zoneVehicles.length,
      available,
      busy,
      enRoute,
      offline,
    };
  });

  const filteredVehicles = vehicles.filter((v) => {
    if (filterState !== 'ALL' && v.state !== filterState) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        v.id.toLowerCase().includes(q) ||
        v.zoneId.toLowerCase().includes(q) ||
        (v.targetZoneId && v.targetZoneId.toLowerCase().includes(q))
      );
    }
    return true;
  });

  const latestCycle = pipelineStatus?.latestCompletedCycle;

  if (!fleetSummary) {
    return (
      <div className="p-12 text-center text-xs text-slate-400">Loading fleet data...</div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Autonomous Operational Engine Status Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4 pb-3 border-b border-slate-800">
          <div className="flex items-center space-x-3">
            <div className="relative flex items-center justify-center">
              <div className="w-3.5 h-3.5 rounded-full bg-emerald-500 animate-ping absolute" />
              <div className="w-3 h-3 rounded-full bg-emerald-400 relative" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  <Car className="w-4 h-4 text-cyan-400" />
                  Autonomous Fleet Operations Engine
                </h2>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800 font-semibold">
                  BACKGROUND SERVICE ACTIVE
                </span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800">
                  15-MIN CYCLE
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Evaluates sub-hourly demand, detects shortages, and executes repositioning movements automatically without manual commands.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleTriggerCycleNow}
              disabled={isTriggeringCycle}
              className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50"
              title="Autonomous engine operates automatically on the 15-min background loop. Use this button for on-demand diagnostic verification."
            >
              <Play className={`w-3.5 h-3.5 text-cyan-400 ${isTriggeringCycle ? 'animate-spin' : ''}`} />
              {isTriggeringCycle ? 'Evaluating Cycle...' : 'Run Immediate Cycle (Diagnostic)'}
            </button>
          </div>
        </div>

        {/* Operational cycle telemetry */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-3 text-xs">
          <div className="bg-slate-950/80 p-3 rounded-lg border border-slate-800/80">
            <span className="text-slate-500 block text-[10px] uppercase font-semibold">Latest Processing Time</span>
            <span className="font-mono text-cyan-300 font-bold">
              {latestCycle?.timestamp
                ? new Date(latestCycle.timestamp).toLocaleTimeString('en-IN', {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    timeZone: 'Asia/Kolkata',
                  }) + ' IST'
                : 'Initial cycle running'}
            </span>
          </div>

          <div className="bg-slate-950/80 p-3 rounded-lg border border-slate-800/80">
            <span className="text-slate-500 block text-[10px] uppercase font-semibold">Next Scheduled Run</span>
            <span className="font-mono text-slate-300 font-bold">
              {pipelineStatus?.nextRunScheduledAt
                ? new Date(pipelineStatus.nextRunScheduledAt).toLocaleTimeString('en-IN', {
                    hour: '2-digit',
                    minute: '2-digit',
                    timeZone: 'Asia/Kolkata',
                  }) + ' IST'
                : 'Every 15 minutes'}
            </span>
          </div>

          <div className="bg-slate-950/80 p-3 rounded-lg border border-slate-800/80">
            <span className="text-slate-500 block text-[10px] uppercase font-semibold">Active Movements</span>
            <span className="font-mono text-purple-400 font-bold">
              {fleetSummary.enRoute} En Route
            </span>
          </div>

          <div className="bg-slate-950/80 p-3 rounded-lg border border-slate-800/80">
            <span className="text-slate-500 block text-[10px] uppercase font-semibold">Concurrency Lock</span>
            <span className="font-mono text-emerald-400 font-bold">
              {pipelineStatus?.isExecuting ? 'CYCLE LOCKED' : 'IDLE (SINGLE-WORKER)'}
            </span>
          </div>

          <div className="bg-slate-950/80 p-3 rounded-lg border border-slate-800/80 col-span-2 sm:col-span-1">
            <span className="text-slate-500 block text-[10px] uppercase font-semibold">Data Freshness</span>
            <span className="font-mono text-emerald-400 font-bold">
              {latestCycle?.inputFreshness?.dataFreshnessSeconds !== undefined
                ? `${latestCycle.inputFreshness.dataFreshnessSeconds}s • VALID`
                : 'FRESH'}
            </span>
          </div>
        </div>

        {/* Operational Model Disclosure */}
        <div className="bg-slate-950/60 border border-slate-800 p-3 rounded-lg text-[11px] text-slate-400 flex items-start gap-2">
          <ShieldAlert className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
          <span>
            <strong className="text-slate-200">Operational Integrity Disclosure:</strong> Deterministic virtual fleet operational engine (1,200 persisted configured vehicles across 30 Visakhapatnam zones). No real-world telematics provider is connected; all telemetry, movement progress, and state transitions are deterministic simulated operations, not real-world GPS observations.
          </span>
        </div>
      </div>

      {/* Fleet State Counts Row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl text-center">
          <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block mb-1">
            Total Fleet
          </span>
          <span className="text-xl font-bold text-white">{fleetSummary.total}</span>
          <span className="text-[10px] text-slate-500 block mt-0.5">Configured</span>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl text-center">
          <span className="text-[10px] text-emerald-400 font-bold uppercase tracking-wider block mb-1">
            Available
          </span>
          <span className="text-xl font-bold text-emerald-400">{fleetSummary.available}</span>
          <span className="text-[10px] text-slate-500 block mt-0.5">Ready for dispatch</span>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl text-center">
          <span className="text-[10px] text-blue-400 font-bold uppercase tracking-wider block mb-1">
            Busy (On Trip)
          </span>
          <span className="text-xl font-bold text-blue-400">{fleetSummary.busy}</span>
          <span className="text-[10px] text-slate-500 block mt-0.5">Serving passengers</span>
        </div>

        <div
          onClick={() => setSelectedSubTab('movements')}
          className="bg-slate-900 border border-purple-800/80 hover:border-purple-600 p-4 rounded-xl text-center cursor-pointer transition shadow-sm hover:bg-slate-850"
          title="Click to view and monitor all active en-route movements"
        >
          <span className="text-[10px] text-purple-400 font-bold uppercase tracking-wider block mb-1">
            En Route (In Transit)
          </span>
          <span className="text-xl font-bold text-purple-400">{fleetSummary.enRoute}</span>
          <span className="text-[10px] text-slate-400 block mt-0.5 font-medium">Repositioning (Simulated) →</span>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl text-center">
          <span className="text-[10px] text-amber-400 font-bold uppercase tracking-wider block mb-1">
            Assigned
          </span>
          <span className="text-xl font-bold text-amber-400">{fleetSummary.assigned}</span>
          <span className="text-[10px] text-slate-500 block mt-0.5">En route to pickup</span>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl text-center">
          <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block mb-1">
            Offline
          </span>
          <span className="text-xl font-bold text-slate-400">{fleetSummary.offline}</span>
          <span className="text-[10px] text-slate-500 block mt-0.5">Charging / Break</span>
        </div>
      </div>

      {/* Sub Tabs: Assigned Movements vs Zone Allocations vs Full Vehicle Roster */}
      <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
        <button
          onClick={() => setSelectedSubTab('movements')}
          className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
            selectedSubTab === 'movements'
              ? 'bg-cyan-600 text-white'
              : 'text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
        >
          <Navigation className="w-3.5 h-3.5" />
          Assigned Movements ({activeMovements.length})
        </button>

        <button
          onClick={() => setSelectedSubTab('allocations')}
          className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
            selectedSubTab === 'allocations'
              ? 'bg-cyan-600 text-white'
              : 'text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
        >
          <CheckCircle2 className="w-3.5 h-3.5" />
          Zone Allocations (30 Zones)
        </button>

        <button
          onClick={() => setSelectedSubTab('roster')}
          className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
            selectedSubTab === 'roster'
              ? 'bg-cyan-600 text-white'
              : 'text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
        >
          <Car className="w-3.5 h-3.5" />
          Virtual Vehicle Roster ({filteredVehicles.length})
        </button>
      </div>

      {/* SUB-VIEW 1: Assigned Movements & Repositioning Tracker */}
      {selectedSubTab === 'movements' && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-sm">
          <div className="p-4 border-b border-slate-800 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Navigation className="w-4 h-4 text-purple-400" />
                Active Repositioning Movements & En-Route Transit Tracker
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-800 ml-2">SIMULATED</span>
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Automatically assigned by the 15-minute engine to satisfy deficit zone shortages. Updates to AVAILABLE upon verified arrival.
              </p>
            </div>
            <span className="text-xs font-mono bg-purple-950 text-purple-300 border border-purple-800/80 px-2 py-0.5 rounded font-bold">
              {activeMovements.length} Active Corridors
            </span>
          </div>

          {activeMovements.length === 0 ? (
            <div className="p-10 text-center text-slate-400 text-xs">
              <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto mb-2 opacity-80" />
              <p className="font-semibold text-white">No Vehicles Currently in Transit</p>
              <p className="text-slate-500 mt-1">
                Fleet is positioned in balanced staging across zones. Next repositioning evaluated during upcoming 15-minute forecast cycle.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-300">
                <thead className="bg-slate-950 text-slate-400 uppercase text-[10px] tracking-wider border-b border-slate-800 font-semibold">
                  <tr>
                    <th className="py-2.5 px-4">Vehicle ID</th>
                    <th className="py-2.5 px-3">Transit Corridor</th>
                    <th className="py-2.5 px-3">Departure</th>
                    <th className="py-2.5 px-3">Est. Arrival</th>
                    <th className="py-2.5 px-3">Elapsed / Remaining</th>
                    <th className="py-2.5 px-3">Progress</th>
                    <th className="py-2.5 px-3">Movement Status</th>
                    <th className="py-2.5 px-3">Recommendation Ref</th>
                    <th className="py-2.5 px-4 text-right">Battery</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono text-[11px]">
                  {activeMovements.map((v) => {
                    const progressPct = v.movementProgressPct ?? 10;
                    return (
                      <tr key={v.id} className="hover:bg-slate-800/40 transition">
                        <td className="py-2.5 px-4 font-bold text-cyan-400">{v.id}</td>
                        <td className="py-2.5 px-3 font-sans font-medium">
                          <div className="flex items-center gap-1.5">
                            <span className="text-slate-200">{v.zoneId}</span>
                            <ArrowRight className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                            <span className="text-purple-300 font-bold">{v.targetZoneName || v.targetZoneId}</span>
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-slate-300 font-sans text-[11px]">
                          {v.movementStartedAt
                            ? new Date(v.movementStartedAt).toLocaleTimeString('en-IN', {
                                hour: '2-digit',
                                minute: '2-digit',
                                timeZone: 'Asia/Kolkata',
                              })
                            : 'Recent'}
                        </td>
                        <td className="py-2.5 px-3 text-slate-300 font-sans text-[11px]">
                          {v.estimatedArrivalAt
                            ? new Date(v.estimatedArrivalAt).toLocaleTimeString('en-IN', {
                                hour: '2-digit',
                                minute: '2-digit',
                                timeZone: 'Asia/Kolkata',
                              })
                            : 'Within cycle'}
                        </td>
                        <td className="py-2.5 px-3 font-sans text-[11px]">
                          <span className="text-slate-300">{v.elapsedMinutes !== undefined ? `${v.elapsedMinutes}m el.` : '—'}</span>
                          {' • '}
                          <span className="text-cyan-400 font-semibold">{v.remainingMinutes !== undefined ? `${v.remainingMinutes}m left` : '—'}</span>
                        </td>
                        <td className="py-2.5 px-3 font-sans">
                          <div className="w-28 bg-slate-950 rounded-full h-2 border border-slate-800 overflow-hidden">
                            <div
                              className="bg-gradient-to-r from-purple-500 to-cyan-500 h-2 rounded-full transition-all duration-300"
                              style={{ width: `${progressPct}%` }}
                            />
                          </div>
                          <span className="text-[10px] text-purple-300 font-mono mt-0.5 block">
                            {progressPct}% (Simulated)
                          </span>
                        </td>
                        <td className="py-2.5 px-3 font-sans">
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-purple-950 text-purple-300 border border-purple-800">
                            En Route (Simulated)
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-slate-400 text-[10px]">
                          {v.assignedRecommendationId || 'REPOSITION-AUTO'}
                        </td>
                        <td className="py-2.5 px-4 text-right font-sans">
                          <span className="text-emerald-400 font-semibold">{v.batteryOrFuelLevel}%</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* SUB-VIEW 2: 30 Geographical Zones Allocation Totals */}
      {selectedSubTab === 'allocations' && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-sm">
          <div className="p-4 border-b border-slate-800 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-white">Zone Fleet Allocation Matrix (30 Zones)</h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Real-time count of total, available, busy, and en-route vehicles persisted per geographical zone.
              </p>
            </div>
            <span className="text-xs font-mono text-cyan-400 font-bold">1,200 Total Vehicles</span>
          </div>

          <div className="overflow-x-auto max-h-96">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-slate-950 text-slate-400 uppercase text-[10px] tracking-wider sticky top-0 border-b border-slate-800 font-semibold">
                <tr>
                  <th className="py-2.5 px-4">Zone ID</th>
                  <th className="py-2.5 px-3">Zone Name</th>
                  <th className="py-2.5 px-3">Urban Category</th>
                  <th className="py-2.5 px-3 text-center">Total Vehicles</th>
                  <th className="py-2.5 px-3 text-center text-emerald-400">Available</th>
                  <th className="py-2.5 px-3 text-center text-blue-400">Busy (Trips)</th>
                  <th className="py-2.5 px-3 text-center text-purple-400">En Route</th>
                  <th className="py-2.5 px-4 text-center text-slate-400">Offline</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono text-[11px]">
                {zoneAllocations.map((row) => (
                  <tr key={row.zoneId} className="hover:bg-slate-800/40 transition">
                    <td className="py-2 px-4 font-bold text-cyan-400">{row.zoneId}</td>
                    <td className="py-2 px-3 text-white font-sans font-medium">{row.zoneName}</td>
                    <td className="py-2 px-3 text-slate-400 font-sans text-[10px]">{row.category}</td>
                    <td className="py-2 px-3 text-center font-bold text-white">{row.total}</td>
                    <td className="py-2 px-3 text-center text-emerald-400 font-bold">{row.available}</td>
                    <td className="py-2 px-3 text-center text-blue-400">{row.busy}</td>
                    <td className="py-2 px-3 text-center text-purple-400">{row.enRoute}</td>
                    <td className="py-2 px-4 text-center text-slate-400">{row.offline}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SUB-VIEW 3: Vehicle Roster Table */}
      {selectedSubTab === 'roster' && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-sm">
          <div className="p-4 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center space-x-2">
              <h3 className="text-sm font-bold text-white">Virtual Vehicle Roster</h3>
              <span className="text-xs text-slate-400">({filteredVehicles.length} vehicles shown)</span>
            </div>

            <div className="flex items-center gap-3">
              {/* Search bar */}
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                <input
                  type="text"
                  placeholder="Search ID or Zone..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-3 py-1 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                />
              </div>

              {/* Filter by state */}
              <div className="flex items-center space-x-1 bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs">
                {['ALL', 'AVAILABLE', 'BUSY', 'EN_ROUTE', 'OFFLINE'].map((st) => (
                  <button
                    key={st}
                    onClick={() => setFilterState(st)}
                    className={`px-2.5 py-1 rounded font-medium transition cursor-pointer text-[11px] ${
                      filterState === st ? 'bg-cyan-600 text-white' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {st}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="overflow-x-auto max-h-96">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-slate-950 text-slate-400 uppercase text-[10px] tracking-wider sticky top-0 border-b border-slate-800 font-semibold">
                <tr>
                  <th className="py-2.5 px-4">Vehicle ID</th>
                  <th className="py-2.5 px-3">Current Zone</th>
                  <th className="py-2.5 px-3">State</th>
                  <th className="py-2.5 px-3">Movement Assignment</th>
                  <th className="py-2.5 px-3">Battery / Fuel</th>
                  <th className="py-2.5 px-3 text-center">Trips Today</th>
                  <th className="py-2.5 px-3 text-center">Repositions</th>
                  <th className="py-2.5 px-4 text-right">Last State Change</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono text-[11px]">
                {filteredVehicles.slice(0, 50).map((v) => (
                  <tr key={v.id} className="hover:bg-slate-800/40 transition">
                    <td className="py-2 px-4 font-bold text-cyan-400">{v.id}</td>
                    <td className="py-2 px-3 text-slate-200">{v.zoneId}</td>
                    <td className="py-2 px-3 font-sans">
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase ${
                          v.state === 'AVAILABLE'
                            ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                            : v.state === 'BUSY'
                            ? 'bg-blue-950 text-blue-400 border border-blue-800'
                            : v.state === 'EN_ROUTE'
                            ? 'bg-purple-950 text-purple-400 border border-purple-800'
                            : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        {v.state}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-slate-300 font-sans text-[11px]">
                      {v.targetZoneId ? (
                        <span className="text-purple-300 font-mono text-[10px] bg-purple-950/80 px-1.5 py-0.5 rounded border border-purple-800/60">
                          En route to {v.targetZoneId} ({v.movementProgressPct || 0}%) · Sim
                        </span>
                      ) : (
                        <span className="text-slate-500 text-[10px]">—</span>
                      )}
                    </td>
                    <td className="py-2 px-3">
                      <div className="flex items-center gap-1.5 font-sans">
                        <Battery
                          className={`w-3.5 h-3.5 ${
                            v.batteryOrFuelLevel > 50
                              ? 'text-emerald-400'
                              : v.batteryOrFuelLevel > 20
                              ? 'text-amber-400'
                              : 'text-red-400'
                          }`}
                        />
                        <span>{v.batteryOrFuelLevel}%</span>
                      </div>
                    </td>
                    <td className="py-2 px-3 text-center text-slate-300 font-sans">{v.tripsCompletedToday}</td>
                    <td className="py-2 px-3 text-center text-slate-300 font-sans">{v.repositionCountToday}</td>
                    <td className="py-2 px-4 text-right text-slate-400 text-[10px] font-sans">
                      {new Date(v.lastStateChange).toLocaleTimeString('en-IN', {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                        timeZone: 'Asia/Kolkata',
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
