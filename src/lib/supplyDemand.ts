/**
 * Supply-Demand Analysis Module
 * Rigorous comparison between calibrated zone demand forecasts and real-time available fleet capacity.
 */

import { SupplyDemandAnalysis, ZoneRecord, Forecast15mRecord, VirtualVehicle } from './types';
import { VIZAG_ZONES } from './zones';
import { forecastDemandForZone } from './forecasting';
import { FleetManager } from './fleet';

export const DEFAULT_TRIPS_PER_VEHICLE_PER_HOUR = 2.2; // ~27 min average cycle time in Vizag traffic
export const TRIPS_PER_VEHICLE_15M = 0.55; // 2.2 / 4 = 0.55 trips/vehicle in a 15-minute interval

/**
 * Computes supply-demand metrics for a specific zone and target time.
 */
export function analyzeZoneSupplyDemand(
  zone: ZoneRecord,
  fleetManager: FleetManager,
  targetTime: Date = new Date(),
  tripsPerVehiclePerHour: number = DEFAULT_TRIPS_PER_VEHICLE_PER_HOUR
): SupplyDemandAnalysis {
  const forecast = forecastDemandForZone(zone, targetTime);
  const vehicles = fleetManager.getVehiclesByZone(zone.id);

  const availableVehicles = vehicles.filter((v) => v.state === 'AVAILABLE').length;
  const busyVehicles = vehicles.filter((v) => v.state === 'BUSY').length;
  const enRouteVehicles = vehicles.filter((v) => v.state === 'EN_ROUTE').length;
  const totalFleetInZone = vehicles.length;

  const hourlySupplyCapacity = Math.round(availableVehicles * tripsPerVehiclePerHour * 10) / 10;
  const demand = forecast.eventAdjustedDemand;

  const unmetDemand = Math.max(0, Math.round(demand - hourlySupplyCapacity));

  const vehiclesNeededForDemand = Math.ceil(demand / tripsPerVehiclePerHour);
  const excessVehicles = Math.max(0, availableVehicles - vehiclesNeededForDemand);

  let demandSupplyRatio = 1.0;
  if (hourlySupplyCapacity > 0) {
    demandSupplyRatio = Math.round((demand / hourlySupplyCapacity) * 100) / 100;
  } else {
    demandSupplyRatio = demand > 0 ? 99.0 : 1.0;
  }

  let shortageSeverity: 'CRITICAL' | 'MODERATE' | 'BALANCED' | 'SURPLUS' = 'BALANCED';
  if (unmetDemand >= 12 || demandSupplyRatio >= 1.6) {
    shortageSeverity = 'CRITICAL';
  } else if (unmetDemand > 0) {
    shortageSeverity = 'MODERATE';
  } else if (excessVehicles >= 4) {
    shortageSeverity = 'SURPLUS';
  }

  return {
    zoneId: zone.id,
    zoneName: zone.name,
    timestamp: targetTime.toISOString(),
    baseDemand: forecast.predictedDemand,
    eventAdjustedDemand: demand,
    availableVehicles,
    busyVehicles,
    enRouteVehicles,
    totalFleetInZone,
    tripsPerVehiclePerHourAssumption: tripsPerVehiclePerHour,
    hourlySupplyCapacity,
    unmetDemand,
    excessVehicles,
    demandSupplyRatio,
    shortageSeverity,
  };
}

/**
 * Computes snapshot across all zones in Visakhapatnam.
 */
export function analyzeAllZonesSupplyDemand(
  fleetManager: FleetManager,
  targetTime: Date = new Date(),
  tripsPerVehiclePerHour: number = DEFAULT_TRIPS_PER_VEHICLE_PER_HOUR
): SupplyDemandAnalysis[] {
  return VIZAG_ZONES.map((zone) =>
    analyzeZoneSupplyDemand(zone, fleetManager, targetTime, tripsPerVehiclePerHour)
  );
}

/**
 * Extracts ranked deficit zones (highest unmet demand first) and surplus zones (highest excess vehicles first).
 */
export function getSupplyDemandRankings(analyses: SupplyDemandAnalysis[]): {
  deficitZones: SupplyDemandAnalysis[];
  surplusZones: SupplyDemandAnalysis[];
} {
  const deficitZones = analyses
    .filter((a) => a.unmetDemand > 0)
    .sort((a, b) => b.unmetDemand - a.unmetDemand);

  const surplusZones = analyses
    .filter((a) => a.excessVehicles > 0)
    .sort((a, b) => b.excessVehicles - a.excessVehicles);

  return { deficitZones, surplusZones };
}

// --- 15-MINUTE SUB-HOURLY SUPPLY-DEMAND CONTRACTS ---

export interface ZoneSupplyDemand15m {
  zoneId: string;
  zoneName: string;
  demand15m: number;
  availableVehicles: number;
  capacity15m: number;
  deficit: number;
  surplus: number;
  neededVehicles: number;
  severity: 'CRITICAL' | 'MODERATE' | 'BALANCED' | 'SURPLUS';
}

/**
 * Computes sub-hourly 15-minute supply-demand comparison for a single zone.
 */
export function calculateZoneSupplyDemand15m(
  zone: ZoneRecord,
  demand15m: number,
  availableVehicles: number,
  tripsPerVehicle15m: number = TRIPS_PER_VEHICLE_15M
): ZoneSupplyDemand15m {
  const capacity15m = Math.round(availableVehicles * tripsPerVehicle15m * 10) / 10;
  const deficit = Math.max(0, Math.round(demand15m - capacity15m));
  const neededVehicles = Math.ceil(demand15m / tripsPerVehicle15m);
  const surplus = Math.max(0, availableVehicles - neededVehicles);

  let severity: 'CRITICAL' | 'MODERATE' | 'BALANCED' | 'SURPLUS' = 'BALANCED';
  if (deficit > 8) {
    severity = 'CRITICAL';
  } else if (deficit > 0) {
    severity = 'MODERATE';
  } else if (surplus >= 6) {
    severity = 'SURPLUS';
  }

  return {
    zoneId: zone.id,
    zoneName: zone.name,
    demand15m,
    availableVehicles,
    capacity15m,
    deficit,
    surplus,
    neededVehicles,
    severity,
  };
}

/**
 * Computes sub-hourly 15-minute supply-demand comparison across all 30 Visakhapatnam zones.
 */
export function calculateAllZonesSupplyDemand15m(
  zones: ZoneRecord[],
  forecastMap: Record<string, Forecast15mRecord[]>,
  availableVehiclesByZone: Record<string, VirtualVehicle[]>,
  tripsPerVehicle15m: number = TRIPS_PER_VEHICLE_15M
): ZoneSupplyDemand15m[] {
  return zones.map((z) => {
    const demand15m = forecastMap[z.id]?.[0]?.eventAdjustedDemand || 0;
    const availableInZone = availableVehiclesByZone[z.id]?.length || 0;
    return calculateZoneSupplyDemand15m(z, demand15m, availableInZone, tripsPerVehicle15m);
  });
}

