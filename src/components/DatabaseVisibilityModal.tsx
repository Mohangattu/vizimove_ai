import React, { useState, useEffect } from 'react';
import {
  Database,
  X,
  Copy,
  Check,
  Terminal,
  ExternalLink,
  Layers,
  Play,
  Table as TableIcon,
  Server,
  FileCode,
} from 'lucide-react';
import { api } from '../services/api';

interface DatabaseVisibilityModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const DatabaseVisibilityModal: React.FC<DatabaseVisibilityModalProps> = ({
  isOpen,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<'queries' | 'connection' | 'inspect'>('queries');
  const [selectedQueryIndex, setSelectedQueryIndex] = useState<number>(0);
  const [copiedQuery, setCopiedQuery] = useState<boolean>(false);
  const [copiedConn, setCopiedConn] = useState<boolean>(false);
  const [dbMeta, setDbMeta] = useState<{
    connection: {
      host: string;
      port: number;
      database: string;
      username: string;
      schema: string;
      clientToolsSupported: string[];
      psqlCommand: string;
    };
    sqlSuite: string;
    tableRegistry: string[];
  } | null>(null);

  // Live Inspection State
  const [selectedTable, setSelectedTable] = useState<string>('pipeline_cycle_runs');
  const [tableData, setTableData] = useState<any[]>([]);
  const [isLoadingTable, setIsLoadingTable] = useState<boolean>(false);

  useEffect(() => {
    if (isOpen) {
      api.getDbQueries()
        .then((data) => setDbMeta(data))
        .catch((err) => console.error('Failed to load db meta', err));
      loadTableData(selectedTable);
    }
  }, [isOpen]);

  const loadTableData = async (table: string) => {
    setIsLoadingTable(true);
    try {
      const data = await api.inspectDbTable(table);
      setTableData(data);
    } catch (e) {
      console.error(e);
      setTableData([]);
    } finally {
      setIsLoadingTable(false);
    }
  };

  const handleTableChange = (table: string) => {
    setSelectedTable(table);
    loadTableData(table);
  };

  const QUERIES_LIST = [
    {
      id: 'zones',
      title: '1. All Configured Geographical Zones',
      description: 'Queries all 30 authentic Visakhapatnam zones, centroids, area, and weights.',
      sql: `SELECT \n    z.id AS zone_id, z.name AS zone_name, z.category, z.area_km2, \n    z.centroid_lat, z.centroid_lng, z.activity_density_score, \n    z.commercial_weight, z.transit_weight, z.tourism_weight\nFROM zones z\nORDER BY z.id ASC;`,
      tableRef: 'zones',
    },
    {
      id: 'forecast_15m',
      title: '2. Latest Demand Forecast per Zone (15-Min & Hourly)',
      description: 'Inspects latest 15-minute sub-hourly predictions, contrasting baseline and event lift.',
      sql: `SELECT \n    df.zone_id, z.name AS zone_name, df.target_interval, df.minute_of_hour, \n    df.baseline_demand AS baseline_15m_demand, df.event_adjusted_demand AS event_adjusted_15m_demand,\n    (df.event_adjusted_demand - df.baseline_demand) AS event_surge_trips,\n    df.confidence_score, df.subhourly_weight, df.model_version\nFROM demand_forecasts_15m df\nJOIN zones z ON df.zone_id = z.id\nWHERE df.target_interval = (SELECT MAX(target_interval) FROM demand_forecasts_15m)\nORDER BY df.event_adjusted_demand DESC;`,
      tableRef: 'demand_forecasts_15m',
    },
    {
      id: 'events',
      title: '3. Upcoming & Currently Active Events',
      description: 'Queries verified Vizag events, venues, attendance, and demand multipliers.',
      sql: `SELECT \n    e.id AS event_id, e.name AS event_name, e.venue_name, e.event_type,\n    e.status, e.start_time, e.end_time, e.estimated_attendance,\n    e.radius_km, e.peak_demand_multiplier, e.source_name\nFROM events e\nWHERE e.status IN ('ACTIVE', 'UPCOMING')\nORDER BY e.start_time ASC;`,
      tableRef: 'events',
    },
    {
      id: 'event_impacts',
      title: '4. Event-to-Zone Associations & Impact Estimates',
      description: 'Shows spatial decay, Haversine distance in km, and sub-hourly demand lift.',
      sql: `SELECT \n    ei.event_id, e.name AS event_name, ei.zone_id, z.name AS zone_name,\n    ei.distance_km, ei.travel_time_min, ei.radius_km, ei.temporal_status,\n    ei.baseline_demand_15m, ei.event_lift_multiplier, ei.event_adjusted_demand_15m,\n    ei.additional_trips_expected, ei.documentation_method\nFROM event_zone_impacts ei\nJOIN events e ON ei.event_id = e.id\nJOIN zones z ON ei.zone_id = z.id\nORDER BY ei.event_lift_multiplier DESC;`,
      tableRef: 'event_zone_impacts',
    },
    {
      id: 'vehicles',
      title: '5. All Configured Fleet Vehicles & Current States',
      description: 'Audits vehicle records, states, battery/fuel %, and assigned recommendation IDs.',
      sql: `SELECT \n    fv.id AS vehicle_id, fv.zone_id, z.name AS zone_name, fv.state,\n    fv.battery_or_fuel_level AS charge_pct, fv.trips_completed_today,\n    fv.reposition_count_today, fv.last_state_change\nFROM fleet_vehicles fv\nJOIN zones z ON fv.zone_id = z.id\nORDER BY fv.id ASC\nLIMIT 100;`,
      tableRef: 'fleet_vehicles',
    },
    {
      id: 'fleet_allocation',
      title: '6. Fleet Allocation Totals by Zone',
      description: 'Summarizes vehicle counts and available/busy breakdowns across 30 zones.',
      sql: `SELECT \n    fv.zone_id, z.name AS zone_name, z.category,\n    COUNT(*) AS total_vehicles,\n    COUNT(*) FILTER (WHERE fv.state = 'AVAILABLE') AS available_count,\n    COUNT(*) FILTER (WHERE fv.state = 'BUSY') AS busy_count,\n    COUNT(*) FILTER (WHERE fv.state = 'EN_ROUTE') AS en_route_count,\n    ROUND(AVG(fv.battery_or_fuel_level), 1) AS avg_battery_fuel_pct\nFROM fleet_vehicles fv\nJOIN zones z ON fv.zone_id = z.id\nGROUP BY fv.zone_id, z.name, z.category\nORDER BY total_vehicles DESC;`,
      tableRef: 'fleet_vehicles',
    },
    {
      id: 'supply_demand',
      title: '7. Latest Supply-Demand Results (15-Min Operational)',
      description: 'Calculates local shortages, deficits, and surpluses with 0.55 trips/veh capacity.',
      sql: `WITH ZoneAvailableFleet AS (\n    SELECT fv.zone_id, COUNT(*) FILTER (WHERE fv.state = 'AVAILABLE') AS available_vehicles\n    FROM fleet_vehicles fv GROUP BY fv.zone_id\n),\nLatest15mForecast AS (\n    SELECT df.zone_id, df.baseline_demand, df.event_adjusted_demand\n    FROM demand_forecasts_15m df\n    WHERE df.target_interval = (SELECT MAX(target_interval) FROM demand_forecasts_15m)\n)\nSELECT \n    z.id AS zone_id, z.name AS zone_name, fc.event_adjusted_demand,\n    COALESCE(fl.available_vehicles, 0) AS available_vehicles,\n    ROUND(COALESCE(fl.available_vehicles, 0) * 0.55, 1) AS capacity_15m,\n    GREATEST(0, ROUND(fc.event_adjusted_demand - (COALESCE(fl.available_vehicles, 0) * 0.55), 1)) AS unmet_deficit\nFROM zones z\nLEFT JOIN Latest15mForecast fc ON z.id = fc.zone_id\nLEFT JOIN ZoneAvailableFleet fl ON z.id = fl.zone_id\nORDER BY unmet_deficit DESC;`,
      tableRef: 'pipeline_cycle_runs',
    },
    {
      id: 'recommendations',
      title: '8. Recent Driver Repositioning Recommendations',
      description: 'Queries generated dispatch directives, priorities, routes, and travel times.',
      sql: `SELECT \n    dr.id AS rec_id, dr.source_zone_id, sz.name AS source_zone, \n    dr.target_zone_id, tz.name AS target_zone, dr.recommended_vehicle_count,\n    dr.priority, dr.status, dr.estimated_travel_distance_km, dr.estimated_travel_time_min,\n    dr.expected_net_trips_served, dr.reason, dr.created_at\nFROM driver_recommendations dr\nJOIN zones sz ON dr.source_zone_id = sz.id\nJOIN zones tz ON dr.target_zone_id = tz.id\nORDER BY dr.created_at DESC\nLIMIT 25;`,
      tableRef: 'driver_recommendations',
    },
    {
      id: 'cycle_runs',
      title: '9. Forecast Run History & Ingestion Failures',
      description: 'Inspects 15-minute pipeline cycle executions, freshness ages, and error logs.',
      sql: `SELECT \n    pcr.run_id, pcr.timestamp, pcr.status, pcr.duration_ms,\n    pcr.zones_forecasted_count, pcr.total_baseline_demand_15m,\n    pcr.total_event_adjusted_demand_15m, pcr.active_events_evaluated,\n    pcr.total_available_fleet, pcr.deficit_zones_count, pcr.recommendations_generated_count,\n    pcr.input_freshness->>'dataFreshnessSeconds' AS data_age_sec, pcr.failures\nFROM pipeline_cycle_runs pcr\nORDER BY pcr.timestamp DESC\nLIMIT 50;`,
      tableRef: 'pipeline_cycle_runs',
    },
  ];

  if (!isOpen) return null;

  const currentQuery = QUERIES_LIST[selectedQueryIndex];

  const copyToClipboard = (text: string, isQuery: boolean) => {
    navigator.clipboard.writeText(text);
    if (isQuery) {
      setCopiedQuery(true);
      setTimeout(() => setCopiedQuery(false), 2000);
    } else {
      setCopiedConn(true);
      setTimeout(() => setCopiedConn(false), 2000);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
      <div className="bg-slate-900 border border-slate-700/80 rounded-xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Modal Header */}
        <div className="px-6 py-4 bg-slate-800/90 border-b border-slate-700 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-cyan-600/20 text-cyan-400 rounded-lg border border-cyan-500/30">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                PostgreSQL Database Visibility & SQL Suite
                <span className="text-xs font-mono font-normal px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800">
                  PostGIS • 30 Zones • 1,200 Vehicles
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                Inspect live relational tables with pgAdmin, DBeaver, or psql CLI
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-700/60 transition cursor-pointer"
            aria-label="Close Database Inspector"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-slate-800 px-6 bg-slate-900/60 text-xs">
          <button
            onClick={() => setActiveTab('queries')}
            className={`py-3 px-4 font-semibold border-b-2 flex items-center gap-2 transition cursor-pointer ${
              activeTab === 'queries'
                ? 'border-cyan-500 text-cyan-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <FileCode className="w-4 h-4" />
            Mandatory SQL Inspection Queries ({QUERIES_LIST.length})
          </button>
          <button
            onClick={() => setActiveTab('inspect')}
            className={`py-3 px-4 font-semibold border-b-2 flex items-center gap-2 transition cursor-pointer ${
              activeTab === 'inspect'
                ? 'border-cyan-500 text-cyan-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <TableIcon className="w-4 h-4" />
            Live Table Data Preview
          </button>
          <button
            onClick={() => setActiveTab('connection')}
            className={`py-3 px-4 font-semibold border-b-2 flex items-center gap-2 transition cursor-pointer ${
              activeTab === 'connection'
                ? 'border-cyan-500 text-cyan-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Server className="w-4 h-4" />
            Client Connection & Config (pgAdmin / DBeaver)
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 text-xs text-slate-200">
          {activeTab === 'queries' && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Left Column: Query Selector */}
              <div className="space-y-1.5 border-r border-slate-800 pr-4">
                <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block mb-2">
                  Select Inspection Query
                </span>
                {QUERIES_LIST.map((q, idx) => (
                  <button
                    key={q.id}
                    onClick={() => setSelectedQueryIndex(idx)}
                    className={`w-full text-left p-2.5 rounded-lg border transition cursor-pointer ${
                      selectedQueryIndex === idx
                        ? 'bg-cyan-950/80 border-cyan-500/80 text-cyan-200 shadow-sm'
                        : 'bg-slate-800/40 border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-800/80'
                    }`}
                  >
                    <span className="font-semibold block">{q.title}</span>
                    <span className="text-[11px] text-slate-400 line-clamp-1 mt-0.5">
                      {q.description}
                    </span>
                  </button>
                ))}
              </div>

              {/* Right Column: SQL Preview & Quick Action */}
              <div className="md:col-span-2 space-y-4">
                <div className="bg-slate-950 border border-slate-800 rounded-lg p-4">
                  <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-3">
                    <div>
                      <h3 className="font-bold text-white text-sm">{currentQuery.title}</h3>
                      <p className="text-slate-400 text-xs">{currentQuery.description}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => copyToClipboard(currentQuery.sql, true)}
                        className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-lg border border-slate-700 flex items-center gap-1.5 transition cursor-pointer"
                      >
                        {copiedQuery ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        {copiedQuery ? 'Copied SQL' : 'Copy SQL'}
                      </button>
                      <button
                        onClick={() => {
                          setSelectedTable(currentQuery.tableRef);
                          setActiveTab('inspect');
                          loadTableData(currentQuery.tableRef);
                        }}
                        className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg flex items-center gap-1.5 transition cursor-pointer font-medium"
                      >
                        <Play className="w-3.5 h-3.5" />
                        Inspect Live Table
                      </button>
                    </div>
                  </div>

                  <pre className="font-mono text-emerald-300 text-xs bg-slate-900/90 p-3.5 rounded border border-slate-800 overflow-x-auto whitespace-pre">
                    {currentQuery.sql}
                  </pre>
                </div>

                <div className="bg-slate-800/40 border border-slate-800 rounded-lg p-3 text-slate-300 text-xs">
                  <span className="font-semibold text-cyan-300 block mb-1">
                    psql Quick Execution:
                  </span>
                  <code className="bg-black/50 px-2 py-1 rounded font-mono text-slate-300 block overflow-x-auto">
                    psql -h localhost -p 5432 -U postgres -d vizimove_db -c "{currentQuery.sql.replace(/\n\s+/g, ' ')}"
                  </code>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'inspect' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-800/60 p-3 rounded-lg border border-slate-700/60">
                <div className="flex items-center gap-2">
                  <span className="text-slate-400 font-medium">Table:</span>
                  <select
                    value={selectedTable}
                    onChange={(e) => handleTableChange(e.target.value)}
                    className="bg-slate-900 border border-slate-700 text-white rounded px-2.5 py-1 text-xs font-semibold cursor-pointer"
                  >
                    <option value="pipeline_cycle_runs">pipeline_cycle_runs (15m Cycles)</option>
                    <option value="demand_forecasts_15m">demand_forecasts_15m (Sub-hourly)</option>
                    <option value="event_zone_impacts">event_zone_impacts (Spatial Decay)</option>
                    <option value="zones">zones (30 GVMC Zones)</option>
                    <option value="events">events (Verified Real Events)</option>
                    <option value="fleet_vehicles">fleet_vehicles (1,200 Virtual Vehicles)</option>
                    <option value="driver_recommendations">driver_recommendations</option>
                    <option value="data_source_provenance">data_source_provenance</option>
                  </select>
                </div>

                <div className="flex items-center gap-3 text-xs text-slate-400">
                  <span>
                    Records: <strong className="text-white">{tableData.length}</strong>
                  </span>
                  <button
                    onClick={() => loadTableData(selectedTable)}
                    disabled={isLoadingTable}
                    className="px-2.5 py-1 bg-slate-700 hover:bg-slate-600 text-white rounded transition cursor-pointer"
                  >
                    {isLoadingTable ? 'Refreshing...' : 'Refresh'}
                  </button>
                </div>
              </div>

              {/* Table Render */}
              <div className="border border-slate-800 rounded-lg overflow-x-auto max-h-96">
                {tableData.length === 0 ? (
                  <div className="p-8 text-center text-slate-500">
                    No records found or table currently refreshing.
                  </div>
                ) : (
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-slate-950 sticky top-0 border-b border-slate-800 text-slate-400 font-mono">
                      <tr>
                        {Object.keys(tableData[0]).slice(0, 8).map((col) => (
                          <th key={col} className="p-2.5 font-semibold text-cyan-400">
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/80 bg-slate-900/40">
                      {tableData.slice(0, 50).map((row, idx) => (
                        <tr key={idx} className="hover:bg-slate-800/50">
                          {Object.keys(tableData[0]).slice(0, 8).map((col) => (
                            <td key={col} className="p-2.5 font-mono text-[11px] text-slate-300">
                              {typeof row[col] === 'object'
                                ? JSON.stringify(row[col]).slice(0, 30) + '...'
                                : String(row[col])}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          {activeTab === 'connection' && (
            <div className="space-y-6 max-w-3xl">
              <div className="bg-slate-800/40 border border-slate-800 rounded-xl p-5 space-y-4">
                <h3 className="font-bold text-white text-sm flex items-center gap-2">
                  <Server className="w-4 h-4 text-cyan-400" />
                  PostgreSQL Connection Parameters (No Credentials Exposed)
                </h3>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 font-mono text-xs">
                  <div className="bg-slate-950 p-2.5 rounded border border-slate-800">
                    <span className="text-slate-500 block text-[10px] uppercase font-sans font-semibold">Host</span>
                    <span className="text-cyan-300 font-bold">{dbMeta?.connection.host || 'localhost'}</span>
                  </div>
                  <div className="bg-slate-950 p-2.5 rounded border border-slate-800">
                    <span className="text-slate-500 block text-[10px] uppercase font-sans font-semibold">Port</span>
                    <span className="text-cyan-300 font-bold">{dbMeta?.connection.port || 5432}</span>
                  </div>
                  <div className="bg-slate-950 p-2.5 rounded border border-slate-800">
                    <span className="text-slate-500 block text-[10px] uppercase font-sans font-semibold">Database</span>
                    <span className="text-cyan-300 font-bold">{dbMeta?.connection.database || 'vizimove_db'}</span>
                  </div>
                  <div className="bg-slate-950 p-2.5 rounded border border-slate-800">
                    <span className="text-slate-500 block text-[10px] uppercase font-sans font-semibold">Schema</span>
                    <span className="text-cyan-300 font-bold">{dbMeta?.connection.schema || 'public'}</span>
                  </div>
                </div>

                <div className="space-y-2 pt-2">
                  <span className="text-slate-300 font-semibold block text-xs">psql CLI Command:</span>
                  <div className="flex items-center gap-2 bg-slate-950 p-2.5 rounded border border-slate-800 font-mono text-xs">
                    <span className="text-emerald-400 flex-1 overflow-x-auto">
                      {dbMeta?.connection.psqlCommand || 'psql -h localhost -p 5432 -U postgres -d vizimove_db'}
                    </span>
                    <button
                      onClick={() =>
                        copyToClipboard(
                          dbMeta?.connection.psqlCommand || 'psql -h localhost -p 5432 -U postgres -d vizimove_db',
                          false
                        )
                      }
                      className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-white"
                      title="Copy command"
                    >
                      {copiedConn ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              </div>

              {/* Client Setup Guides */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-slate-800/30 border border-slate-800 p-4 rounded-lg space-y-2">
                  <h4 className="font-bold text-white flex items-center gap-1.5 text-xs">
                    <ExternalLink className="w-3.5 h-3.5 text-cyan-400" />
                    pgAdmin 4 Setup Steps
                  </h4>
                  <ol className="list-decimal list-inside space-y-1 text-slate-400 text-[11px]">
                    <li>Open pgAdmin and right-click <strong>Servers</strong> &gt; <strong>Register</strong> &gt; <strong>Server...</strong></li>
                    <li>Name: <code className="text-cyan-300">ViziMove Vizag Operations</code></li>
                    <li>Connection tab: Host = <code className="text-cyan-300">localhost</code>, Port = <code className="text-cyan-300">5432</code></li>
                    <li>Maintenance database = <code className="text-cyan-300">vizimove_db</code></li>
                    <li>Open Query Tool and paste any query from the <strong>Mandatory SQL</strong> tab!</li>
                  </ol>
                </div>

                <div className="bg-slate-800/30 border border-slate-800 p-4 rounded-lg space-y-2">
                  <h4 className="font-bold text-white flex items-center gap-1.5 text-xs">
                    <ExternalLink className="w-3.5 h-3.5 text-cyan-400" />
                    DBeaver Setup Steps
                  </h4>
                  <ol className="list-decimal list-inside space-y-1 text-slate-400 text-[11px]">
                    <li>Click <strong>New Database Connection</strong> &gt; select <strong>PostgreSQL</strong></li>
                    <li>Host: <code className="text-cyan-300">localhost</code>, Port: <code className="text-cyan-300">5432</code></li>
                    <li>Database: <code className="text-cyan-300">vizimove_db</code></li>
                    <li>Click <strong>Test Connection</strong> and connect.</li>
                    <li>Execute queries to observe the 15-minute pipeline updates in real-time!</li>
                  </ol>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3 bg-slate-950 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
          <span>Relational Schema: <strong className="text-slate-200">v2.1-15min-operational</strong></span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-lg border border-slate-700 transition cursor-pointer font-medium"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
