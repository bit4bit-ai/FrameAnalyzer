import React from 'react';
import { X, Activity, Clock, Zap, DollarSign, BarChart3, ExternalLink, HelpCircle, CheckCircle2, AlertTriangle, ArrowRight } from 'lucide-react';
import { StoredDailyQuota, getModelSpec, getTimeUntilPacificMidnight, calculateEstimatedCost } from '../services/quotaService';

interface QuotaModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentModel: string;
  quotaData: StoredDailyQuota;
  batchCompletedCount: number;
  batchTotalTokens: number;
  onSwitchModel?: (newModel: string) => void;
}

const QuotaModal: React.FC<QuotaModalProps> = ({
  isOpen,
  onClose,
  currentModel,
  quotaData,
  batchCompletedCount,
  batchTotalTokens,
  onSwitchModel,
}) => {
  if (!isOpen) return null;

  const spec = getModelSpec(currentModel);
  const timeUntilReset = getTimeUntilPacificMidnight();

  const requestsToday = quotaData.requestsToday;
  const maxFreeRpd = spec.rpdFreeTier;
  const percentUsed = Math.min(100, Math.round((requestsToday / maxFreeRpd) * 100));

  const totalCostToday = calculateEstimatedCost(
    quotaData.promptTokensToday,
    quotaData.candidateTokensToday,
    currentModel
  );

  const avgTokensPerVideo = batchCompletedCount > 0
    ? Math.round(batchTotalTokens / batchCompletedCount)
    : (requestsToday > 0 ? Math.round(quotaData.totalTokensToday / requestsToday) : 2200);

  const getStatusColor = () => {
    if (percentUsed >= 95) return 'text-red-400 bg-red-500/20 border-red-500/50';
    if (percentUsed >= 70) return 'text-amber-400 bg-amber-500/20 border-amber-500/50';
    return 'text-emerald-400 bg-emerald-500/20 border-emerald-500/50';
  };

  const getBarColor = () => {
    if (percentUsed >= 95) return 'bg-red-500';
    if (percentUsed >= 70) return 'bg-amber-500';
    return 'bg-gradient-to-r from-blue-500 to-purple-500';
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl max-w-2xl w-full shadow-2xl relative flex flex-col max-h-[90vh] overflow-hidden">
        
        {/* Header */}
        <div className="p-6 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-gradient-to-tr from-purple-600 to-blue-600 rounded-xl text-white shadow-lg shadow-purple-500/20">
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                API Quota & Token Metrics
              </h2>
              <p className="text-xs text-slate-400">
                Active Model: <span className="text-purple-400 font-mono font-medium">{spec.name}</span>
              </p>
            </div>
          </div>

          <button 
            onClick={onClose}
            className="text-slate-400 hover:text-white p-2 rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="p-6 space-y-6 overflow-y-auto custom-scrollbar">

          {/* Daily Quota Progress Card */}
          <div className="bg-slate-800/60 border border-slate-700/80 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Daily Free Tier Quota (RPD)
                </span>
                <div className="text-2xl font-bold text-white flex items-baseline gap-2 mt-0.5">
                  <span>{requestsToday}</span>
                  <span className="text-sm font-normal text-slate-400">/ ~{maxFreeRpd.toLocaleString()} requests today</span>
                </div>
              </div>

              <div className={`px-3 py-1.5 rounded-full text-xs font-semibold border flex items-center gap-1.5 ${getStatusColor()}`}>
                <Activity className="w-3.5 h-3.5" />
                {percentUsed}% Used
              </div>
            </div>

            {/* Progress Bar */}
            <div className="w-full bg-slate-950 rounded-full h-3 overflow-hidden p-0.5 border border-slate-800">
              <div 
                className={`h-full rounded-full transition-all duration-500 ${getBarColor()}`}
                style={{ width: `${Math.max(3, percentUsed)}%` }}
              />
            </div>

            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between text-xs text-slate-400 gap-2 pt-1 border-t border-slate-700/50">
              <div className="flex items-center gap-1.5 text-amber-300/90">
                <Clock className="w-3.5 h-3.5 shrink-0" />
                <span>Resets in <strong>{timeUntilReset.formatted}</strong> (Midnight Pacific Time)</span>
              </div>
              <span className="text-slate-500">Pacific Date: {quotaData.pacificDate}</span>
            </div>
          </div>

          {/* Token & Cost Metrics Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-slate-800/40 border border-slate-700/60 p-3.5 rounded-xl text-center">
              <div className="text-xs text-slate-400 uppercase tracking-wider">Avg / Video</div>
              <div className="text-lg font-bold text-slate-200 mt-1">~{avgTokensPerVideo.toLocaleString()}</div>
              <div className="text-[10px] text-slate-500">tokens</div>
            </div>

            <div className="bg-slate-800/40 border border-slate-700/60 p-3.5 rounded-xl text-center">
              <div className="text-xs text-slate-400 uppercase tracking-wider">Today's Tokens</div>
              <div className="text-lg font-bold text-purple-400 mt-1">
                {(quotaData.totalTokensToday / 1000).toFixed(1)}k
              </div>
              <div className="text-[10px] text-slate-500">
                In: {(quotaData.promptTokensToday / 1000).toFixed(1)}k | Out: {(quotaData.candidateTokensToday / 1000).toFixed(1)}k
              </div>
            </div>

            <div className="bg-slate-800/40 border border-slate-700/60 p-3.5 rounded-xl text-center">
              <div className="text-xs text-slate-400 uppercase tracking-wider">Current Batch</div>
              <div className="text-lg font-bold text-cyan-400 mt-1">
                {(batchTotalTokens / 1000).toFixed(1)}k
              </div>
              <div className="text-[10px] text-slate-500">{batchCompletedCount} videos done</div>
            </div>

            <div className="bg-slate-800/40 border border-slate-700/60 p-3.5 rounded-xl text-center">
              <div className="text-xs text-slate-400 uppercase tracking-wider">Est. Cost Today</div>
              <div className="text-lg font-bold text-emerald-400 mt-1">
                ${totalCostToday < 0.01 && totalCostToday > 0 ? '< 0.01' : totalCostToday.toFixed(3)}
              </div>
              <div className="text-[10px] text-slate-500">at Pay-As-You-Go rates</div>
            </div>
          </div>

          {/* Model Recommendation Notice if using low-quota preview model */}
          {spec.rpdFreeTier <= 100 && onSwitchModel && (
            <div className="bg-blue-950/40 border border-blue-500/40 rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div className="space-y-1">
                <div className="text-sm font-semibold text-blue-200 flex items-center gap-1.5">
                  <Zap className="w-4 h-4 text-blue-400" />
                  Need to analyze 100+ videos per day for free?
                </div>
                <p className="text-xs text-blue-300/80 leading-relaxed">
                  Switch to <strong>Gemini 2.5 Flash</strong>. Google grants <strong>1,500 free requests per day</strong> for 2.5 Flash (compared to ~50 for 3.x preview models).
                </p>
              </div>
              <button
                onClick={() => {
                  onSwitchModel('gemini-2.5-flash');
                  onClose();
                }}
                className="shrink-0 px-3.5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold shadow-md transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                Switch to 2.5 Flash
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Breakdown Anatomy: Where do the tokens go? */}
          <div className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <BarChart3 className="w-4 h-4 text-purple-400" />
              Token Breakdown Per Video
            </h4>

            <div className="bg-slate-950/60 rounded-xl p-4 border border-slate-800 text-xs space-y-2.5 font-mono">
              <div className="flex items-center justify-between py-1 border-b border-slate-800/80">
                <span className="text-slate-300 font-sans">3 Temporal Keyframes (JPEG)</span>
                <span className="text-slate-400 font-mono">~768 – 1,100 tokens (input)</span>
              </div>
              <div className="flex items-center justify-between py-1 border-b border-slate-800/80">
                <span className="text-slate-300 font-sans">System Prompt & Getty Rules</span>
                <span className="text-slate-400 font-mono">~550 tokens (input)</span>
              </div>
              <div className="flex items-center justify-between py-1 border-b border-slate-800/80">
                <span className="text-slate-300 font-sans">Keyword Pool + Recent Descriptions</span>
                <span className="text-slate-400 font-mono">~300 – 1,500 tokens (input)</span>
              </div>
              <div className="flex items-center justify-between py-1 border-b border-slate-800/80">
                <span className="text-slate-300 font-sans">AI Response (Title, Desc, 50 Keywords)</span>
                <span className="text-slate-400 font-mono">~300 – 450 tokens (output)</span>
              </div>
              <div className="flex items-center justify-between pt-1 font-bold text-purple-300 font-sans text-sm">
                <span>Total Consumed Per Video:</span>
                <span className="font-mono">~2,000 – 3,500 tokens</span>
              </div>
            </div>
          </div>

          {/* Detailed Info: Understanding Limits & Quotas */}
          <div className="space-y-3">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <HelpCircle className="w-4 h-4 text-cyan-400" />
              How Gemini Quotas Work (Why "Quota Exceeded" Occurs)
            </h4>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="bg-slate-800/40 p-3.5 rounded-xl border border-slate-700/50 space-y-1.5">
                <div className="font-semibold text-white flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-blue-400"></span>
                  RPM (Requests Per Minute)
                </div>
                <p className="text-slate-400 leading-relaxed">
                  Free tier limit is <strong>15 requests per minute</strong>. FrameAnalyzer automatically waits 15s between calls to prevent RPM errors.
                </p>
              </div>

              <div className="bg-slate-800/40 p-3.5 rounded-xl border border-slate-700/50 space-y-1.5">
                <div className="font-semibold text-white flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-amber-400"></span>
                  RPD (Requests Per Day)
                </div>
                <p className="text-slate-400 leading-relaxed">
                  The daily ceiling. When exceeded, the API returns <strong>RESOURCE_EXHAUSTED</strong> until Midnight Pacific Time (00:00 PT / 09:00 CET).
                </p>
              </div>
            </div>
          </div>

          {/* Pay As You Go Info Box */}
          <div className="bg-emerald-950/20 border border-emerald-500/30 rounded-xl p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
                <DollarSign className="w-4 h-4" />
                Want Unlimited Daily Runs? (Pay-As-You-Go)
              </span>
              <a
                href="https://aistudio.google.com/rate-limit?timeRange=last-28-days"
                target="_blank"
                rel="noreferrer"
                className="text-xs text-emerald-400 hover:text-emerald-300 underline flex items-center gap-1"
              >
                Google AI Studio Rate Limits
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
            <p className="text-xs text-emerald-200/80 leading-relaxed">
              Google charges only <strong>$0.10 to $0.30 per 1,000,000 input tokens</strong> for Gemini Flash. That means <strong>100 videos cost only ~$0.04 (4 cents)</strong>! Enabling billing in Google AI Studio removes the strict free-tier daily cap completely.
            </p>
          </div>

        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-900/50 flex items-center justify-between">
          <a
            href="https://aistudio.google.com/rate-limit?timeRange=last-28-days"
            target="_blank"
            rel="noreferrer"
            className="text-xs text-slate-400 hover:text-white flex items-center gap-1.5 transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5 text-purple-400" />
            Check Live Project Quota in Google AI Studio
          </a>

          <button
            onClick={onClose}
            className="px-5 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-sm font-medium transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>

      </div>
    </div>
  );
};

export default QuotaModal;
