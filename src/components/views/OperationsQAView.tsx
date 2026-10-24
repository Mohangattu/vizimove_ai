import React, { useState } from 'react';
import { Sparkles, HelpCircle, CheckCircle2, ChevronRight, Activity } from 'lucide-react';
import { api } from '../../services/api';

export const OperationsQAView: React.FC = () => {
  const [selectedQuery, setSelectedQuery] = useState<string>('HIGH_DEMAND_AREAS');
  const [loading, setLoading] = useState<boolean>(false);
  const [answerData, setAnswerData] = useState<{
    title: string;
    answer: string;
    evidence: Record<string, any>;
  } | null>(null);

  const queryOptions = [
    {
      id: 'HIGH_DEMAND_AREAS',
      label: 'Which areas of Visakhapatnam are expected to have high demand in the next hour?',
    },
    {
      id: 'EVENT_IMPACT',
      label: 'Which areas may experience demand spikes because of scheduled events?',
    },
    {
      id: 'SUPPLY_SHORTAGES',
      label: 'Where is available vehicle supply insufficient relative to predicted demand?',
    },
    {
      id: 'REPOSITIONING_RECOMMENDATIONS',
      label: 'Which drivers or available vehicles should be repositioned right now?',
    },
    {
      id: 'ASSUMPTIONS_UNCERTAINTY',
      label: 'What assumptions, uncertainties, and constraints affect each recommendation?',
    },
  ];

  const handleAsk = async (queryId: string) => {
    setSelectedQuery(queryId);
    setLoading(true);
    try {
      const data = await api.askOperationalInquiry(queryId);
      setAnswerData(data);
    } catch (err) {
      console.error('Inquiry failed', err);
    } finally {
      setLoading(false);
    }
  };

  // Load initial answer on mount
  React.useEffect(() => {
    handleAsk('HIGH_DEMAND_AREAS');
  }, []);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
        <h2 className="text-base font-bold text-white flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-cyan-400" />
          AI-Assisted Operations & Evidence-Backed Decision Support
        </h2>
        <p className="text-xs text-slate-400 mt-0.5">
          Grounded Explanations • Traceable to Backend Data Services • Zero Fabricated Numbers
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Question Selector List */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-2">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-400 block mb-2 px-2">
            Select Operational Question
          </span>
          {queryOptions.map((q) => {
            const isSelected = selectedQuery === q.id;
            return (
              <button
                key={q.id}
                onClick={() => handleAsk(q.id)}
                className={`w-full text-left p-3 rounded-lg text-xs transition cursor-pointer flex items-start justify-between gap-2 ${
                  isSelected
                    ? 'bg-cyan-950 border border-cyan-800/80 text-white font-semibold'
                    : 'text-slate-300 hover:bg-slate-800/60 hover:text-white'
                }`}
              >
                <span>{q.label}</span>
                <ChevronRight className={`w-4 h-4 shrink-0 mt-0.5 ${isSelected ? 'text-cyan-400' : 'text-slate-600'}`} />
              </button>
            );
          })}
        </div>

        {/* Answer & Traceable Evidence Card */}
        <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-xl p-6 flex flex-col justify-between shadow-sm">
          {loading ? (
            <div className="flex items-center justify-center p-16 text-xs text-slate-400">
              <Activity className="w-5 h-5 animate-spin mr-2 text-cyan-400" />
              Synthesizing verifiable operational response...
            </div>
          ) : answerData ? (
            <div className="space-y-5">
              <div>
                <span className="text-xs font-mono text-cyan-400 font-semibold uppercase tracking-wider block mb-1">
                  Deterministic Operational Brief
                </span>
                <h3 className="text-lg font-bold text-white">{answerData.title}</h3>
              </div>

              <div className="bg-slate-950/80 border border-slate-800 p-4 rounded-xl text-slate-200 text-xs leading-relaxed space-y-2">
                <p>{answerData.answer}</p>
              </div>

              {/* Underlying Traceable Evidence */}
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2 flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  Traceable Supporting Evidence
                </h4>
                <div className="bg-slate-950 border border-slate-800/80 rounded-lg p-3 text-xs font-mono text-slate-300 overflow-x-auto max-h-56">
                  <pre className="text-[11px] leading-relaxed">
                    {JSON.stringify(answerData.evidence, null, 2)}
                  </pre>
                </div>
              </div>
            </div>
          ) : null}

          <div className="mt-6 pt-4 border-t border-slate-800 text-[11px] text-slate-500 flex justify-between">
            <span>Decision Support Mode: Explainable & Non-hallucinatory</span>
            <span className="text-cyan-400">Deterministic Backend API</span>
          </div>
        </div>
      </div>
    </div>
  );
};
