/// <reference types="@types/google.maps" />
import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import {
  APIProvider,
  Map as GoogleMap,
  AdvancedMarker,
  InfoWindow,
  useMap,
  useMapsLibrary,
} from '@vis.gl/react-google-maps';
import {
  Layers,
  MapPin,
  Maximize2,
  Navigation,
  Car,
  TrendingUp,
  AlertTriangle,
  Sparkles,
  Search,
  BatteryMedium,
  Zap,
  Info,
  Clock,
  Compass,
} from 'lucide-react';
import {
  ZoneRecord,
  SupplyDemandAnalysis,
  EventRecord,
  DriverRecommendation,
  VirtualVehicle,
} from '../lib/types';

export type MapThemeMode = 'dark' | 'roadmap' | 'satellite';
export type VehicleFilterMode = 'all' | 'en_route' | 'available' | 'none';

export interface LocalizedVehicle extends VirtualVehicle {
  computedPosition: google.maps.LatLngLiteral;
}

export interface GoogleOperationalMapProps {
  zones: ZoneRecord[];
  supplyDemand: SupplyDemandAnalysis[];
  events: EventRecord[];
  vehicles?: VirtualVehicle[];
  activeDispatches?: DriverRecommendation[];
  selectedZoneId: string;
  onSelectZone: (zoneId: string) => void;
  mapLayer: 'imbalance' | 'demand' | 'fleet';
  onChangeLayer?: (layer: 'imbalance' | 'demand' | 'fleet') => void;
  heightClassName?: string;
}

// Visakhapatnam metropolitan coordinates
const VIZAG_METRO_CENTER: google.maps.LatLngLiteral = { lat: 17.729, lng: 83.295 };
const VIZAG_DEFAULT_ZOOM = 12;

