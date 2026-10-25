import React, { useState } from 'react';
import {
  MapPin,
  Layers,
  Info,
  Car,
  TrendingUp,
  AlertTriangle,
  Calendar,
  Sparkles,
} from 'lucide-react';
import { ZoneRecord, SupplyDemandAnalysis, EventRecord, VirtualVehicle } from '../../lib/types';
import { calculateHaversineDistance } from '../../lib/zones';
import { RealisticOperationalMap } from '../RealisticOperationalMap';

interface DemandMapViewProps {
  zones: ZoneRecord[];
  supplyDemand: SupplyDemandAnalysis[];
  events: EventRecord[];
  vehicles: VirtualVehicle[];
}

export const DemandMapView: React.FC<DemandMapViewProps> = ({
  zones,
  supplyDemand,
  events,
  vehicles,
}) => {
  const [selectedZoneId, setSelectedZoneId] = useState<string>('VZ-01');
  const [layerMode, setLayerMode] = useState<'demand' | 'fleet' | 'imbalance'>('imbalance');

  const selectedZone = zones.find((z) => z.id === selectedZoneId);
  const selectedAnalysis = supplyDemand.find((s) => s.zoneId === selectedZoneId);
  const zoneVehicles = vehicles.filter((v) => v.zoneId === selectedZoneId);
  const zoneEvents = events.filter((e) => e.associatedZoneId === selectedZoneId);

  return (
    <div className="space-y-6">
      {/* Top Map Controls */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            <Layers className="w-4 h-4 text-cyan-400" />
            Visakhapatnam Spatial Demand & Fleet Coverage
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            14 Authoritative Metropolitan Zones • Calibrated to GVMC Master Mobility Plan
          </p>
        </div>

        {/* Layer Selector */}
        <div className="flex items-center space-x-1 bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs">
          <button
            onClick={() => setLayerMode('imbalance')}
            className={`px-3 py-1.5 rounded-md font-medium transition cursor-pointer ${
              layerMode === 'imbalance'
                ? 'bg-cyan-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Supply-Demand Imbalance
          </button>
          <button
            onClick={() => setLayerMode('demand')}
            className={`px-3 py-1.5 rounded-md font-medium transition cursor-pointer ${
              layerMode === 'demand'
                ? 'bg-cyan-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Demand Intensity
          </button>
          <button
            onClick={() => setLayerMode('fleet')}
            className={`px-3 py-1.5 rounded-md font-medium transition cursor-pointer ${
              layerMode === 'fleet'
                ? 'bg-cyan-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Fleet Availability
          </button>
        </div>
      </div>

      {/* Main Map + Inspector Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Realistic Spatial Map Canvas */}
        <div className="lg:col-span-2">
          <RealisticOperationalMap
            zones={zones}
            supplyDemand={supplyDemand}
            events={events}
            vehicles={vehicles}
            selectedZoneId={selectedZoneId}
            onSelectZone={setSelectedZoneId}
            mapLayer={layerMode}
            onChangeLayer={setLayerMode}
            heightClassName="h-[540px]"
          />
        </div>

        {/* Selected Zone Operational Inspector */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col justify-between">
          {selectedZone ? (
            <div className="space-y-4">
              <div className="border-b border-slate-800 pb-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-mono font-bold text-cyan-400 bg-cyan-950/80 px-2 py-0.5 rounded border border-cyan-800/40">
                    {selectedZone.id}
                  </span>
                  <span className="text-xs text-slate-400">{selectedZone.category}</span>
                </div>
                <h3 className="text-base font-bold text-white">{selectedZone.name}</h3>
                <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                  {selectedZone.description}
                </p>
              </div>

              {/* Real Operational Metrics */}
              {selectedAnalysis && (
                <div className="space-y-2.5 text-xs">
                  <div className="bg-slate-950/60 p-3 rounded-lg border border-slate-800 space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-slate-400">Status Classification:</span>
                      <span
                        className={`font-bold px-2 py-0.5 rounded text-[10px] ${
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

                    <div className="flex justify-between items-center">
                      <span className="text-slate-400">Event-Adjusted Demand:</span>
                      <span className="font-bold text-white">
                        {selectedAnalysis.eventAdjustedDemand} trips/hr
                        {selectedAnalysis.eventAdjustedDemand > selectedAnalysis.baseDemand && (
                          <span className="text-purple-400 ml-1">
                            (+{selectedAnalysis.eventAdjustedDemand - selectedAnalysis.baseDemand} event lift)
                          </span>
                        )}
                      </span>
                    </div>

                    <div className="flex justify-between items-center">
                      <span className="text-slate-400">Available Fleet in Zone:</span>
                      <span className="font-bold text-emerald-400">
                        {selectedAnalysis.availableVehicles} vehicles (of {selectedAnalysis.totalFleetInZone} total)
                      </span>
                    </div>

                    <div className="flex justify-between items-center">
                      <span className="text-slate-400">Hourly Supply Capacity:</span>
                      <span className="font-bold text-slate-200">
                        {selectedAnalysis.hourlySupplyCapacity} trips/hr (@ 2.2 trips/veh/hr)
                      </span>
                    </div>

                    <div className="flex justify-between items-center pt-2 border-t border-slate-800">
                      <span className="text-slate-400">Shortage / Surplus Delta:</span>
                      {selectedAnalysis.unmetDemand > 0 ? (
                        <span className="font-bold text-red-400">
                          -{selectedAnalysis.unmetDemand} trips (DEFICIT)
                        </span>
                      ) : (
                        <span className="font-bold text-emerald-400">
                          +{selectedAnalysis.excessVehicles} vehicles (SURPLUS)
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Active Events in This Zone */}
              {zoneEvents.length > 0 && (
                <div className="bg-purple-950/40 border border-purple-900/50 p-3 rounded-lg text-xs">
                  <div className="flex items-center gap-1.5 text-purple-300 font-bold mb-1">
                    <Calendar className="w-3.5 h-3.5" />
                    <span>Zone Event: {zoneEvents[0].name}</span>
                  </div>
                  <p className="text-[11px] text-purple-200">
                    Venue: {zoneEvents[0].venueName} • Est. {zoneEvents[0].estimatedAttendance !== null && zoneEvents[0].estimatedAttendance !== undefined ? zoneEvents[0].estimatedAttendance.toLocaleString() : 'Unknown'} crowd
                  </p>
                </div>
              )}

              {/* Geographic Metadata */}
              <div className="text-[11px] text-slate-400 space-y-1 bg-slate-950/40 p-2.5 rounded border border-slate-800/80">
                <div className="flex justify-between">
                  <span>Centroid:</span>
                  <span className="font-mono text-slate-300">
                    {selectedZone.centroid.lat}°N, {selectedZone.centroid.lng}°E
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Zone Surface Area:</span>
                  <span className="text-slate-300">{selectedZone.areaKm2} km²</span>
                </div>
                <div className="flex justify-between">
                  <span>Activity Density Score:</span>
                  <span className="text-slate-300">{selectedZone.activityDensityScore} / 1.0</span>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-xs text-slate-400 text-center py-10">Select a zone to view details.</p>
          )}

          <div className="mt-4 pt-3 border-t border-slate-800 text-[11px] text-slate-400 flex items-center justify-between">
            <span>Coordinate System: WGS84</span>
            <span className="text-cyan-400">GVMC Boundary Match</span>
          </div>
        </div>
      </div>
    </div>
  );
};
