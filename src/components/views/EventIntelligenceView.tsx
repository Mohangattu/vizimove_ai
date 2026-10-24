import React, { useState, useEffect } from 'react';
import { Calendar, MapPin, ExternalLink, Users, AlertCircle, Sparkles, Layers, Activity, RotateCw, Clock, CheckCircle2, XCircle } from 'lucide-react';
import { EventRecord, EventZoneAssociation } from '../../lib/types';
import { api } from '../../services/api';

interface EventIntelligenceViewProps {
  events: EventRecord[];
  onRefresh?: () => void;
  isRefreshing?: boolean;
}

export const EventIntelligenceView: React.FC<EventIntelligenceViewProps> = ({
  events,
  onRefresh,
  isRefreshing = false,
}) => {
  const [impacts, setImpacts] = useState<EventZoneAssociation[]>([]);
  const [activeTab, setActiveTab] = useState<'events' | 'spatial_decay'>('events');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'UPCOMING' | 'ACTIVE' | 'EXPIRED' | 'CANCELLED'>('ALL');
  const [loadingImpacts, setLoadingImpacts] = useState<boolean>(false);
  const [isIngesting, setIsIngesting] = useState<boolean>(false);
  const [ingestResult, setIngestResult] = useState<{ success: boolean; message: string } | null>(null);

  const loadImpacts = () => {
    setLoadingImpacts(true);
    api.getEventImpacts()
      .then((data) => setImpacts(data))
      .catch((err) => console.error('Failed to load event impacts', err))
      .finally(() => setLoadingImpacts(false));
  };

  useEffect(() => {
    loadImpacts();
  }, []);

  const handleRefresh = () => {
    loadImpacts();
    if (onRefresh) {
      onRefresh();
    }
  };

  const handleIngest = async () => {
    setIsIngesting(true);
    setIngestResult(null);
    try {
      const result = await api.triggerIngest();
      setIngestResult({ success: result.success, message: result.message });
      // Reload events and impacts after successful ingestion
      if (result.success) {
        loadImpacts();
        if (onRefresh) onRefresh();
      }
    } catch (err: any) {
      setIngestResult({ success: false, message: err?.message ?? 'Ingestion failed' });
    } finally {
      setIsIngesting(false);
      // Auto-clear the result banner after 6 seconds
      setTimeout(() => setIngestResult(null), 6000);
    }
  };

  const upcomingCount = events.filter((e) => e.status === 'UPCOMING').length;
  const activeCount = events.filter((e) => e.status === 'ACTIVE').length;
  const expiredCount = events.filter((e) => e.status === 'EXPIRED' || e.status === 'CONCLUDED').length;
  const cancelledCount = events.filter((e) => e.status === 'CANCELLED').length;

  const displayedEvents = events.filter((evt) => {
    if (statusFilter === 'UPCOMING') return evt.status === 'UPCOMING';
    if (statusFilter === 'ACTIVE') return evt.status === 'ACTIVE';
    if (statusFilter === 'EXPIRED') return evt.status === 'EXPIRED' || evt.status === 'CONCLUDED';
    if (statusFilter === 'CANCELLED') return evt.status === 'CANCELLED';
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            <Calendar className="w-4 h-4 text-purple-400" />
            Dynamic Event Intelligence & Spatial Decay Matrix
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Verified Visakhapatnam Events • Real-Time Temporal Status • Haversine Spatial Decay
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Run Ingestion Action */}
          <button
            onClick={handleIngest}
            disabled={isIngesting}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-purple-700 bg-purple-950/60 hover:bg-purple-900/60 text-xs text-purple-300 font-medium transition cursor-pointer disabled:opacity-50"
            title="Run ingestion pipeline across all event sources"
          >
            <Sparkles className={`w-3.5 h-3.5 ${isIngesting ? 'animate-pulse text-purple-400' : 'text-purple-400'}`} />
            <span>{isIngesting ? 'Ingesting...' : 'Run Ingestion'}</span>
          </button>

          {/* Refresh Action */}
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-800 bg-slate-950 hover:bg-slate-800 text-xs text-slate-300 font-medium transition cursor-pointer disabled:opacity-50"
            title="Refresh event statuses and impacts from backend"
          >
            <RotateCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-cyan-400' : 'text-slate-400'}`} />
            <span>{isRefreshing ? 'Refreshing...' : 'Refresh'}</span>
          </button>

          {/* Main Tab Controls */}
          <div className="flex items-center space-x-1 bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs">
            <button
              onClick={() => setActiveTab('events')}
              className={`px-3 py-1.5 rounded-md font-medium transition cursor-pointer ${
                activeTab === 'events' ? 'bg-purple-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'
              }`}
            >
              Verified Events ({events.length})
            </button>
            <button
              onClick={() => setActiveTab('spatial_decay')}
              className={`px-3 py-1.5 rounded-md font-medium transition cursor-pointer flex items-center gap-1.5 ${
                activeTab === 'spatial_decay' ? 'bg-purple-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              Zone Impact Matrix ({impacts.length})
            </button>
          </div>
        </div>
      </div>

      {/* Ingest result banner */}
      {ingestResult && (
        <div className={`rounded-lg px-4 py-2.5 text-xs font-medium flex items-center gap-2 border ${
          ingestResult.success
            ? 'bg-emerald-950/60 border-emerald-800 text-emerald-300'
            : 'bg-red-950/60 border-red-800 text-red-300'
        }`}>
          {ingestResult.success
            ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
            : <AlertCircle className="w-3.5 h-3.5 shrink-0" />}
          {ingestResult.message}
        </div>
      )}

      {activeTab === 'spatial_decay' ? (
        /* Event-to-Zone Spatial Decay Matrix */
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Layers className="w-4 h-4 text-purple-400" />
                Active Event-to-Zone Spatial Decay Associations
              </h3>
              <p className="text-xs text-slate-400">
                Shows documented Haversine distance decay, transit travel times, and sub-hourly baseline vs event-adjusted demand lift
              </p>
            </div>
            <span className="font-mono text-xs px-2.5 py-1 rounded bg-purple-950 text-purple-300 border border-purple-800">
              Method: Haversine Linear Decay
            </span>
          </div>

          <div className="overflow-x-auto border border-slate-800 rounded-lg">
            <table className="w-full min-w-[960px] text-left text-xs border-collapse">
              <thead className="bg-slate-950 text-slate-400 border-b border-slate-800 font-mono">
                <tr>
                  <th className="p-3 font-semibold text-white">Event</th>
                  <th className="p-3 font-semibold text-white">Target Zone</th>
                  <th className="p-3 font-semibold text-white">Haversine Distance</th>
                  <th className="p-3 font-semibold text-white">Travel Time</th>
                  <th className="p-3 font-semibold text-white">Temporal Phase</th>
                  <th className="p-3 font-semibold text-white">Baseline 15m</th>
                  <th className="p-3 font-semibold text-purple-400">Demand Lift Multiplier</th>
                  <th className="p-3 font-semibold text-emerald-400">Event-Adjusted 15m</th>
                  <th className="p-3 font-semibold text-slate-300">Surge Trips</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80 bg-slate-900/40">
                {impacts.map((assoc, idx) => (
                  <tr key={idx} className="hover:bg-slate-800/50">
                    <td className="p-3 font-medium text-white max-w-xs truncate" title={assoc.eventName}>
                      {assoc.eventName}
                    </td>
                    <td className="p-3 font-mono text-cyan-300">
                      {assoc.zoneId} — {assoc.zoneName}
                    </td>
                    <td className="p-3 font-mono text-slate-300">
                      {assoc.distanceKm} km <span className="text-slate-500 text-[10px]">(&le; {assoc.radiusKm}km)</span>
                    </td>
                    <td className="p-3 font-mono text-slate-300">
                      ~{assoc.travelTimeMin} mins
                    </td>
                    <td className="p-3">
                      <span className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase ${
                        assoc.temporalStatus === 'ACTIVE_PEAK'
                          ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                          : assoc.temporalStatus === 'UPCOMING_INFLOW'
                          ? 'bg-blue-950 text-blue-400 border border-blue-800'
                          : 'bg-amber-950 text-amber-400 border border-amber-800'
                      }`}>
                        {assoc.temporalStatus.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="p-3 font-mono text-slate-400">
                      {assoc.baselineDemand15m} trips
                    </td>
                    <td className="p-3 font-mono font-bold text-purple-300">
                      +{Math.round((assoc.eventLiftMultiplier - 1) * 100)}% ({assoc.eventLiftMultiplier}x)
                    </td>
                    <td className="p-3 font-mono font-bold text-emerald-400">
                      {assoc.eventAdjustedDemand15m} trips
                    </td>
                    <td className="p-3 font-mono font-bold text-amber-300">
                      +{assoc.additionalTripsExpected}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Status Sub-Filter Bar */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-slate-500 font-bold uppercase text-[10px] mr-1">Status Filter:</span>
              <button
                onClick={() => setStatusFilter('ALL')}
                className={`px-2.5 py-1 rounded font-medium transition cursor-pointer ${
                  statusFilter === 'ALL'
                    ? 'bg-purple-600 text-white font-bold shadow-sm'
                    : 'bg-slate-950 text-slate-400 hover:text-white border border-slate-800'
                }`}
              >
                All ({events.length})
              </button>
              <button
                onClick={() => setStatusFilter('UPCOMING')}
                className={`px-2.5 py-1 rounded font-medium transition cursor-pointer flex items-center gap-1 ${
                  statusFilter === 'UPCOMING'
                    ? 'bg-blue-600 text-white font-bold shadow-sm'
                    : 'bg-slate-950 text-blue-400/80 hover:text-blue-300 border border-slate-800'
                }`}
              >
                <Clock className="w-3 h-3" />
                Upcoming ({upcomingCount})
              </button>
              <button
                onClick={() => setStatusFilter('ACTIVE')}
                className={`px-2.5 py-1 rounded font-medium transition cursor-pointer flex items-center gap-1 ${
                  statusFilter === 'ACTIVE'
                    ? 'bg-emerald-600 text-white font-bold shadow-sm'
                    : 'bg-slate-950 text-emerald-400/80 hover:text-emerald-300 border border-slate-800'
                }`}
              >
                <Activity className="w-3 h-3" />
                Active ({activeCount})
              </button>
              <button
                onClick={() => setStatusFilter('EXPIRED')}
                className={`px-2.5 py-1 rounded font-medium transition cursor-pointer flex items-center gap-1 ${
                  statusFilter === 'EXPIRED'
                    ? 'bg-slate-700 text-white font-bold shadow-sm'
                    : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
                }`}
              >
                <CheckCircle2 className="w-3 h-3" />
                Past / Expired ({expiredCount})
              </button>
              <button
                onClick={() => setStatusFilter('CANCELLED')}
                className={`px-2.5 py-1 rounded font-medium transition cursor-pointer flex items-center gap-1 ${
                  statusFilter === 'CANCELLED'
                    ? 'bg-red-600 text-white font-bold shadow-sm'
                    : 'bg-slate-950 text-red-400/80 hover:text-red-300 border border-slate-800'
                }`}
              >
                <XCircle className="w-3 h-3" />
                Cancelled ({cancelledCount})
              </button>
            </div>

            <span className="text-[11px] text-slate-400 font-mono">
              Showing {displayedEvents.length} of {events.length} event records
            </span>
          </div>

          {/* Event Cards Grid */}
          {displayedEvents.length === 0 ? (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-12 text-center text-slate-400 space-y-2">
              <Calendar className="w-8 h-8 mx-auto text-slate-600" />
              <p className="font-medium text-sm text-slate-300">
                No {statusFilter === 'ALL' ? '' : statusFilter.toLowerCase()} events found
              </p>
              <p className="text-xs text-slate-500">
                {statusFilter === 'UPCOMING'
                  ? 'There are currently no upcoming events scheduled in the pipeline.'
                  : `Try switching to another filter or check back later.`}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {displayedEvents.map((evt) => (
                <div
                  key={evt.id}
                  className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col justify-between shadow-sm hover:border-slate-700 transition"
                >
                  <div>
                    {/* Event Header */}
                    <div className="flex items-center justify-between mb-3">
                      <span className="font-mono text-xs font-bold text-purple-300 bg-purple-950/80 px-2 py-0.5 rounded border border-purple-800/60">
                        {evt.id}
                      </span>
                      <div className="flex items-center gap-2">
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase ${
                            evt.status === 'ACTIVE'
                              ? 'bg-emerald-950 text-emerald-400 border border-emerald-800 animate-pulse'
                              : evt.status === 'UPCOMING'
                              ? 'bg-blue-950 text-blue-400 border border-blue-800'
                              : evt.status === 'CANCELLED'
                              ? 'bg-red-950 text-red-400 border border-red-800'
                              : 'bg-slate-800 text-slate-400 border border-slate-700'
                          }`}
                        >
                          {evt.status === 'EXPIRED' ? 'EXPIRED' : evt.status}
                        </span>
                        <span className="text-[10px] bg-slate-800 text-slate-300 px-2 py-0.5 rounded font-medium">
                          {evt.eventType}
                        </span>
                      </div>
                    </div>

                    <h3 className="text-sm font-bold text-white mb-1.5 leading-snug">{evt.name}</h3>

                    <div className="flex items-center gap-1.5 text-xs text-slate-400 mb-3">
                      <MapPin className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                      <span>
                        {evt.venueName} • Zone <strong className="text-cyan-300">{evt.associatedZoneId || 'Metropolitan'}</strong>
                      </span>
                    </div>

                    {/* Numerical Metrics Box */}
                    <div className="grid grid-cols-2 gap-3 bg-slate-950/80 p-3 rounded-lg border border-slate-800/80 text-xs mb-3">
                      <div>
                        <span className="text-slate-500 block text-[10px] uppercase font-bold">Attendance</span>
                        <div className="flex items-center gap-1 text-white font-bold mt-0.5">
                          <Users className="w-3.5 h-3.5 text-slate-400" />
                          <span>{evt.estimatedAttendance !== null && evt.estimatedAttendance !== undefined ? evt.estimatedAttendance.toLocaleString() : 'Unknown'}</span>
                        </div>
                        <span className="text-[10px] text-slate-400">({evt.attendanceType})</span>
                      </div>

                      <div>
                        <span className="text-slate-500 block text-[10px] uppercase font-bold">Peak Demand Lift</span>
                        <div className="text-purple-300 font-bold mt-0.5 text-sm">
                          {evt.status === 'CANCELLED' || evt.status === 'EXPIRED' ? (
                            <span className="text-slate-500 line-through">+{Math.round((evt.peakDemandMultiplier - 1) * 100)}%</span>
                          ) : (
                            <span>+{Math.round((evt.peakDemandMultiplier - 1) * 100)}% Surge</span>
                          )}
                        </div>
                        <span className="text-[10px] text-slate-400">Radius: {evt.radiusKm} km decay</span>
                      </div>
                    </div>

                    {/* Schedule Timing (IST representation) */}
                    <div className="text-xs text-slate-300 space-y-1 mb-3 bg-slate-950/40 p-2.5 rounded border border-slate-800/60 text-[11px]">
                      <div className="flex justify-between">
                        <span className="text-slate-500">Event Start:</span>
                        <span className="font-mono text-slate-300">
                          {new Date(evt.startTime).toLocaleString('en-IN', {
                            timeZone: 'Asia/Kolkata',
                            dateStyle: 'medium',
                            timeStyle: 'short',
                          })}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Event End:</span>
                        <span className="font-mono text-slate-300">
                          {new Date(evt.endTime).toLocaleString('en-IN', {
                            timeZone: 'Asia/Kolkata',
                            dateStyle: 'medium',
                            timeStyle: 'short',
                          })}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Source Provenance Link */}
                  <div className="pt-3 border-t border-slate-800 flex items-center justify-between text-[11px]">
                    <span className="text-slate-400 truncate max-w-[240px]">
                      Source: {evt.sourceName}
                    </span>
                    <a
                      href={evt.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-cyan-400 hover:text-cyan-300 flex items-center gap-1 font-medium shrink-0"
                    >
                      Gazette / Proof <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
