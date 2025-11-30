import React from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine } from 'recharts';
import { SessionResult } from '../types';

interface HistoryChartProps {
  sessions: SessionResult[];
  isDark?: boolean;
}

export const HistoryChart: React.FC<HistoryChartProps> = ({ sessions, isDark = false }) => {
  // Sort oldest to newest for the chart
  const data = [...sessions].reverse().map(s => ({
    date: new Date(s.created_at).toLocaleDateString(),
    score: s.coverage_pct,
    zScore: s.z_coverage,
    rci: s.rci_coverage
  }));

  if (data.length === 0) return null;

  return (
    <div className="w-full h-64 bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm transition-colors duration-200">
      <h3 className="text-sm font-semibold text-slate-500 dark:text-slate-400 mb-4">Progresso Histórico (Cobertura %)</h3>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={isDark ? "#334155" : "#f1f5f9"} />
          <XAxis dataKey="date" stroke="#94a3b8" fontSize={12} tickLine={false} />
          <YAxis stroke="#94a3b8" fontSize={12} domain={[0, 100]} tickLine={false} />
          <Tooltip 
            contentStyle={{ 
              backgroundColor: isDark ? '#1e293b' : '#fff', 
              borderRadius: '8px', 
              border: isDark ? '1px solid #334155' : '1px solid #e2e8f0', 
              boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
              color: isDark ? '#f1f5f9' : '#0f172a'
            }}
          />
          <ReferenceLine y={65} stroke="#10b981" strokeDasharray="3 3" label={{ value: 'Média', position: 'insideRight', fill: '#10b981', fontSize: 10 }} />
          <Line 
            type="monotone" 
            dataKey="score" 
            stroke="#0ea5e9" 
            strokeWidth={3} 
            dot={{ r: 4, fill: '#0ea5e9', strokeWidth: 2, stroke: isDark ? '#1e293b' : '#fff' }} 
            activeDot={{ r: 6 }}
            name="Cobertura"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};