import React, { useState, useEffect } from 'react';
import { Settings, Key, Eye, EyeOff, Check, AlertCircle, Loader2, X, ExternalLink, Cpu, ShieldCheck } from 'lucide-react';
import { testGeminiApiKey } from '../services/settingsService';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  apiKey: string;
  model: string;
  onSave: (apiKey: string, model: string) => Promise<void>;
}

const AVAILABLE_MODELS = [
  {
    id: 'gemini-3.6-flash',
    name: 'Gemini 3.6 Flash',
    badge: 'Recommended: Best Quality',
    description: 'Google’s officially recommended model. Rich, detailed stock footage descriptions with deep multimodal reasoning.',
  },
  {
    id: 'gemini-3.5-flash-lite',
    name: 'Gemini 3.5 Flash-Lite',
    badge: 'High-Volume Free (1,500 RPD)',
    description: 'Ultra-fast with 1,500 free requests/day, but produces simpler, more concise descriptions.',
  },
  {
    id: 'gemini-3.5-flash',
    name: 'Gemini 3.5 Flash',
    badge: 'Balanced & High-Speed',
    description: 'Foundational multimodal performance across routine, high-throughput stock footage reasoning (subject to temporary 503 load spikes).',
  },
  {
    id: 'gemini-3.6-flash',
    name: 'Gemini 3.6 Flash',
    badge: 'Deep Reasoning (~20 Free RPD)',
    description: 'Deep intelligence flash model. Note: Free tier is strictly capped at ~20 requests/day by Google.',
  },
  {
    id: 'gemini-3.7-flash',
    name: 'Gemini 3.7 Flash',
    badge: 'Thinking Model',
    description: 'Advanced reasoning model with thinking capabilities for complex, nuanced visual scenes.',
  },
];

const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  apiKey: initialApiKey,
  model: initialModel,
  onSave,
}) => {
  const [apiKey, setApiKey] = useState(initialApiKey);
  const [model, setModel] = useState(initialModel || 'gemini-3.6-flash');
  const [showKey, setShowKey] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    setApiKey(initialApiKey);
    setModel(initialModel || 'gemini-3.6-flash');
    setTestResult(null);
    setSaveSuccess(false);
  }, [initialApiKey, initialModel, isOpen]);

  if (!isOpen) return null;

  const handleTestKey = async () => {
    if (!apiKey.trim()) {
      setTestResult({ success: false, message: 'Please enter an API key first.' });
      return;
    }
    setIsTesting(true);
    setTestResult(null);
    try {
      const res = await testGeminiApiKey(apiKey.trim(), model);
      setTestResult(res);
    } catch (err: any) {
      setTestResult({ success: false, message: err.message || 'Connection test failed.' });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSave(apiKey.trim(), model);
      setSaveSuccess(true);
      setTimeout(() => {
        setSaveSuccess(false);
        onClose();
      }, 900);
    } catch (err) {
      console.error('Failed to save settings:', err);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-slate-800 border border-slate-700 rounded-2xl max-w-xl w-full shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700/80 bg-slate-900/40">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-gradient-to-tr from-purple-500 to-indigo-600 rounded-lg text-white">
              <Settings className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Settings</h2>
              <p className="text-xs text-slate-400">Configure your Gemini API key and analysis model</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-slate-700 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 flex flex-col gap-6 overflow-y-auto max-h-[75vh]">
          {/* Gemini API Key Section */}
          <div className="flex flex-col gap-2.5">
            <div className="flex items-center justify-between">
              <label className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                <Key className="w-4 h-4 text-purple-400" />
                Gemini API Key
              </label>
              <a
                href="https://aistudio.google.com/apikey"
                target="_blank"
                rel="noreferrer"
                className="text-xs text-purple-400 hover:text-purple-300 flex items-center gap-1 transition-colors"
              >
                <span>Get API key from Google AI Studio</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>

            <div className="relative flex items-center">
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  setTestResult(null);
                }}
                placeholder="Paste your Gemini API key here..."
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-2.5 pr-24 text-sm font-mono text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
              />
              <div className="absolute right-2 flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  className="p-1.5 text-slate-400 hover:text-slate-200 rounded-lg hover:bg-slate-800 transition-colors"
                  title={showKey ? 'Hide key' : 'Show key'}
                >
                  {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
                <button
                  type="button"
                  onClick={handleTestKey}
                  disabled={isTesting || !apiKey.trim()}
                  className="px-2.5 py-1 bg-slate-700 hover:bg-slate-600 disabled:opacity-40 text-slate-200 rounded-lg text-xs font-medium transition-colors flex items-center gap-1"
                >
                  {isTesting ? <Loader2 className="w-3 h-3 animate-spin" /> : <ShieldCheck className="w-3 h-3" />}
                  Test
                </button>
              </div>
            </div>

            {/* Test Connection Feedback */}
            {testResult && (
              <div
                className={`p-3 rounded-xl text-xs flex items-start gap-2 animate-in fade-in duration-200 ${
                  testResult.success
                    ? 'bg-green-500/10 border border-green-500/30 text-green-300'
                    : 'bg-red-500/10 border border-red-500/30 text-red-300'
                }`}
              >
                {testResult.success ? (
                  <Check className="w-4 h-4 text-green-400 shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                )}
                <span>{testResult.message}</span>
              </div>
            )}

            <p className="text-[11px] text-slate-500 leading-relaxed">
              Your key is saved in <code className="text-purple-300">.env.local</code> and kept locally in your browser. It is never uploaded anywhere outside Google Gemini API.
            </p>
          </div>

          {/* Model Selection Section */}
          <div className="flex flex-col gap-2.5 pt-4 border-t border-slate-700/60">
            <label className="text-sm font-semibold text-slate-200 flex items-center gap-2">
              <Cpu className="w-4 h-4 text-indigo-400" />
              Analysis AI Model
            </label>

            <div className="grid grid-cols-1 gap-2.5">
              {AVAILABLE_MODELS.map((m) => {
                const isSelected = model === m.id;
                return (
                  <label
                    key={m.id}
                    onClick={() => setModel(m.id)}
                    className={`cursor-pointer p-3.5 rounded-xl border transition-all flex flex-col gap-1 text-left ${
                      isSelected
                        ? 'bg-purple-900/25 border-purple-500/80 shadow-md shadow-purple-900/20 ring-1 ring-purple-500/50'
                        : 'bg-slate-900/50 border-slate-700/80 hover:border-slate-600'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 font-semibold text-sm text-white">
                        <input
                          type="radio"
                          name="geminiModel"
                          value={m.id}
                          checked={isSelected}
                          onChange={() => setModel(m.id)}
                          className="accent-purple-500"
                        />
                        <span>{m.name}</span>
                      </div>
                      <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-full bg-slate-800 text-purple-300 border border-purple-700/30">
                        {m.badge}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 pl-5">{m.description}</p>
                  </label>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-700/80 bg-slate-900/40">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-xl text-xs font-semibold transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className="flex items-center gap-2 px-5 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-purple-600/20 disabled:opacity-50"
          >
            {isSaving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Saving...
              </>
            ) : saveSuccess ? (
              <>
                <Check className="w-4 h-4 text-green-300" />
                Settings Saved!
              </>
            ) : (
              'Save Settings'
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
