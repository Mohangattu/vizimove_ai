import React from 'react';
import {
  GoogleOperationalMap,
  GoogleOperationalMapProps,
  MapThemeMode,
} from './GoogleOperationalMap';
import {
  ZoneRecord,
  SupplyDemandAnalysis,
  EventRecord,
  DriverRecommendation,
  VirtualVehicle,
} from '../lib/types';

export type MapTileTheme = MapThemeMode;

export interface RealisticOperationalMapProps {
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

export const RealisticOperationalMap: React.FC<RealisticOperationalMapProps> = (props) => {
  return <GoogleOperationalMap {...props} />;
};

export { GoogleOperationalMap };
