import React, { useState, useEffect } from 'react';
import { Database, ShieldCheck, ExternalLink, Activity, Server, FileText } from 'lucide-react';
import { DataSourceProvenance } from '../../lib/types';
import { CalibrationEvidence } from '../../lib/calibration';
import { SystemHealthStatus } from '../../lib/provenance';
import { api } from '../../services/api';

export const SystemHealthView: React.FC = () => {
  const [provenance, setProvenance] = useState<DataSourceProvenance[]>([]);
  const [calibrationEvidence, setCalibrationEvidence] = useState<CalibrationEvidence[]>([]);
  const [health, setHealth] = useState<SystemHealthStatus | null>(null);

  useEffect(() => {
    api.getProvenance().then((res) => setProvenance(res.sources)).catch(console.error);
    api.getCalibrationEvidence().then((res) => setCalibrationEvidence(res.evidence)).catch(console.error);
    api.getHealth().then(setHealth).catch(console.error);
  }, []);

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
        <h2 className="text-base font-bold text-white flex items-center gap-2">
          <Database className="w-4 h-4 text-cyan-400" />
          Data Provenance, Quality Assurance & System Health
        </h2>
        <p className="text-xs text-slate-400 mt-0.5">
          Verifiable Lineage for Every Dataset • Transparent Methodology • Real-Time Pipeline Telemetry
        </p>
      </div>

      {/* Real-Time Health Telemetry Cards */}
      {health && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
            <span className="text-[10px] text-slate-400 font-bold uppercase block mb-1">Overall Status</span>
            <span className="text-sm font-bold text-emerald-400 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              {health.status}
            </span>
          </div>

          <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
            <span className="text-[10px] text-slate-400 font-bold uppercase block mb-1">Forecasting Model</span>
            <span className="text-sm font-bold text-white">
              {health.components.forecastingEngine.status}
            </span>
            <span className="text-[10px] text-slate-500 block">
              {health.components.forecastingEngine.latencyMs}ms latency
            </span>
          </div>

          <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
            <span className="text-[10px] text-slate-400 font-bold uppercase block mb-1">Calibration Coverage</span>
            <span className="text-sm font-bold text-cyan-400">
              {health.components.calibrationRegistry.calibratedZones} / 14 Zones
            </span>
            <span className="text-[10px] text-slate-500 block">100% Grounded</span>
          </div>

          <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
            <span className="text-[10px] text-slate-400 font-bold uppercase block mb-1">Event Registry</span>
            <span className="text-sm font-bold text-purple-400">
              {health.components.eventIntelligence.activeEvents} Verified
            </span>
            <span className="text-[10px] text-slate-500 block">Real Venues</span>
          </div>

          <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
            <span className="text-[10px] text-slate-400 font-bold uppercase block mb-1">Fleet Simulation</span>
            <span className="text-sm font-bold text-emerald-400">
              {health.components.fleetSimulation.totalFleet} Vehicles
            </span>
            <span className="text-[10px] text-slate-500 block">State Engine</span>
          </div>

          <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
            <span className="text-[10px] text-slate-400 font-bold uppercase block mb-1">Platform Uptime</span>
            <span className="text-sm font-bold text-white font-mono">
              {health.uptimeSeconds}s
            </span>
            <span className="text-[10px] text-slate-500 block">Continuous</span>
          </div>
        </div>
      )}

      {/* Data Provenance Lineage Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-sm">
        <div className="p-4 border-b border-slate-800">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            Operational Data Source Lineage & Licensing
          </h3>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-950 text-slate-400 uppercase text-[10px] tracking-wider border-b border-slate-800 font-semibold">
              <tr>
                <th className="py-3 px-4">Dataset ID & Name</th>
                <th className="py-3 px-3">Category</th>
                <th className="py-3 px-3">Official Provider</th>
                <th className="py-3 px-3">Records</th>
                <th className="py-3 px-3">Status</th>
                <th className="py-3 px-4">Usage & Provenance Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {provenance.map((src) => (
                <tr key={src.sourceId} className="hover:bg-slate-800/40 transition">
                  <td className="py-3 px-4">
                    <span className="font-mono text-cyan-400 font-bold text-[10px] block mb-0.5">
                      {src.sourceId}
                    </span>
                    <span className="font-semibold text-white">{src.sourceName}</span>
                  </td>
                  <td className="py-3 px-3 text-slate-400">{src.category}</td>
                  <td className="py-3 px-3 text-slate-300">{src.provider}</td>
                  <td className="py-3 px-3 font-mono text-slate-200">
                    {src.recordCount.toLocaleString()}
                  </td>
                  <td className="py-3 px-3">
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase ${
                        src.qualityStatus === 'VALIDATED'
                          ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                          : 'bg-amber-950 text-amber-400 border border-amber-800'
                      }`}
                    >
                      {src.qualityStatus}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-slate-400 text-[11px] max-w-xs">
                    {src.notes}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Visakhapatnam Calibration Evidence Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-sm">
        <div className="p-4 border-b border-slate-800">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <FileText className="w-4 h-4 text-cyan-400" />
            Visakhapatnam Empirical Calibration Evidence (14 Zones)
          </h3>
        </div>

        <div className="overflow-x-auto max-h-96">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-950 text-slate-400 uppercase text-[10px] tracking-wider sticky top-0 border-b border-slate-800 font-semibold">
              <tr>
                <th className="py-2.5 px-4">Zone ID & Name</th>
                <th className="py-2.5 px-3">Local Evidence Source</th>
                <th className="py-2.5 px-3">Pop. Density</th>
                <th className="py-2.5 px-3">Daily Transit Flow</th>
                <th className="py-2.5 px-3">Calibration Status</th>
                <th className="py-2.5 px-4">Grounding Methodology</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-[11px]">
              {calibrationEvidence.map((cal) => (
                <tr key={cal.zoneId} className="hover:bg-slate-800/40 transition">
                  <td className="py-2.5 px-4 font-semibold text-white">
                    <span className="font-mono text-cyan-400 mr-1.5">{cal.zoneId}</span>
                    {cal.zoneName}
                  </td>
                  <td className="py-2.5 px-3 text-slate-300">{cal.localEvidenceSource}</td>
                  <td className="py-2.5 px-3 font-mono text-slate-300">
                    {cal.populationDensityEst.toLocaleString()} /km²
                  </td>
                  <td className="py-2.5 px-3 font-mono text-slate-300">
                    {cal.transitThroughputDaily.toLocaleString()} pax/day
                  </td>
                  <td className="py-2.5 px-3">
                    <span
                      className={`text-[9.5px] font-bold px-1.5 py-0.5 rounded uppercase ${
                        cal.calibrationStatus === 'VALIDATED'
                          ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                          : 'bg-amber-950 text-amber-400 border border-amber-800'
                      }`}
                    >
                      {cal.calibrationStatus}
                    </span>
                  </td>
                  <td className="py-2.5 px-4 text-slate-400 max-w-sm text-[10.5px]">
                    {cal.methodologyNotes}
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