// Custom Dark Navy Map Style matching ViziMove AI Dashboard
const DARK_NAVY_MAP_STYLES: google.maps.MapTypeStyle[] = [
  { elementType: 'geometry', stylers: [{ color: '#090d16' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#020617' }, { weight: 3 }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#94a3b8' }] },
  {
    featureType: 'administrative.locality',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#38bdf8' }, { weight: 1.5 }],
  },
  {
    featureType: 'poi',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#64748b' }],
  },
  {
    featureType: 'poi.park',
    elementType: 'geometry',
    stylers: [{ color: '#0c1a24' }],
  },
  {
    featureType: 'road',
    elementType: 'geometry',
    stylers: [{ color: '#1e293b' }],
  },
  {
    featureType: 'road',
    elementType: 'geometry.stroke',
    stylers: [{ color: '#0f172a' }],
  },
  {
    featureType: 'road.highway',
    elementType: 'geometry',
    stylers: [{ color: '#0284c7' }],
  },
  {
    featureType: 'road.highway',
    elementType: 'geometry.stroke',
    stylers: [{ color: '#0369a1' }],
  },
  {
    featureType: 'road.highway',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#f0f9ff' }],
  },
  {
    featureType: 'transit',
    elementType: 'geometry',
    stylers: [{ color: '#162238' }],
  },
  {
    featureType: 'transit.station',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#38bdf8' }],
  },
  {
    featureType: 'water',
    elementType: 'geometry',
    stylers: [{ color: '#020817' }],
  },
  {
    featureType: 'water',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#0284c7' }],
  },
];

/**
 * Deterministically distributes non-moving vehicles near zone centroid to avoid single-point overlap
 */
function getDeterministicZoneOffset(vehicleId: string, index: number, total: number) {
  let hash = 0;
  for (let i = 0; i < vehicleId.length; i++) {
    hash = (hash << 5) - hash + vehicleId.charCodeAt(i);
    hash |= 0;
  }
  const angle = (index / Math.max(1, total)) * 2 * Math.PI + (Math.abs(hash) % 100) / 100;
  const radius = 0.003 + (Math.abs(hash) % 50) * 0.0001; // ~300-800m
  return {
    dLat: Math.sin(angle) * radius,
    dLng: Math.cos(angle) * radius,
  };
}

/**
 * Manages Google Maps Polygons for the 30 operational zones
 */
function ZonePolygonsLayer({
  zones,
  selectedZoneId,
  onSelectZone,
  getZoneColor,
  mapTheme,
}: {
  zones: ZoneRecord[];
  selectedZoneId: string;
  onSelectZone: (zoneId: string) => void;
  getZoneColor: (zoneId: string) => string;
  mapTheme: MapThemeMode;
}) {
  const map = useMap();
  const mapsLib = useMapsLibrary('maps');
  const polygonsRef = useRef<Map<string, google.maps.Polygon>>(new Map());

  useEffect(() => {
    if (!map || !mapsLib) return;

    const currentPolygons = polygonsRef.current;

    // Create or update polygons
    zones.forEach((zone) => {
      if (!zone.boundary || zone.boundary.length === 0) return;

      const isSelected = zone.id === selectedZoneId;
      const color = getZoneColor(zone.id);
      const strokeOpacity = isSelected ? 1.0 : 0.75;
      const fillOpacity = isSelected ? 0.45 : mapTheme === 'dark' ? 0.22 : 0.18;
      const strokeWeight = isSelected ? 3.5 : 1.8;

      let polygon = currentPolygons.get(zone.id);

      if (!polygon) {
        polygon = new mapsLib.Polygon({
          paths: zone.boundary,
          strokeColor: color,
          strokeOpacity,
          strokeWeight,
          fillColor: color,
          fillOpacity,
          clickable: true,
          zIndex: isSelected ? 50 : 10,
        });

        polygon.addListener('click', () => {
          onSelectZone(zone.id);
        });

        polygon.setMap(map);
        currentPolygons.set(zone.id, polygon);
      } else {
        polygon.setOptions({
          paths: zone.boundary,
          strokeColor: isSelected ? '#38bdf8' : color,
          strokeOpacity,
          strokeWeight,
          fillColor: color,
          fillOpacity,
          zIndex: isSelected ? 50 : 10,
        });
      }
    });

    // Cleanup zones that no longer exist
    currentPolygons.forEach((polygon, zoneId) => {
      if (!zones.some((z) => z.id === zoneId)) {
        polygon.setMap(null);
        currentPolygons.delete(zoneId);
      }
    });

    return () => {
      currentPolygons.forEach((p) => p.setMap(null));
      currentPolygons.clear();
    };
  }, [map, mapsLib, zones, selectedZoneId, getZoneColor, mapTheme, onSelectZone]);

  return null;
}

/**
 * Computes and renders genuine Google road routes for active vehicle dispatches
 */
function RoutesLayer({
  activeDispatches,
  zones,
  onSelectRoute,
}: {
  activeDispatches: DriverRecommendation[];
  zones: ZoneRecord[];
  onSelectRoute: (dispatch: DriverRecommendation, routeInfo?: { distanceKm?: number; durationMin?: number }) => void;
}) {
  const map = useMap();
  const routesLib = useMapsLibrary('routes');
  const mapsLib = useMapsLibrary('maps');
  const polylinesRef = useRef<google.maps.Polyline[]>([]);

  useEffect(() => {
    if (!map || !mapsLib) return;

    // Clear previous polylines
    polylinesRef.current.forEach((p) => p.setMap(null));
    polylinesRef.current = [];

    if (!activeDispatches || activeDispatches.length === 0) return;

    activeDispatches.forEach(async (dispatch) => {
      const sourceZone = zones.find((z) => z.id === dispatch.sourceZoneId);
      const targetZone = zones.find((z) => z.id === dispatch.targetZoneId);
      if (!sourceZone || !targetZone) return;

      const origin: google.maps.LatLngLiteral = { lat: sourceZone.centroid.lat, lng: sourceZone.centroid.lng };
      const destination: google.maps.LatLngLiteral = { lat: targetZone.centroid.lat, lng: targetZone.centroid.lng };

      let renderedPath: google.maps.LatLngLiteral[] = [origin, destination];

      // Attempt client-side Routes API computeRoutes if available
      if (routesLib && (routesLib as any).Route?.computeRoutes) {
        try {
          const result = await (routesLib as any).Route.computeRoutes({
            origin: { location: { latLng: origin } },
            destination: { location: { latLng: destination } },
            travelMode: 'DRIVING',
            fields: ['path', 'distanceMeters', 'durationMillis'],
          });

          if (result?.routes?.[0]?.path) {
            renderedPath = result.routes[0].path;
          }
        } catch {
          // Graceful fallback to geodesic corridor
        }
      }

      // Draw distinctive styled route polyline
      const line = new mapsLib.Polyline({
        path: renderedPath,
        geodesic: true,
        strokeColor: '#38bdf8',
        strokeOpacity: 0.9,
        strokeWeight: 4,
        zIndex: 60,
        icons: [
          {
            icon: {
              path: 'M 0,-1 0,1',
              strokeOpacity: 1,
              scale: 3,
            },
            offset: '0',
            repeat: '16px',
          },
        ],
      });

      line.addListener('click', () => {
        onSelectRoute(dispatch);
      });

      line.setMap(map);
      polylinesRef.current.push(line);
    });

    return () => {
      polylinesRef.current.forEach((p) => p.setMap(null));
      polylinesRef.current = [];
    };
  }, [map, routesLib, mapsLib, activeDispatches, zones, onSelectRoute]);

  return null;
}

/**
 * Controller to handle programmatic camera pan/zoom
 */
function MapCameraHandler({
  targetCenter,
  targetZoom,
}: {
  targetCenter: google.maps.LatLngLiteral | null;
  targetZoom: number | null;
}) {
  const map = useMap();

  useEffect(() => {
    if (!map || !targetCenter) return;
    map.panTo(targetCenter);
    if (targetZoom !== null) {
      map.setZoom(targetZoom);
    }
  }, [map, targetCenter, targetZoom]);

  return null;
}

export const GoogleOperationalMap: React.FC<GoogleOperationalMapProps> = ({
  zones,
  supplyDemand,
  events,
  vehicles = [],
  activeDispatches = [],
  selectedZoneId,
  onSelectZone,
  mapLayer,
  onChangeLayer,
  heightClassName = 'h-[520px]',
}) => {
  const [mapTheme, setMapTheme] = useState<MapThemeMode>('dark');
  const [showAreaNames, setShowAreaNames] = useState<boolean>(true);
  const [showRoutes, setShowRoutes] = useState<boolean>(true);
  const [showEvents, setShowEvents] = useState<boolean>(true);
  const [vehicleFilter, setVehicleFilter] = useState<VehicleFilterMode>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // InfoWindow State
  const [selectedVehicle, setSelectedVehicle] = useState<LocalizedVehicle | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<EventRecord | null>(null);
  const [selectedDispatchInfo, setSelectedDispatchInfo] = useState<{
    dispatch: DriverRecommendation;
    sourceZone?: ZoneRecord;
    targetZone?: ZoneRecord;
  } | null>(null);

  // Camera animation state
  const [cameraTarget, setCameraTarget] = useState<{
    center: google.maps.LatLngLiteral;
    zoom: number;
  } | null>(null);

  // API Key resolution
  const mapsApiKey = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string) || 'AIzaSyAhsDsfb4gcQg-9i2nA8_c-BmIIlGlx8ok';
  const [apiLoadError, setApiLoadError] = useState<string | null>(null);

  // Zone analysis quick lookup map
  const analysisMap = useMemo(() => {
    const map = new Map<string, SupplyDemandAnalysis>();
    supplyDemand.forEach((item) => map.set(item.zoneId, item));
    return map;
  }, [supplyDemand]);

  // Color helper according to selected layer
  const getZoneColor = useCallback(
    (zoneId: string) => {
      const analysis = analysisMap.get(zoneId);
      if (!analysis) return '#0ea5e9';

      if (mapLayer === 'demand') {
        const d = analysis.eventAdjustedDemand;
        if (d > 55) return '#ef4444'; // Extreme Red
        if (d > 40) return '#f97316'; // High Orange
        if (d > 25) return '#eab308'; // Medium Yellow
        return '#3b82f6'; // Moderate Blue
      } else if (mapLayer === 'fleet') {
        const v = analysis.availableVehicles;
        if (v >= 15) return '#10b981'; // High
        if (v >= 8) return '#22c55e'; // Moderate
        if (v >= 4) return '#eab308'; // Low
        return '#ef4444'; // Severe
      } else {
        // Imbalance mode
        if (analysis.shortageSeverity === 'CRITICAL') return '#ef4444';
        if (analysis.shortageSeverity === 'MODERATE') return '#f59e0b';
        if (analysis.shortageSeverity === 'SURPLUS') return '#10b981';
        return '#0284c7';
      }
    },
    [analysisMap, mapLayer]
  );

  // Filtered vehicles with exact geographic locations
  const localizedVehicles: LocalizedVehicle[] = useMemo(() => {
    if (vehicleFilter === 'none' || vehicles.length === 0) return [];

    let filtered = vehicles;
    if (vehicleFilter === 'en_route') {
      filtered = vehicles.filter((v) => v.state === 'EN_ROUTE');
    } else if (vehicleFilter === 'available') {
      filtered = vehicles.filter((v) => v.state === 'AVAILABLE');
    }

    // Limit to 120 most relevant markers for smooth UI performance
    const sampled = filtered.slice(0, 120);

    return sampled.map((vehicle, idx) => {
      let position: google.maps.LatLngLiteral;
      const homeZone = zones.find((z) => z.id === vehicle.zoneId);

      if (vehicle.state === 'EN_ROUTE' && vehicle.targetZoneId) {
        const targetZone = zones.find((z) => z.id === vehicle.targetZoneId);
        if (homeZone && targetZone) {
          const progress = (vehicle.movementProgressPct ?? 50) / 100;
          position = {
            lat: homeZone.centroid.lat + (targetZone.centroid.lat - homeZone.centroid.lat) * progress,
            lng: homeZone.centroid.lng + (targetZone.centroid.lng - homeZone.centroid.lng) * progress,
          };
        } else if (homeZone) {
          position = { lat: homeZone.centroid.lat, lng: homeZone.centroid.lng };
        } else {
          position = VIZAG_METRO_CENTER;
        }
      } else if (homeZone) {
        const offset = getDeterministicZoneOffset(vehicle.id, idx, sampled.length);
        position = {
          lat: homeZone.centroid.lat + offset.dLat,
          lng: homeZone.centroid.lng + offset.dLng,
        };
      } else {
        position = VIZAG_METRO_CENTER;
      }

      return {
        ...vehicle,
        computedPosition: position,
      };
    });
  }, [vehicles, vehicleFilter, zones]);

  // Handle Search Jump
  const filteredZones = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase();
    return zones
      .filter(
        (z) =>
          z.name.toLowerCase().includes(q) ||
          z.id.toLowerCase().includes(q) ||
          z.category.toLowerCase().includes(q)
      )
      .slice(0, 6);
  }, [searchQuery, zones]);

  const handlePanToZone = (zoneId: string) => {
    onSelectZone(zoneId);
    const target = zones.find((z) => z.id === zoneId);
    if (target) {
      setCameraTarget({
        center: { lat: target.centroid.lat, lng: target.centroid.lng },
        zoom: 14,
      });
    }
  };

  const handleResetVizagExtent = () => {
    setCameraTarget({
      center: VIZAG_METRO_CENTER,
      zoom: VIZAG_DEFAULT_ZOOM,
    });
  };

  return (
    <div className="relative rounded-xl overflow-hidden border border-slate-800 bg-slate-950 shadow-inner flex flex-col">
      {/* Top Map Control Bar */}
      <div className="bg-slate-900/95 backdrop-blur-md border-b border-slate-800 px-3 py-2 flex flex-wrap items-center justify-between gap-2.5 z-20">
        {/* Left: Map Mode & Base Theme Selectors */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center space-x-1 bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs">
            <button
              type="button"
              onClick={() => setMapTheme('dark')}
              className={`px-2.5 py-1 rounded text-xs font-medium transition cursor-pointer ${
                mapTheme === 'dark'
                  ? 'bg-cyan-600 text-white font-semibold shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Dark Navy
            </button>
            <button
              type="button"
              onClick={() => setMapTheme('roadmap')}
              className={`px-2.5 py-1 rounded text-xs font-medium transition cursor-pointer ${
                mapTheme === 'roadmap'
                  ? 'bg-cyan-600 text-white font-semibold shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Realistic Streets
            </button>
            <button
              type="button"
              onClick={() => setMapTheme('satellite')}
              className={`px-2.5 py-1 rounded text-xs font-medium transition cursor-pointer ${
                mapTheme === 'satellite'
                  ? 'bg-cyan-600 text-white font-semibold shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Satellite
            </button>
          </div>

          {/* Layer switcher */}
          {onChangeLayer && (
            <div className="flex items-center space-x-1 bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs">
              <button
                type="button"
                onClick={() => onChangeLayer('imbalance')}
                className={`px-2.5 py-1 rounded text-xs font-medium transition cursor-pointer ${
                  mapLayer === 'imbalance'
                    ? 'bg-cyan-700 text-white font-semibold shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Imbalance
              </button>
              <button
                type="button"
                onClick={() => onChangeLayer('demand')}
                className={`px-2.5 py-1 rounded text-xs font-medium transition cursor-pointer ${
                  mapLayer === 'demand'
                    ? 'bg-cyan-700 text-white font-semibold shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Demand Heat
              </button>
              <button
                type="button"
                onClick={() => onChangeLayer('fleet')}
                className={`px-2.5 py-1 rounded text-xs font-medium transition cursor-pointer ${
                  mapLayer === 'fleet'
                    ? 'bg-cyan-700 text-white font-semibold shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Fleet Supply
              </button>
            </div>
          )}
        </div>

        {/* Right: Area Search + Toggles + Reset Button */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Quick Area Jump Search */}
          <div className="relative">
            <div className="flex items-center bg-slate-950 border border-slate-800 rounded-md px-2 py-1 text-xs text-slate-300">
              <Search className="w-3.5 h-3.5 text-slate-400 mr-1.5" />
              <input
                type="text"
                placeholder="Jump to area (e.g. Beach, MVP)..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="bg-transparent border-none text-xs text-white placeholder-slate-500 focus:outline-none w-36 sm:w-44"
              />
            </div>

            {filteredZones.length > 0 && (
              <div className="absolute top-full left-0 mt-1 w-56 bg-slate-900 border border-slate-700 rounded-lg shadow-2xl py-1 z-30 max-h-56 overflow-y-auto">
                {filteredZones.map((z) => (
                  <button
                    key={z.id}
                    type="button"
                    onClick={() => {
                      handlePanToZone(z.id);
                      setSearchQuery('');
                    }}
                    className="w-full text-left px-3 py-1.5 hover:bg-cyan-950 hover:text-cyan-300 text-xs text-slate-200 flex items-center justify-between transition cursor-pointer"
                  >
                    <span className="truncate">{z.name}</span>
                    <span className="font-mono text-[10px] text-cyan-400 ml-2 shrink-0">
                      {z.id}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Area Names Toggle */}
          <button
            type="button"
            onClick={() => setShowAreaNames((prev) => !prev)}
            className={`px-2.5 py-1 rounded text-xs font-medium border transition cursor-pointer ${
              showAreaNames
                ? 'bg-slate-800 border-cyan-500/50 text-cyan-300'
                : 'bg-slate-950 border-slate-800 text-slate-500'
            }`}
            title="Toggle area name labels on map"
          >
            Area Names
          </button>

          {/* Vehicles Toggle */}
          <button
            type="button"
            onClick={() =>
              setVehicleFilter((prev) =>
                prev === 'all' ? 'en_route' : prev === 'en_route' ? 'available' : prev === 'available' ? 'none' : 'all'
              )
            }
            className={`px-2.5 py-1 rounded text-xs font-medium border transition cursor-pointer flex items-center gap-1 ${
              vehicleFilter !== 'none'
                ? 'bg-slate-800 border-cyan-500/50 text-cyan-300'
                : 'bg-slate-950 border-slate-800 text-slate-500'
            }`}
            title="Cycle vehicle pins: All -> En Route -> Available -> None"
          >
            <Car className="w-3 h-3" />
            <span className="capitalize">{vehicleFilter === 'en_route' ? 'En-Route' : vehicleFilter}</span>
          </button>

          {/* Routes Toggle */}
          <button
            type="button"
            onClick={() => setShowRoutes((prev) => !prev)}
            className={`px-2.5 py-1 rounded text-xs font-medium border transition cursor-pointer ${
              showRoutes
                ? 'bg-slate-800 border-cyan-500/50 text-cyan-300'
                : 'bg-slate-950 border-slate-800 text-slate-500'
            }`}
            title="Toggle active repositioning routes"
          >
            Routes
          </button>

          {/* Reset Extent */}
          <button
            type="button"
            onClick={handleResetVizagExtent}
            className="p-1.5 bg-slate-950 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-800 rounded text-xs transition cursor-pointer flex items-center gap-1"
            title="Fit Visakhapatnam Metropolitan Extent"
          >
            <Maximize2 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline text-[11px]">Vizag Extent</span>
          </button>
        </div>
      </div>

      {/* Main Interactive Google Map Viewport */}
      <div className={`w-full relative ${heightClassName} min-h-[480px]`}>
        <APIProvider apiKey={mapsApiKey} onError={(err) => setApiLoadError(String(err))}>
          <GoogleMap
            defaultCenter={VIZAG_METRO_CENTER}
            defaultZoom={VIZAG_DEFAULT_ZOOM}
            mapId="DEMO_MAP_ID"
            internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
            mapTypeId={mapTheme === 'satellite' ? 'hybrid' : 'roadmap'}
            styles={mapTheme === 'dark' ? DARK_NAVY_MAP_STYLES : undefined}
            disableDefaultUI={false}
            zoomControl={true}
            streetViewControl={false}
            mapTypeControl={false}
            fullscreenControl={false}
            gestureHandling="greedy"
            className="w-full h-full"
          >
            {/* Camera pan/zoom sync */}
            <MapCameraHandler
              targetCenter={cameraTarget?.center ?? null}
              targetZoom={cameraTarget?.zoom ?? null}
            />

            {/* 1. Zone Polygons */}
            <ZonePolygonsLayer
              zones={zones}
              selectedZoneId={selectedZoneId}
              onSelectZone={onSelectZone}
              getZoneColor={getZoneColor}
              mapTheme={mapTheme}
            />

            {/* 2. Active Repositioning Routes */}
            {showRoutes && (
              <RoutesLayer
                activeDispatches={activeDispatches}
                zones={zones}
                onSelectRoute={(dispatch) => {
                  const s = zones.find((z) => z.id === dispatch.sourceZoneId);
                  const t = zones.find((z) => z.id === dispatch.targetZoneId);
                  setSelectedDispatchInfo({ dispatch, sourceZone: s, targetZone: t });
                }}
              />
            )}

            {/* 3. Zone Centroid Badges & Area Names */}
            {showAreaNames &&
              zones.map((zone) => {
                if (!zone.centroid) return null;
                const isSelected = zone.id === selectedZoneId;
                const color = getZoneColor(zone.id);
                const analysis = analysisMap.get(zone.id);
                const areaName = zone.name.split('/')[0].trim();
                const subName = zone.name.includes('/') ? zone.name.split('/')[1].trim() : '';

                let badgeMetric = '';
                if (mapLayer === 'demand') {
                  badgeMetric = `${analysis?.eventAdjustedDemand ?? 0}/h`;
                } else if (mapLayer === 'fleet') {
                  badgeMetric = `${analysis?.availableVehicles ?? 0} veh`;
                } else {
                  if (analysis && analysis.unmetDemand > 0) {
                    badgeMetric = `-${analysis.unmetDemand}`;
                  } else if (analysis && analysis.excessVehicles > 0) {
                    badgeMetric = `+${analysis.excessVehicles}`;
                  } else {
                    badgeMetric = '0';
                  }
                }

                return (
                  <AdvancedMarker
                    key={`label-${zone.id}`}
                    position={{ lat: zone.centroid.lat, lng: zone.centroid.lng }}
                    onClick={() => onSelectZone(zone.id)}
                    zIndex={isSelected ? 1000 : 80}
                  >
                    <div
                      className={`vizag-area-marker ${isSelected ? 'selected' : ''}`}
                      style={{ '--zone-color': color } as React.CSSProperties}
                    >
                      <div className="marker-card">
                        <div className="marker-header">
                          <span className="marker-id">{zone.id}</span>
                          <span className="marker-metric">{badgeMetric}</span>
                        </div>
                        <div className="marker-title" title={zone.name}>
                          {areaName}
                        </div>
                        {subName && <div className="marker-subtitle">{subName}</div>}
                      </div>
                      <div className="marker-pin-dot" />
                    </div>
                  </AdvancedMarker>
                );
              })}

            {/* 4. Active En-Route Route Midpoint Indicators */}
            {showRoutes &&
              activeDispatches.map((dispatch) => {
                const s = zones.find((z) => z.id === dispatch.sourceZoneId);
                const t = zones.find((z) => z.id === dispatch.targetZoneId);
                if (!s || !t) return null;

                const midLat = (s.centroid.lat + t.centroid.lat) / 2;
                const midLng = (s.centroid.lng + t.centroid.lng) / 2;

                return (
                  <AdvancedMarker
                    key={`route-badge-${dispatch.id}`}
                    position={{ lat: midLat, lng: midLng }}
                    onClick={() => setSelectedDispatchInfo({ dispatch, sourceZone: s, targetZone: t })}
                    zIndex={850}
                  >
                    <div className="vizag-transit-bubble cursor-pointer hover:scale-110 transition shadow-lg">
                      <span className="transit-icon">⚡</span>
                      <span className="transit-badge">{dispatch.recommendedVehicleCount}v en-route</span>
                    </div>
                  </AdvancedMarker>
                );
              })}

            {/* 5. Actual Vehicles (Available & En-Route) */}
            {localizedVehicles.map((vehicle) => {
              const isEnRoute = vehicle.state === 'EN_ROUTE';
              const isAvailable = vehicle.state === 'AVAILABLE';

              return (
                <AdvancedMarker
                  key={`vehicle-${vehicle.id}`}
                  position={vehicle.computedPosition}
                  onClick={() => setSelectedVehicle(vehicle)}
                  zIndex={isEnRoute ? 900 : isAvailable ? 300 : 200}
                >
                  <div
                    className={`p-1 rounded-full cursor-pointer transition shadow-md flex items-center justify-center ${
                      isEnRoute
                        ? 'bg-cyan-500 text-white ring-2 ring-cyan-300 ring-offset-1 ring-offset-slate-900 animate-pulse'
                        : isAvailable
                        ? 'bg-emerald-600 text-white ring-1 ring-emerald-300'
                        : 'bg-amber-600 text-white'
                    }`}
                    title={`${vehicle.id} • ${vehicle.state} • Battery ${vehicle.batteryOrFuelLevel}%`}
                  >
                    <Car className="w-3 h-3" />
                  </div>
                </AdvancedMarker>
              );
            })}

            {/* 6. Active Event Beacons */}
            {showEvents &&
              events
                .filter((e) => e.latitude !== null && e.longitude !== null)
                .map((evt) => (
                  <AdvancedMarker
                    key={`event-${evt.id}`}
                    position={{ lat: evt.latitude!, lng: evt.longitude! }}
                    onClick={() => setSelectedEvent(evt)}
                    zIndex={750}
                  >
                    <div className="vizag-event-pin animate-pulse cursor-pointer hover:scale-105 transition">
                      <div className="event-core">★</div>
                      <div className="event-tag">{evt.name.split(':')[0].slice(0, 16)}</div>
                    </div>
                  </AdvancedMarker>
                ))}

            {/* InfoWindow for Selected Vehicle */}
            {selectedVehicle && (
              <InfoWindow
                position={selectedVehicle.computedPosition}
                onCloseClick={() => setSelectedVehicle(null)}
              >
                <div className="p-2 text-slate-900 max-w-xs space-y-2 font-sans">
                  <div className="flex items-center justify-between border-b pb-1.5">
                    <span className="font-mono font-bold text-xs text-sky-800">
                      {selectedVehicle.id}
                    </span>
                    <span
                      className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase ${
                        selectedVehicle.state === 'EN_ROUTE'
                          ? 'bg-sky-100 text-sky-800'
                          : selectedVehicle.state === 'AVAILABLE'
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      {selectedVehicle.state}
                    </span>
                  </div>

                  <div className="space-y-1 text-xs">
                    <div className="flex justify-between">
                      <span className="text-slate-500">Home/Current Zone:</span>
                      <strong className="text-slate-800 font-mono">{selectedVehicle.zoneId}</strong>
                    </div>

                    <div className="flex justify-between items-center">
                      <span className="text-slate-500">Battery Level:</span>
                      <span className="font-semibold text-emerald-700 flex items-center gap-1">
                        <BatteryMedium className="w-3.5 h-3.5" />
                        {selectedVehicle.batteryOrFuelLevel}%
                      </span>
                    </div>

                    {selectedVehicle.state === 'EN_ROUTE' && (
                      <div className="bg-sky-50 p-2 rounded border border-sky-200 mt-1 space-y-1">
                        <div className="flex justify-between text-[11px]">
                          <span className="text-sky-900 font-semibold">Destination:</span>
                          <span className="text-sky-800 font-bold">{selectedVehicle.targetZoneId}</span>
                        </div>
                        <div className="flex justify-between text-[11px]">
                          <span className="text-slate-600">Transit Progress:</span>
                          <span className="font-mono font-bold text-sky-800">
                            {selectedVehicle.movementProgressPct ?? 50}%
                          </span>
                        </div>
                        <div className="w-full bg-slate-200 rounded-full h-1.5 mt-1 overflow-hidden">
                          <div
                            className="bg-sky-600 h-1.5 rounded-full"
                            style={{ width: `${selectedVehicle.movementProgressPct ?? 50}%` }}
                          />
                        </div>
                      </div>
                    )}

                    <div className="pt-1 border-t text-[10px] text-slate-500 flex justify-between">
                      <span>Telemetry Status:</span>
                      <span className="font-medium text-slate-700">Simulated Fleet Progress</span>
                    </div>
                  </div>
                </div>
              </InfoWindow>
            )}

            {/* InfoWindow for Selected Event */}
            {selectedEvent && selectedEvent.latitude && selectedEvent.longitude && (
              <InfoWindow
                position={{ lat: selectedEvent.latitude, lng: selectedEvent.longitude }}
                onCloseClick={() => setSelectedEvent(null)}
              >
                <div className="p-2 text-slate-900 max-w-xs space-y-1.5 font-sans">
                  <div className="flex items-center gap-1 text-purple-800 font-bold text-xs border-b pb-1">
                    <span>★</span>
                    <span className="truncate">{selectedEvent.name}</span>
                  </div>
                  <div className="text-xs space-y-1">
                    <div className="text-slate-600">
                      Venue: <strong className="text-slate-900">{selectedEvent.venueName}</strong>
                    </div>
                    <div className="text-slate-600">
                      Est. Crowd:{' '}
                      <strong className="text-purple-700">
                        {selectedEvent.estimatedAttendance?.toLocaleString() ?? '10,000+'}
                      </strong>
                    </div>
                    <div className="text-slate-600">
                      Demand Multiplier:{' '}
                      <strong className="text-emerald-700">
                        {selectedEvent.peakDemandMultiplier}x
                      </strong>
                    </div>
                  </div>
                </div>
              </InfoWindow>
            )}

            {/* InfoWindow for Selected Repositioning Dispatch */}
            {selectedDispatchInfo && selectedDispatchInfo.sourceZone && selectedDispatchInfo.targetZone && (
              <InfoWindow
                position={{
                  lat:
                    (selectedDispatchInfo.sourceZone.centroid.lat +
                      selectedDispatchInfo.targetZone.centroid.lat) /
                    2,
                  lng:
                    (selectedDispatchInfo.sourceZone.centroid.lng +
                      selectedDispatchInfo.targetZone.centroid.lng) /
                    2,
                }}
                onCloseClick={() => setSelectedDispatchInfo(null)}
              >
                <div className="p-2 text-slate-900 max-w-xs space-y-2 font-sans text-xs">
                  <div className="flex items-center justify-between border-b pb-1">
                    <span className="font-mono font-bold text-sky-800">
                      {selectedDispatchInfo.dispatch.id}
                    </span>
                    <span className="bg-purple-100 text-purple-800 text-[10px] font-bold px-1.5 py-0.5 rounded">
                      {selectedDispatchInfo.dispatch.priority}
                    </span>
                  </div>

                  <div className="space-y-1">
                    <div className="text-slate-700 font-semibold">
                      {selectedDispatchInfo.sourceZone.name.split('/')[0]} →{' '}
                      <span className="text-sky-700">{selectedDispatchInfo.targetZone.name.split('/')[0]}</span>
                    </div>
                    <p className="text-[11px] text-slate-600 leading-snug">
                      {selectedDispatchInfo.dispatch.reason}
                    </p>
                    <div className="bg-slate-100 p-1.5 rounded flex justify-between text-[11px]">
                      <span>Vehicles: <strong>{selectedDispatchInfo.dispatch.recommendedVehicleCount}</strong></span>
                      <span>ETA: ~<strong>{selectedDispatchInfo.dispatch.estimatedTravelTimeMin}m</strong></span>
                    </div>
                  </div>
                </div>
              </InfoWindow>
            )}
          </GoogleMap>
        </APIProvider>

        {/* Floating Quick Legend in Bottom-Left */}
        <div className="absolute bottom-3 left-3 z-10 bg-slate-900/90 backdrop-blur-md border border-slate-800 p-2.5 rounded-lg text-[11px] text-slate-300 shadow-xl max-w-[220px] space-y-1 pointer-events-auto">
          <span className="font-bold text-white text-[10px] uppercase tracking-wider block mb-1">
            {mapLayer === 'imbalance'
              ? 'Imbalance Legend'
              : mapLayer === 'demand'
              ? 'Demand Heatmap'
              : 'Fleet Availability'}
          </span>
          {mapLayer === 'imbalance' && (
            <>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-red-500 border border-red-400" />
                <span>Critical Deficit (Shortage)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-amber-500 border border-amber-400" />
                <span>Moderate Deficit</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500 border border-emerald-400" />
                <span>Surplus Reserves</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-sky-600 border border-sky-400" />
                <span>Balanced Fleet</span>
              </div>
            </>
          )}
          {mapLayer === 'demand' && (
            <>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-red-500" />
                <span>&gt; 55 trips/hr</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-orange-500" />
                <span>40 - 55 trips/hr</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-amber-500" />
                <span>25 - 40 trips/hr</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-blue-500" />
                <span>&lt; 25 trips/hr</span>
              </div>
            </>
          )}
          {mapLayer === 'fleet' && (
            <>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" />
                <span>&ge; 15 Available</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-green-500" />
                <span>8 - 14 Available</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-amber-500" />
                <span>4 - 7 Available</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-red-500" />
                <span>&lt; 4 Available</span>
              </div>
            </>
          )}
          {activeDispatches.length > 0 && (
            <div className="pt-1 mt-1 border-t border-slate-800 flex items-center gap-1.5 text-cyan-300">
              <span className="w-3 h-0.5 border-t border-dashed border-cyan-400" />
              <span>Active Transit Routes ({activeDispatches.length})</span>
            </div>
          )}
        </div>

        {/* Selected Zone Quick Chip */}
        <div className="absolute top-3 left-3 z-10 bg-slate-900/90 backdrop-blur border border-slate-800 px-3 py-1.5 rounded-lg text-xs text-slate-300 shadow">
          <span className="text-slate-400 text-[10px] uppercase font-semibold">Active Zone: </span>
          <span className="font-bold text-cyan-400 font-mono ml-1">{selectedZoneId}</span>
          <span className="text-white ml-1.5 font-medium">
            {zones.find((z) => z.id === selectedZoneId)?.name}
          </span>
        </div>

        {/* Informative API Key notice if Maps JS API is not active on key */}
        {apiLoadError && (
          <div className="absolute top-3 right-3 z-30 max-w-sm bg-amber-950/95 border border-amber-600 p-3 rounded-lg text-xs text-amber-200 shadow-2xl">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <strong className="text-white block mb-0.5">Google Maps Notice</strong>
                <p className="text-[11px] leading-relaxed">
                  Maps API initialization reported: {apiLoadError}. Ensure &ldquo;Maps JavaScript API&rdquo; and &ldquo;Routes API&rdquo; are enabled in Google Cloud Console.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
