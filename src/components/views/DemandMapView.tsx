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

  // Geographic bounding box for Visakhapatnam GVMC limits
  // Lat: 17.63 (South, Steel Plant) to 17.85 (North, Pendurthi/Madhurawada)
  // Lng: 83.13 (West, Kurmannapalem) to 83.41 (East, Rushikonda)
  const minLat = 17.63;
  const maxLat = 17.85;
  const minLng = 83.13;
  const maxLng = 83.41;

  const svgWidth = 840;
  const svgHeight = 560;

  // Convert (lat, lng) to SVG (x, y) coordinates
  const project = (lat: number, lng: number) => {
    const x = ((lng - minLng) / (maxLng - minLng)) * (svgWidth - 80) + 40;
    // Note: latitude increases northwards, SVG y increases downwards
    const y = ((maxLat - lat) / (maxLat - minLat)) * (svgHeight - 80) + 40;
    return { x, y };
  };

  const selectedZone = zones.find((z) => z.id === selectedZoneId);
  const selectedAnalysis = supplyDemand.find((s) => s.zoneId === selectedZoneId);
  const zoneVehicles = vehicles.filter((v) => v.zoneId === selectedZoneId);
  const zoneEvents = events.filter((e) => e.associatedZoneId === selectedZoneId);

  // Determine fill color for each zone polygon based on layerMode
  const getZoneFillColor = (zoneId: string) => {
    const analysis = supplyDemand.find((s) => s.zoneId === zoneId);
    if (!analysis) return '#334155';

    if (layerMode === 'demand') {
      // Demand heat (15 to 70 trips)
      const d = analysis.eventAdjustedDemand;
      if (d > 55) return 'rgba(239, 68, 68, 0.55)'; // red
      if (d > 40) return 'rgba(249, 115, 22, 0.50)'; // orange
      if (d > 25) return 'rgba(234, 179, 8, 0.45)'; // yellow
      return 'rgba(59, 130, 246, 0.35)'; // blue
    } else if (layerMode === 'fleet') {
      // Fleet supply density
      const v = analysis.availableVehicles;
      if (v >= 10) return 'rgba(16, 185, 129, 0.60)'; // emerald
      if (v >= 6) return 'rgba(34, 197, 94, 0.45)';
      if (v >= 3) return 'rgba(234, 179, 8, 0.45)';
      return 'rgba(239, 68, 68, 0.55)';
    } else {
      // Imbalance Severity
      if (analysis.shortageSeverity === 'CRITICAL') return 'rgba(239, 68, 68, 0.65)';
      if (analysis.shortageSeverity === 'MODERATE') return 'rgba(245, 158, 11, 0.55)';
      if (analysis.shortageSeverity === 'SURPLUS') return 'rgba(16, 185, 129, 0.55)';
      return 'rgba(59, 130, 246, 0.40)'; // balanced
    }
  };

  const getZoneStrokeColor = (zoneId: string) => {
    if (zoneId === selectedZoneId) return '#38bdf8'; // bright cyan highlight
    const analysis = supplyDemand.find((s) => s.zoneId === zoneId);
    if (analysis?.shortageSeverity === 'CRITICAL') return '#ef4444';
    if (analysis?.shortageSeverity === 'SURPLUS') return '#10b981';
    return '#64748b';
  };

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
        {/* SVG Spatial Canvas */}
        <div className="lg:col-span-2 bg-slate-950 border border-slate-800 rounded-xl p-4 relative overflow-hidden flex flex-col justify-between shadow-inner">
          {/* Map Header Overlay */}
          <div className="absolute top-4 left-4 z-10 bg-slate-900/90 backdrop-blur border border-slate-800 px-3 py-2 rounded-lg text-xs text-slate-300">
            <div className="font-semibold text-white flex items-center gap-1.5">
              <span>Bay of Bengal Coastal Sector</span>
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">
              Click any zone polygon to inspect operational parameters
            </div>
          </div>

          {/* Map Legend */}
          <div className="absolute bottom-4 left-4 z-10 bg-slate-900/90 backdrop-blur border border-slate-800 p-2.5 rounded-lg text-[11px] text-slate-300 space-y-1">
            <span className="font-bold text-white text-[10px] uppercase block mb-1">
              {layerMode === 'imbalance' ? 'Imbalance Key' : layerMode === 'demand' ? 'Demand Heat' : 'Fleet Supply'}
            </span>
            {layerMode === 'imbalance' && (
              <>
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-sm bg-red-500/80 border border-red-400" />
                  <span>Critical Deficit (Shortage)</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-sm bg-amber-500/80 border border-amber-400" />
                  <span>Moderate Deficit</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-sm bg-emerald-500/80 border border-emerald-400" />
                  <span>Surplus Idle Reserves</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-sm bg-blue-500/60 border border-blue-400" />
                  <span>Balanced Fleet</span>
                </div>
              </>
            )}
            {layerMode === 'demand' && (
              <>
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-sm bg-red-500/80" />
                  <span>&gt; 55 trips/hr</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-sm bg-orange-500/80" />
                  <span>40 - 55 trips/hr</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-sm bg-amber-500/80" />
                  <span>25 - 40 trips/hr</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-sm bg-blue-500/60" />
                  <span>&lt; 25 trips/hr</span>
                </div>
              </>
            )}
            {layerMode === 'fleet' && (
              <>
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-sm bg-emerald-500/80" />
                  <span>&ge; 10 Available</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-sm bg-green-500/70" />
                  <span>6 - 9 Available</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-sm bg-amber-500/80" />
                  <span>3 - 5 Available</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-sm bg-red-500/80" />
                  <span>&lt; 3 Available</span>
                </div>
              </>
            )}
          </div>

          {/* SVG Map Canvas */}
          <svg
            viewBox={`0 0 ${svgWidth} ${svgHeight}`}
            className="w-full h-auto max-h-[580px] select-none"
          >
            {/* Background Map Styling: Ocean Coastline */}
            <path
              d="M 520,0 Q 640,160 610,320 T 780,560 L 840,560 L 840,0 Z"
              fill="#082f49"
              opacity="0.35"
            />
            <text
              x={svgWidth - 110}
              y={svgHeight / 2}
              fill="#0284c7"
              fontSize="12"
              fontWeight="bold"
              letterSpacing="2"
              opacity="0.5"
              transform={`rotate(75, ${svgWidth - 110}, ${svgHeight / 2})`}
            >
              BAY OF BENGAL
            </text>

            {/* Render Zone Polygons */}
            {zones.map((zone) => {
              const points = zone.boundary
                .map((coord) => {
                  const p = project(coord.lat, coord.lng);
                  return `${p.x},${p.y}`;
                })
                .join(' ');

              const centroidPoint = project(zone.centroid.lat, zone.centroid.lng);
              const isSelected = zone.id === selectedZoneId;
              const analysis = supplyDemand.find((s) => s.zoneId === zone.id);

              return (
                <g key={zone.id} className="cursor-pointer">
                  {/* Zone Boundary Polygon */}
                  <polygon
                    points={points}
                    fill={getZoneFillColor(zone.id)}
                    stroke={getZoneStrokeColor(zone.id)}
                    strokeWidth={isSelected ? 3 : 1.5}
                    strokeDasharray={isSelected ? undefined : '2,2'}
                    className="transition-all duration-200 hover:opacity-90"
                    onClick={() => setSelectedZoneId(zone.id)}
                  />

                  {/* Centroid Circle */}
                  <circle
                    cx={centroidPoint.x}
                    cy={centroidPoint.y}
                    r={isSelected ? 7 : 5}
                    fill={isSelected ? '#38bdf8' : '#ffffff'}
                    stroke="#0f172a"
                    strokeWidth={2}
                    onClick={() => setSelectedZoneId(zone.id)}
                  />

                  {/* Zone Label */}
                  <text
                    x={centroidPoint.x}
                    y={centroidPoint.y - 10}
                    textAnchor="middle"
                    fill="#f8fafc"
                    fontSize="11"
                    fontWeight="bold"
                    className="pointer-events-none drop-shadow-md"
                  >
                    {zone.id}
                  </text>

                  {/* Available Fleet Count Badge */}
                  {analysis && (
                    <text
                      x={centroidPoint.x}
                      y={centroidPoint.y + 16}
                      textAnchor="middle"
                      fill="#94a3b8"
                      fontSize="9.5"
                      fontWeight="600"
                      className="pointer-events-none drop-shadow"
                    >
                      {analysis.availableVehicles} veh • {analysis.eventAdjustedDemand}/hr
                    </text>
                  )}
                </g>
              );
            })}

            {/* Event Markers Overlay */}
            {events.filter((evt) => evt.latitude !== null && evt.longitude !== null).map((evt) => {
              const p = project(evt.latitude!, evt.longitude!);
              return (
                <g key={evt.id} className="pointer-events-none">
                  {/* Pulse Ring */}
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={14}
                    fill="none"
                    stroke="#c084fc"
                    strokeWidth={1.5}
                    strokeDasharray="3,3"
                    className="animate-pulse"
                  />
                  {/* Event Pin Icon */}
                  <circle cx={p.x} cy={p.y} r={6} fill="#a855f7" stroke="#ffffff" strokeWidth={1.5} />
                  <text
                    x={p.x}
                    y={p.y - 12}
                    textAnchor="middle"
                    fill="#e9d5ff"
                    fontSize="9"
                    fontWeight="bold"
                    className="drop-shadow-lg"
                  >
                    ★ {evt.name.split(':')[0].slice(0, 18)}
                  </text>
                </g>
              );
            })}
          </svg>
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
