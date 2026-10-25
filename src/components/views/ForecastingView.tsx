import React, { useState, useEffect, useMemo } from 'react';
import {
  TrendingUp,
  Clock,
  AlertTriangle,
  RefreshCw,
  Search,
  Filter,
  CheckCircle2,
  Users,
  Car,
  ChevronRight,
  ArrowUpRight,
  MapPin,
  Calendar,
  X,
} from 'lucide-react';
import { ZoneRecord, SupplyDemandAnalysis } from '../../lib/types';
import { api } from '../../services/api';

interface ForecastingViewProps {
  zones: ZoneRecord[];
}

interface IntervalData {
  index: number;
  startTime: Date;
  endTime: Date;
  timeLabel: string;
  intervalRange: string;
  totalDemand: number;
  baselineDemand: number;
  eventLift: number;
  zoneForecasts: Map<string, { eventAdjustedDemand: number; baselineDemand: number }>;
}

export const ForecastingView: React.FC<ForecastingViewProps> = ({ zones }) => {
  const [loading, setLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [selectedZoneId, setSelectedZoneId] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'SHORTAGE' | 'BALANCED_SURPLUS'>('ALL');
  const [sortBy, setSortBy] = useState<'demand-desc' | 'shortage-desc' | 'name-asc'>('demand-desc');

  // Genuine API data
  const [raw15mHorizon, setRaw15mHorizon] = useState<{ timestamp: string; forecasts: any[] }[]>([]);
  const [supplyDemandData, setSupplyDemandData] = useState<SupplyDemandAnalysis[]>([]);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date>(new Date());

  const loadForecastData = async (showRefreshSpinner: boolean = false) => {
    if (showRefreshSpinner) setIsRefreshing(true);
    else setLoading(true);

    try {
      const [forecast15m, sd] = await Promise.all([
        api.getForecast15mHorizon(4), // Next 1 hour in four 15-minute intervals
        api.getSupplyDemand(0, 2.2),  // Real zone supply & demand balances
      ]);
      setRaw15mHorizon(forecast15m || []);
      setSupplyDemandData(sd?.zones || []);
      setLastRefreshedAt(new Date());
    } catch (err) {
      console.error('Failed to load forecast data:', err);
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    loadForecastData();
    // Auto-refresh forecast every 60 seconds
    const interval = setInterval(() => {
      loadForecastData(false);
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  // Format 4 distinct 15-minute intervals
  const intervals: IntervalData[] = useMemo(() => {
    if (!raw15mHorizon || raw15mHorizon.length === 0) return [];

    return raw15mHorizon.slice(0, 4).map((step, idx) => {
      const start = new Date(step.timestamp);
      const end = new Date(start.getTime() + 15 * 60 * 1000);

      const formatTime = (d: Date) =>
        d.toLocaleTimeString('en-IN', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: true,
          timeZone: 'Asia/Kolkata',
        });

      const startStr = formatTime(start);
      const endStr = formatTime(end);

      const zoneForecasts = new Map<string, { eventAdjustedDemand: number; baselineDemand: number }>();
      let totalDemand = 0;
      let baselineDemand = 0;

      for (const f of step.forecasts || []) {
        const d = f.eventAdjustedDemand ?? f.predictedDemand ?? 0;
        const b = f.baselineDemand ?? f.predictedDemand ?? 0;
        zoneForecasts.set(f.zoneId, { eventAdjustedDemand: d, baselineDemand: b });
        totalDemand += d;
        baselineDemand += b;
      }

      return {
        index: idx + 1,
        startTime: start,
        endTime: end,
        timeLabel: startStr,
        intervalRange: `${startStr} – ${endStr}`,
        totalDemand,
        baselineDemand,
        eventLift: Math.max(0, totalDemand - baselineDemand),
        zoneForecasts,
      };
    });
  }, [raw15mHorizon]);

  // Selected Zone summary & intervals
  const selectedZone = useMemo(() => {
    if (selectedZoneId === 'ALL') return null;
    return zones.find((z) => z.id === selectedZoneId) || null;
  }, [selectedZoneId, zones]);

  // 1-Hour metrics for selected zone or metropolitan total
  const metrics = useMemo(() => {
    if (intervals.length === 0) {
      return {
        expectedTrips: 0,
        baselineTrips: 0,
        eventLiftTrips: 0,
        busiestInterval: null as IntervalData | null,
        busiestIntervalDemand: 0,
        shortageZonesCount: 0,
        criticalZonesCount: 0,
      };
    }

    let expectedTrips = 0;
    let baselineTrips = 0;

    let maxIntervalDemand = -1;
    let busiestInterval: IntervalData | null = null;

    intervals.forEach((iv) => {
      let intervalDemand = 0;
      let intervalBase = 0;

      if (selectedZoneId === 'ALL') {
        intervalDemand = iv.totalDemand;
        intervalBase = iv.baselineDemand;
      } else {
        const zForecast = iv.zoneForecasts.get(selectedZoneId);
        intervalDemand = zForecast?.eventAdjustedDemand || 0;
        intervalBase = zForecast?.baselineDemand || 0;
      }

      expectedTrips += intervalDemand;
      baselineTrips += intervalBase;

      if (intervalDemand > maxIntervalDemand) {
        maxIntervalDemand = intervalDemand;
        busiestInterval = iv;
      }
    });

    // Zones with potential shortages from supply-demand
    const shortageZones = supplyDemandData.filter(
      (z) => z.shortageSeverity === 'CRITICAL' || z.shortageSeverity === 'MODERATE'
    );
    const criticalZones = supplyDemandData.filter((z) => z.shortageSeverity === 'CRITICAL');

    return {
      expectedTrips,
      baselineTrips,
      eventLiftTrips: Math.max(0, expectedTrips - baselineTrips),
      busiestInterval,
      busiestIntervalDemand: maxIntervalDemand,
      shortageZonesCount: shortageZones.length,
      criticalZonesCount: criticalZones.length,
    };
  }, [intervals, selectedZoneId, supplyDemandData]);

  // Zone aggregated table data (1-hour forecast + available vehicles + status)
  const zoneRows = useMemo(() => {
    const sdMap = new Map<string, SupplyDemandAnalysis>();
    supplyDemandData.forEach((sd) => sdMap.set(sd.zoneId, sd));

    return zones.map((zone) => {
      const sd = sdMap.get(zone.id);
      const availableVehicles = sd?.availableVehicles ?? 0;
      const severity = sd?.shortageSeverity ?? 'BALANCED';
      const unmetDemand = sd?.unmetDemand ?? 0;
      const hourlySupplyCapacity = sd?.hourlySupplyCapacity ?? availableVehicles * 2.2;

      // Sum of predicted demand across the four 15m intervals for this zone
      let total1hDemand = 0;
      const intervalValues: number[] = [];

      intervals.forEach((iv) => {
        const val = iv.zoneForecasts.get(zone.id)?.eventAdjustedDemand || 0;
        intervalValues.push(val);
        total1hDemand += val;
      });

      // If intervals not yet loaded, fall back to eventAdjustedDemand in sd
      if (total1hDemand === 0 && sd) {
        total1hDemand = sd.eventAdjustedDemand;
      }

      return {
        zoneId: zone.id,
        zoneName: zone.name,
        category: zone.category,
        total1hDemand,
        avg15mDemand: Math.round(total1hDemand / 4),
        intervalValues,
        availableVehicles,
        hourlySupplyCapacity,
        unmetDemand,
        shortageSeverity: severity,
      };
    });
  }, [zones, supplyDemandData, intervals]);

  // Filtered and sorted table rows
  const filteredZoneRows = useMemo(() => {
    return zoneRows
      .filter((row) => {
        // Status filter
        if (statusFilter === 'SHORTAGE') {
          if (row.shortageSeverity !== 'CRITICAL' && row.shortageSeverity !== 'MODERATE') {
            return false;
          }
        } else if (statusFilter === 'BALANCED_SURPLUS') {
          if (row.shortageSeverity !== 'BALANCED' && row.shortageSeverity !== 'SURPLUS') {
            return false;
          }
        }

        // Search query
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase().trim();
          return (
            row.zoneId.toLowerCase().includes(q) ||
            row.zoneName.toLowerCase().includes(q) ||
            row.category.toLowerCase().includes(q)
          );
        }

        return true;
      })
      .sort((a, b) => {
        if (sortBy === 'demand-desc') {
          return b.total1hDemand - a.total1hDemand;
        }
        if (sortBy === 'shortage-desc') {
          // Sort by shortage severity first (CRITICAL > MODERATE > BALANCED > SURPLUS)
          const weight = { CRITICAL: 3, MODERATE: 2, BALANCED: 1, SURPLUS: 0 };
          const diff = weight[b.shortageSeverity] - weight[a.shortageSeverity];
          if (diff !== 0) return diff;
          return b.unmetDemand - a.unmetDemand;
        }
        if (sortBy === 'name-asc') {
          return a.zoneName.localeCompare(b.zoneName);
        }
        return 0;
      });
  }, [zoneRows, statusFilter, searchQuery, sortBy]);

  // Chart data points for the 4 intervals
  const chartPoints = useMemo(() => {
    return intervals.map((iv) => {
      let demand = 0;
      let base = 0;

      if (selectedZoneId === 'ALL') {
        demand = iv.totalDemand;
        base = iv.baselineDemand;
      } else {
        const zForecast = iv.zoneForecasts.get(selectedZoneId);
        demand = zForecast?.eventAdjustedDemand || 0;
        base = zForecast?.baselineDemand || 0;
      }

      return {
        index: iv.index,
        timeLabel: iv.timeLabel,
        intervalRange: iv.intervalRange,
        demand,
        base,
        eventLift: Math.max(0, demand - base),
      };
    });
  }, [intervals, selectedZoneId]);

  const maxChartVal = useMemo(() => {
    const vals = chartPoints.map((p) => p.demand);
    return Math.max(...vals, 10);
  }, [chartPoints]);

  return (
    <div className="space-y-6">
      {/* Header & Operational Scope Bar */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">
              <TrendingUp className="w-5 h-5" />
            </span>
            <div>
              <h2 className="text-lg font-bold text-white tracking-tight">Demand Forecast</h2>
              <p className="text-xs text-slate-400">
                Next 1-Hour Passenger Trip Predictions Across Four 15-Minute Operational Intervals
              </p>
            </div>
          </div>
        </div>

        {/* Zone Selector & Controls */}
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center space-x-2 bg-slate-950 px-3 py-1.5 rounded-lg border border-slate-800 text-xs">
            <MapPin className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
            <select
              value={selectedZoneId}
              onChange={(e) => setSelectedZoneId(e.target.value)}
              className="bg-transparent text-white font-medium focus:outline-none cursor-pointer max-w-[200px] md:max-w-[260px] truncate"
            >
              <option value="ALL" className="bg-slate-900 text-white">
                All Zones (Metropolitan Total)
              </option>
              {zones.map((z) => (
                <option key={z.id} value={z.id} className="bg-slate-900 text-white">
                  {z.id} — {z.name}
                </option>
              ))}
            </select>
            {selectedZoneId !== 'ALL' && (
              <button
                onClick={() => setSelectedZoneId('ALL')}
                title="Reset to All Zones"
                className="text-slate-400 hover:text-white transition ml-1 p-0.5 rounded cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <button
            onClick={() => loadForecastData(true)}
            disabled={isRefreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white rounded-lg text-xs font-medium transition cursor-pointer"
            title="Refresh 15-minute operational forecasts"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-cyan-400' : ''}`} />
            <span>{isRefreshing ? 'Refreshing...' : 'Refresh'}</span>
          </button>
        </div>
      </div>

      {/* Selected Zone Pill Indicator */}
      {selectedZone && (
        <div className="bg-cyan-950/40 border border-cyan-800/40 rounded-lg px-4 py-2 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
            <span className="text-slate-400">Filtering forecast to:</span>
            <span className="font-bold text-white font-mono">{selectedZone.id}</span>
            <span className="text-cyan-300 font-semibold">{selectedZone.name}</span>
            <span className="text-[10px] px-2 py-0.5 rounded bg-cyan-900/60 text-cyan-200 border border-cyan-700/50">
              {selectedZone.category}
            </span>
          </div>
          <button
            onClick={() => setSelectedZoneId('ALL')}
            className="text-cyan-400 hover:text-cyan-200 text-xs font-semibold flex items-center gap-1 cursor-pointer"
          >
            Show All 30 Zones
          </button>
        </div>
      )}

      {/* 3 Key Metrics Cards (Requirement 2) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Metric 1: Expected Passenger Trips */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm relative overflow-hidden">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Expected Passenger Trips</span>
            <Users className="w-4 h-4 text-cyan-400" />
          </div>
          <div className="flex items-baseline gap-2 mb-1">
            <span className="text-3xl font-extrabold text-white tracking-tight font-mono">
              {loading ? '...' : metrics.expectedTrips.toLocaleString()}
            </span>
            <span className="text-xs text-slate-400">trips / next 1h</span>
          </div>
          <div className="flex items-center justify-between text-[11px] text-slate-400 mt-2 pt-2 border-t border-slate-800/80">
            <span>
              {selectedZoneId === 'ALL' ? 'Across 30 GVMC zones' : 'In selected zone'}
            </span>
            {metrics.eventLiftTrips > 0 ? (
              <span className="text-cyan-400 font-medium font-mono">
                +{metrics.eventLiftTrips} event lift
              </span>
            ) : (
              <span className="text-slate-500 font-mono">Base diurnal curve</span>
            )}
          </div>
        </div>

        {/* Metric 2: Busiest 15-Minute Interval */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm relative overflow-hidden">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Busiest 15-Minute Interval</span>
            <Clock className="w-4 h-4 text-amber-400" />
          </div>
          <div className="flex items-baseline gap-2 mb-1">
            <span className="text-2xl font-extrabold text-amber-300 tracking-tight">
              {loading || !metrics.busiestInterval ? '...' : metrics.busiestInterval.intervalRange}
            </span>
          </div>
          <div className="flex items-center justify-between text-[11px] text-slate-400 mt-2 pt-2 border-t border-slate-800/80">
            <span>Peak quarter-hour volume:</span>
            <span className="text-amber-300 font-semibold font-mono">
              {loading ? '...' : `${metrics.busiestIntervalDemand} trips`}
              {metrics.expectedTrips > 0 &&
                ` (${Math.round((metrics.busiestIntervalDemand / metrics.expectedTrips) * 100)}%)`}
            </span>
          </div>
        </div>

        {/* Metric 3: Zones with Potential Shortages */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm relative overflow-hidden">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Zones with Potential Shortages</span>
            <AlertTriangle className="w-4 h-4 text-red-400" />
          </div>
          <div className="flex items-baseline gap-2 mb-1">
            <span
              className={`text-3xl font-extrabold font-mono ${
                metrics.shortageZonesCount > 0 ? 'text-red-400' : 'text-emerald-400'
              }`}
            >
              {loading ? '...' : metrics.shortageZonesCount}
            </span>
            <span className="text-xs text-slate-400">
              {metrics.shortageZonesCount === 1 ? 'zone needs fleet' : 'zones need fleet'}
            </span>
          </div>
          <div className="flex items-center justify-between text-[11px] text-slate-400 mt-2 pt-2 border-t border-slate-800/80">
            <span>
              {metrics.criticalZonesCount > 0 ? (
                <span className="text-red-400 font-medium">
                  {metrics.criticalZonesCount} critical shortage
                </span>
              ) : (
                <span className="text-slate-400">Demand exceeds local vehicles</span>
              )}
            </span>
            <button
              onClick={() => {
                setStatusFilter('SHORTAGE');
                const tableElem = document.getElementById('forecast-zones-table');
                tableElem?.scrollIntoView({ behavior: 'smooth' });
              }}
              className="text-cyan-400 hover:text-cyan-300 font-medium flex items-center gap-0.5 cursor-pointer"
            >
              <span>View in table</span>
              <ChevronRight className="w-3 h-3" />
            </button>
          </div>
        </div>
      </div>

      {/* Demand Chart for Next 60 Minutes (Requirement 3) */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4 pb-3 border-b border-slate-800/80">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Clock className="w-4 h-4 text-cyan-400" />
              Next 60-Minute Demand Forecast by 15-Minute Intervals
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              {selectedZoneId === 'ALL'
                ? 'Citywide trip volume across four upcoming quarter-hour windows'
                : `Predicted trips for ${selectedZone?.name || selectedZoneId} across four upcoming quarter-hour windows`}
            </p>
          </div>

          <div className="flex items-center gap-4 text-xs">
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-sm bg-gradient-to-t from-cyan-600 to-cyan-400" />
              <span className="text-slate-300">Predicted Demand</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
              <span className="text-slate-400">Peak Interval</span>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="h-56 flex items-center justify-center text-xs text-slate-400">
            <RefreshCw className="w-5 h-5 animate-spin text-cyan-400 mr-2" />
            Loading 15-minute forecast intervals...
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 pt-2">
            {chartPoints.map((pt, idx) => {
              const isPeak = pt.demand === metrics.busiestIntervalDemand && pt.demand > 0;
              const fillPct = maxChartVal > 0 ? Math.max(12, Math.round((pt.demand / maxChartVal) * 100)) : 20;

              return (
                <div
                  key={idx}
                  className={`bg-slate-950/70 border rounded-xl p-4 flex flex-col justify-between transition relative overflow-hidden ${
                    isPeak
                      ? 'border-amber-500/50 shadow-sm shadow-amber-500/10'
                      : 'border-slate-800 hover:border-slate-700'
                  }`}
                >
                  {/* Peak Tag */}
                  {isPeak && (
                    <span className="absolute top-2 right-2 px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 uppercase tracking-wider">
                      Busiest
                    </span>
                  )}

                  <div>
                    <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                      <span className="font-semibold text-slate-300">Interval {pt.index}</span>
                      <span className="text-[11px] font-mono text-slate-500">
                        {idx === 0 && '0–15 min'}
                        {idx === 1 && '15–30 min'}
                        {idx === 2 && '30–45 min'}
                        {idx === 3 && '45–60 min'}
                      </span>
                    </div>

                    <div className="text-xs font-mono font-bold text-cyan-300 mb-3">
                      {pt.intervalRange}
                    </div>

                    <div className="flex items-baseline gap-1.5 mb-2">
                      <span className="text-2xl font-bold font-mono text-white">
                        {pt.demand.toLocaleString()}
                      </span>
                      <span className="text-xs text-slate-400">trips</span>
                    </div>
                  </div>

                  {/* Visual Bar representation */}
                  <div className="space-y-1.5 mt-2">
                    <div className="w-full bg-slate-900 rounded-full h-2.5 overflow-hidden border border-slate-800">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${
                          isPeak
                            ? 'bg-gradient-to-r from-amber-500 to-amber-300'
                            : 'bg-gradient-to-r from-cyan-600 to-cyan-400'
                        }`}
                        style={{ width: `${fillPct}%` }}
                      />
                    </div>
                    <div className="flex justify-between items-center text-[10px] text-slate-500 font-mono">
                      <span>{pt.timeLabel}</span>
                      {pt.eventLift > 0 ? (
                        <span className="text-cyan-400 font-medium">+{pt.eventLift} event</span>
                      ) : (
                        <span>Base rate</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Compact Zone Demand Table (Requirement 4) */}
      <div id="forecast-zones-table" className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-sm">
        {/* Table Controls Bar */}
        <div className="p-4 border-b border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Car className="w-4 h-4 text-cyan-400" />
              Zone Demand, Vehicle Supply & Balance Overview
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Predicted passenger demand for the next hour matched with current available fleet across 30 zones
            </p>
          </div>

          {/* Quick Filters & Search */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {/* Status Filter Chips */}
            <div className="flex items-center bg-slate-950 p-1 rounded-lg border border-slate-800">
              <button
                onClick={() => setStatusFilter('ALL')}
                className={`px-2.5 py-1 rounded font-medium transition cursor-pointer text-xs ${
                  statusFilter === 'ALL'
                    ? 'bg-cyan-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                All ({zoneRows.length})
              </button>
              <button
                onClick={() => setStatusFilter('SHORTAGE')}
                className={`px-2.5 py-1 rounded font-medium transition cursor-pointer text-xs flex items-center gap-1 ${
                  statusFilter === 'SHORTAGE'
                    ? 'bg-red-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-red-400'
                }`}
              >
                <AlertTriangle className="w-3 h-3" />
                Shortages ({metrics.shortageZonesCount})
              </button>
              <button
                onClick={() => setStatusFilter('BALANCED_SURPLUS')}
                className={`px-2.5 py-1 rounded font-medium transition cursor-pointer text-xs ${
                  statusFilter === 'BALANCED_SURPLUS'
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-emerald-400'
                }`}
              >
                Balanced / Surplus
              </button>
            </div>

            {/* Sort Selector */}
            <div className="flex items-center gap-1.5 bg-slate-950 px-2.5 py-1.5 rounded-lg border border-slate-800 text-xs">
              <span className="text-slate-500">Sort:</span>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="bg-transparent text-slate-200 font-medium focus:outline-none cursor-pointer"
              >
                <option value="demand-desc" className="bg-slate-900 text-white">Highest Demand</option>
                <option value="shortage-desc" className="bg-slate-900 text-white">Shortage Severity</option>
                <option value="name-asc" className="bg-slate-900 text-white">Zone Name</option>
              </select>
            </div>

            {/* Search Input */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-500" />
              <input
                type="text"
                placeholder="Search zone..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 pr-3 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 w-44"
              />
            </div>
          </div>
        </div>

        {/* Table Body */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950/70 text-slate-400 uppercase font-semibold text-[10px] tracking-wider border-b border-slate-800">
              <tr>
                <th className="py-3 px-4">Zone Name & ID</th>
                <th className="py-3 px-4 text-right">Predicted Demand (Next 1h)</th>
                <th className="py-3 px-4 text-right">Available Vehicles</th>
                <th className="py-3 px-4 text-center">Demand Status</th>
                <th className="py-3 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-sans">
              {loading ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-slate-400 text-xs">
                    <RefreshCw className="w-5 h-5 animate-spin mx-auto text-cyan-400 mb-2" />
                    Loading zone forecasts and fleet telemetry...
                  </td>
                </tr>
              ) : filteredZoneRows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-slate-400 text-xs">
                    No zones matching the selected filters.
                  </td>
                </tr>
              ) : (
                filteredZoneRows.map((row) => {
                  const isSelected = selectedZoneId === row.zoneId;

                  return (
                    <tr
                      key={row.zoneId}
                      onClick={() => setSelectedZoneId(isSelected ? 'ALL' : row.zoneId)}
                      className={`hover:bg-slate-800/50 transition cursor-pointer ${
                        isSelected ? 'bg-cyan-950/30 border-l-2 border-l-cyan-400' : ''
                      }`}
                    >
                      {/* Zone Name */}
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-cyan-400 font-bold text-xs">
                            {row.zoneId}
                          </span>
                          <div>
                            <span className="font-semibold text-white block">
                              {row.zoneName}
                            </span>
                            <span className="text-[10px] text-slate-400">
                              {row.category}
                            </span>
                          </div>
                        </div>
                      </td>

                      {/* Predicted Demand */}
                      <td className="py-3 px-4 text-right font-mono">
                        <div className="font-bold text-white text-sm">
                          {row.total1hDemand.toLocaleString()}{' '}
                          <span className="text-[10px] text-slate-400 font-normal">trips</span>
                        </div>
                        <div className="text-[10px] text-slate-500">
                          ~{row.avg15mDemand} / 15m
                        </div>
                      </td>

                      {/* Available Vehicles */}
                      <td className="py-3 px-4 text-right font-mono">
                        <div className="font-bold text-slate-200 text-sm">
                          {row.availableVehicles}{' '}
                          <span className="text-[10px] text-slate-400 font-normal">vehicles</span>
                        </div>
                        <div className="text-[10px] text-slate-500">
                          Capacity: {Math.round(row.hourlySupplyCapacity)} trips/h
                        </div>
                      </td>

                      {/* Demand Status */}
                      <td className="py-3 px-4 text-center">
                        {row.shortageSeverity === 'CRITICAL' && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-red-950/80 text-red-300 border border-red-800/80">
                            <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
                            Critical Shortage
                          </span>
                        )}
                        {row.shortageSeverity === 'MODERATE' && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-950/80 text-amber-300 border border-amber-800/80">
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                            Moderate Deficit
                          </span>
                        )}
                        {row.shortageSeverity === 'BALANCED' && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium bg-emerald-950/80 text-emerald-300 border border-emerald-800/80">
                            <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                            Balanced
                          </span>
                        )}
                        {row.shortageSeverity === 'SURPLUS' && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium bg-cyan-950/80 text-cyan-300 border border-cyan-800/80">
                            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                            Surplus Fleet
                          </span>
                        )}
                      </td>

                      {/* Action */}
                      <td className="py-3 px-4 text-right">
                        <span className="text-xs font-medium text-cyan-400 hover:text-cyan-200 inline-flex items-center gap-0.5">
                          {isSelected ? 'Reset' : 'Focus'}
                          <ChevronRight className="w-3.5 h-3.5" />
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Table Footer */}
        <div className="p-3 bg-slate-950/70 border-t border-slate-800/80 text-[11px] text-slate-400 flex flex-wrap items-center justify-between gap-2 px-4">
          <div>
            Showing <strong className="text-white">{filteredZoneRows.length}</strong> of{' '}
            <strong className="text-white">{zones.length}</strong> zones
          </div>
          <div className="text-slate-500">
            Last updated:{' '}
            <span className="text-slate-400 font-mono">
              {lastRefreshedAt.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true })} IST
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
