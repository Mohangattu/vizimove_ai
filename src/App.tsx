import React, { useState, useEffect, useCallback } from 'react';
import { Header } from './components/Header';
import { Sidebar, NavTab } from './components/Sidebar';
import { OverviewView } from './components/views/OverviewView';
import { ForecastingView } from './components/views/ForecastingView';
import { EventIntelligenceView } from './components/views/EventIntelligenceView';
import { FleetOperationsView } from './components/views/FleetOperationsView';
import { SupplyDemandView } from './components/views/SupplyDemandView';
import { RecommendationsView } from './components/views/RecommendationsView';
import { DemandMapView } from './components/views/DemandMapView';
import { ModelPerformanceView } from './components/views/ModelPerformanceView';
import { SystemHealthView } from './components/views/SystemHealthView';
import { OperationsQAView } from './components/views/OperationsQAView';

import {
  OperationsSummary,
  SupplyDemandAnalysis,
  DriverRecommendation,
  EventRecord,
  VirtualVehicle,
  ZoneRecord,
} from './lib/types';
import { SystemHealthStatus } from './lib/provenance';
import { api } from './services/api';

export default function App() {
  const [currentTab, setCurrentTab] = useState<NavTab>('dashboard');
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState<boolean>(false);

  // Core application state loaded from genuine API
  const [zones, setZones] = useState<ZoneRecord[]>([]);
  const [operationsSummary, setOperationsSummary] = useState<OperationsSummary | null>(null);
  const [supplyDemand, setSupplyDemand] = useState<SupplyDemandAnalysis[]>([]);
  const [recommendations, setRecommendations] = useState<DriverRecommendation[]>([]);
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [vehicles, setVehicles] = useState<VirtualVehicle[]>([]);
  const [fleetSummary, setFleetSummary] = useState<{
    total: number;
    available: number;
    busy: number;
    enRoute: number;
    offline: number;
    assigned: number;
    utilizationRate: number;
  } | null>(null);
  const [health, setHealth] = useState<SystemHealthStatus | null>(null);

  const loadData = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const [
        zonesData,
        summaryData,
        sdData,
        recsData,
        eventsData,
        fleetData,
        healthData,
      ] = await Promise.all([
        api.getZones(),
        api.getOperationsSummary(),
        api.getSupplyDemand(0, 2.2),
        api.getRecommendations(),
        api.getEvents(),
        api.getFleet(),
        api.getHealth(),
      ]);

      setZones(zonesData);
      setOperationsSummary(summaryData);
      setSupplyDemand(sdData.zones);
      setRecommendations(recsData);
      setEvents(eventsData);
      setVehicles(fleetData.vehicles);
      setFleetSummary(fleetData.summary);
      setHealth(healthData);
    } catch (err) {
      console.error('Failed to load application data:', err);
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    // Auto refresh periodically every 60s
    const timer = setInterval(loadData, 60000);
    return () => clearInterval(timer);
  }, [loadData]);

  const handleDispatchRec = async (id: string) => {
    try {
      await api.dispatchRecommendation(id);
      loadData();
    } catch (err) {
      console.error('Dispatch failed', err);
    }
  };

  const pendingRecsCount = recommendations.filter((r) => r.status === 'PENDING').length;
  const activeEventsCount = events.filter((e) => e.status === 'ACTIVE' || e.status === 'UPCOMING').length;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-cyan-500/30 selection:text-cyan-200">
      {/* Platform Header */}
      <Header
        health={health}
        operationsSummary={operationsSummary}
        onRefresh={loadData}
        isRefreshing={isRefreshing}
        onToggleMobileMenu={() => setIsMobileMenuOpen((prev) => !prev)}
        isMobileMenuOpen={isMobileMenuOpen}
      />

      {/* Main Body with Sidebar Navigation */}
      <div className="flex-1 flex flex-col md:flex-row relative">
        <Sidebar
          currentTab={currentTab}
          onTabChange={setCurrentTab}
          pendingRecsCount={pendingRecsCount}
          activeEventsCount={activeEventsCount}
          isOpenOnMobile={isMobileMenuOpen}
          onCloseMobile={() => setIsMobileMenuOpen(false)}
        />

        {/* Dynamic Viewport Content */}
        <main className="flex-1 p-6 md:p-8 max-w-7xl mx-auto w-full overflow-y-auto">
          {currentTab === 'dashboard' && (
            <OverviewView
              summary={operationsSummary}
              supplyDemand={supplyDemand}
              recommendations={recommendations}
              events={events}
              zones={zones}
              vehicles={vehicles}
              onNavigateTab={setCurrentTab}
              onDispatchRec={handleDispatchRec}
            />
          )}

          {currentTab === 'forecast' && (
            <ForecastingView zones={zones} />
          )}

          {currentTab === 'events' && (
            <EventIntelligenceView
              events={events}
              onRefresh={loadData}
              isRefreshing={isRefreshing}
            />
          )}

          {currentTab === 'fleet' && (
            <FleetOperationsView
              fleetSummary={fleetSummary}
              vehicles={vehicles}
              onRefreshFleet={loadData}
            />
          )}

          {currentTab === 'supply-demand' && (
            <SupplyDemandView supplyDemand={supplyDemand} />
          )}

          {currentTab === 'recommendations' && (
            <RecommendationsView
              recommendations={recommendations}
              onRefreshRecommendations={loadData}
            />
          )}

          {currentTab === 'demand-map' && (
            <DemandMapView
              zones={zones}
              supplyDemand={supplyDemand}
              events={events}
              vehicles={vehicles}
            />
          )}

          {currentTab === 'model-performance' && (
            <ModelPerformanceView />
          )}

          {currentTab === 'system-health' && (
            <SystemHealthView />
          )}

          {currentTab === 'operations-qa' && (
            <OperationsQAView />
          )}
        </main>
      </div>
    </div>
  );
}
