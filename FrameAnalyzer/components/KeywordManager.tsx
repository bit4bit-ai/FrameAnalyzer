import React, { useState, useRef, useMemo, useEffect } from 'react';
import { Tags, Plus, X, Upload, Download, Trash2, Check, Loader2, Info, FileText, AlertCircle, Search, ClipboardPaste, Eye, EyeOff, Database } from 'lucide-react';
import { parseCommaSeparatedKeywords, parseKeywordsFromArray, exportKeywordsToFile } from '../services/keywordService';
import ModalDialog, { ModalDialogConfig } from './ModalDialog';

interface KeywordManagerProps {
  dbKeywords: string[];
  onSaveToDb: (newKeywords: string[]) => Promise<void>;
  onClearDb?: () => Promise<void>;
  isSaving: boolean;
}

const PAGE_SIZE = 150;
const STAGED_KEY = 'frame_analyzer_staged_keywords';
const INPUT_KEY = 'frame_analyzer_keyword_input';
const BULK_KEY = 'frame_analyzer_keyword_bulk';

const KeywordManager: React.FC<KeywordManagerProps> = ({
  dbKeywords,
  onSaveToDb,
  onClearDb,
  isSaving,
}) => {
  // Staging area: newly added keywords waiting to be uploaded to database (persisted across refresh)
  const [stagedKeywords, setStagedKeywords] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(STAGED_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });
  const [inputValue, setInputValue] = useState<string>(() => {
    try {
      return localStorage.getItem(INPUT_KEY) || '';
    } catch {
      return '';
    }
  });
  const [bulkText, setBulkText] = useState<string>(() => {
    try {
      return localStorage.getItem(BULK_KEY) || '';
    } catch {
      return '';
    }
  });
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [showDbViewer, setShowDbViewer] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [dialogConfig, setDialogConfig] = useState<ModalDialogConfig | null>(null);
  const [dbSearchQuery, setDbSearchQuery] = useState('');
  const [visibleDbCount, setVisibleDbCount] = useState(PAGE_SIZE);

  // Sync staged keywords and text to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STAGED_KEY, JSON.stringify(stagedKeywords));
    } catch {}
  }, [stagedKeywords]);

  useEffect(() => {
    try {
      localStorage.setItem(INPUT_KEY, inputValue);
    } catch {}
  }, [inputValue]);

  useEffect(() => {
    try {
      localStorage.setItem(BULK_KEY, bulkText);
    } catch {}
  }, [bulkText]);

  const [notification, setNotification] = useState<{ type: 'success' | 'warning' | 'info'; message: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Track pending keyword deletions from the database before saving
  const [pendingDeletedKeywords, setPendingDeletedKeywords] = useState<string[]>([]);

  // Active database keywords with pending deletions filtered out
  const activeDbKeywords = useMemo(() => {
    if (pendingDeletedKeywords.length === 0) return dbKeywords;
    const deletedSet = new Set(pendingDeletedKeywords.map(k => k.toLowerCase()));
    return dbKeywords.filter(k => !deletedSet.has(k.toLowerCase()));
  }, [dbKeywords, pendingDeletedKeywords]);

  const deletedDbKeywordsCount = pendingDeletedKeywords.length;
  const hasDbChanges = deletedDbKeywordsCount > 0;

  // Prune any pending deletions that are no longer in dbKeywords if dbKeywords changes externally
  useEffect(() => {
    if (pendingDeletedKeywords.length > 0) {
      const dbSet = new Set(dbKeywords.map(k => k.toLowerCase()));
      setPendingDeletedKeywords(prev => prev.filter(k => dbSet.has(k.toLowerCase())));
    }
  }, [dbKeywords]);

  // All known keywords (staged + active database) to prevent exact duplicates
  const allExistingKeywords = useMemo(() => {
    return [...activeDbKeywords, ...stagedKeywords];
  }, [activeDbKeywords, stagedKeywords]);

  // Database search filter for viewer
  const filteredDbKeywords = useMemo(() => {
    if (!dbSearchQuery.trim()) return activeDbKeywords;
    const q = dbSearchQuery.toLowerCase().trim();
    return activeDbKeywords.filter(k => k.toLowerCase().includes(q));
  }, [activeDbKeywords, dbSearchQuery]);

  const displayedDbKeywords = useMemo(() => {
    return filteredDbKeywords.slice(0, visibleDbCount);
  }, [filteredDbKeywords, visibleDbCount]);

  const handleAddKeywords = (text: string) => {
    if (!text.trim()) return;
    const { added, duplicatesCount, sampleDuplicates } = parseCommaSeparatedKeywords(text, allExistingKeywords);

    if (added.length > 0) {
      setStagedKeywords(prev => [...prev, ...added]);
    }

    if (duplicatesCount > 0) {
      if (added.length === 0) {
        setNotification({
          type: 'warning',
          message: duplicatesCount === 1
            ? `"${sampleDuplicates[0]}" is already in the database or staged list.`
            : `All ${duplicatesCount} keyword(s) already exist in database.`
        });
      } else {
        setNotification({
          type: 'info',
          message: `Staged ${added.length.toLocaleString()} new keyword(s). Skipped ${duplicatesCount.toLocaleString()} duplicate(s).`
        });
      }
    } else if (added.length > 0) {
      setNotification({
        type: 'info',
        message: `Staged ${added.length.toLocaleString()} keyword(s). Click "Upload to Database" to save.`
      });
    }

    setInputValue('');
  };

  const handleBulkSubmit = () => {
    if (!bulkText.trim()) return;
    handleAddKeywords(bulkText);
    setBulkText('');
    setShowBulkModal(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',' || e.key === ';') {
      e.preventDefault();
      handleAddKeywords(inputValue);
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const pastedText = e.clipboardData.getData('text');
    if (pastedText && (pastedText.includes(',') || pastedText.includes('\n') || pastedText.length > 80)) {
      e.preventDefault();
      handleAddKeywords(pastedText);
      setInputValue('');
    }
  };

  const handleRemoveStaged = (indexToRemove: number) => {
    setStagedKeywords(prev => prev.filter((_, idx) => idx !== indexToRemove));
  };

  const handleClearStaged = () => {
    setStagedKeywords([]);
    setInputValue('');
    try {
      localStorage.removeItem(STAGED_KEY);
      localStorage.removeItem(INPUT_KEY);
    } catch {}
    setNotification(null);
  };

  // Upload staged keywords into the database and clear the text field / staging area!
  const handleUploadToDb = async () => {
    let toUpload = [...stagedKeywords];

    // If user also left uncommitted text in the input box, add it as well
    if (inputValue.trim()) {
      const { added } = parseCommaSeparatedKeywords(inputValue, allExistingKeywords);
      if (added.length > 0) {
        toUpload = [...toUpload, ...added];
      }
    }

    if (toUpload.length === 0) return;

    try {
      const mergedDb = [...activeDbKeywords, ...toUpload];
      await onSaveToDb(mergedDb);
      setPendingDeletedKeywords([]);

      // IMMEDIATELY CLEAR STAGING AREA AND TEXT FIELD
      const countUploaded = toUpload.length;
      setStagedKeywords([]);
      setInputValue('');
      setBulkText('');
      try {
        localStorage.removeItem(STAGED_KEY);
        localStorage.removeItem(INPUT_KEY);
        localStorage.removeItem(BULK_KEY);
      } catch {}

      setNotification({
        type: 'success',
        message: `✓ Successfully saved ${countUploaded.toLocaleString()} keyword(s) to database! Total in DB: ${mergedDb.length.toLocaleString()}.`
      });
    } catch (err: any) {
      setNotification({
        type: 'warning',
        message: `Failed to save to database: ${err.message || 'Unknown error'}`
      });
    }
  };

  const handleDeleteDbKeyword = (keywordToDelete: string) => {
    const targetLower = keywordToDelete.toLowerCase();
    setPendingDeletedKeywords(prev => {
      if (prev.some(k => k.toLowerCase() === targetLower)) return prev;
      return [...prev, keywordToDelete];
    });
  };

  const handleRevertDbChanges = () => {
    setPendingDeletedKeywords([]);
    setNotification({
      type: 'info',
      message: 'Pending database deletions have been discarded.'
    });
  };

  const handleSaveDbDeletions = async () => {
    if (!hasDbChanges || isSaving) return;
    const count = deletedDbKeywordsCount;

    try {
      await onSaveToDb(activeDbKeywords);
      setPendingDeletedKeywords([]);
      setNotification({
        type: 'success',
        message: `✓ Successfully saved changes to database. Removed ${count.toLocaleString()} keyword(s).`
      });
    } catch (err: any) {
      setNotification({
        type: 'warning',
        message: `Failed to save changes to database: ${err.message || 'Unknown error'}`
      });
    }
  };

  const handleFileImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setInputValue('');
    setBulkText('');

    const fileName = file.name.toLowerCase();
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        let items: string[] = [];

        if (fileName.endsWith('.json')) {
          const parsed = JSON.parse(text);
          const rawArray = Array.isArray(parsed) ? parsed : (parsed.keywords || []);
          items = rawArray.filter((item: any) => typeof item === 'string');
        } else {
          items = text.split(/[\r\n,;]+/).map(s => s.trim()).filter(Boolean);
        }

        const { added, duplicatesCount } = parseKeywordsFromArray(items, allExistingKeywords);

        if (added.length > 0) {
          setStagedKeywords(prev => [...prev, ...added]);
        }

        setInputValue('');

        if (duplicatesCount > 0) {
          setNotification({
            type: 'info',
            message: `Staged ${added.length.toLocaleString()} keywords from ${file.name}. (${duplicatesCount.toLocaleString()} duplicate(s) skipped). Click "Upload to Database" to save.`
          });
        } else if (added.length > 0) {
          setNotification({
            type: 'info',
            message: `Staged ${added.length.toLocaleString()} keywords from ${file.name}. Click "Upload to Database" to save.`
          });
        } else {
          setNotification({
            type: 'warning',
            message: `All keywords in ${file.name} already exist in database.`
          });
        }
      } catch (err: any) {
        setNotification({
          type: 'warning',
          message: `Failed to import file: ${err.message || 'Invalid format'}`
        });
      }
    };

    reader.readAsText(file);
    event.target.value = '';
  };

  return (
    <div className="bg-slate-800/50 border border-slate-700 rounded-2xl p-6 backdrop-blur-sm shadow-xl flex flex-col gap-4">
      {/* Bulk Paste Modal */}
      {showBulkModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="bg-slate-800 border border-purple-500/40 rounded-2xl p-6 max-w-2xl w-full shadow-2xl flex flex-col gap-4">
            <div className="flex items-center justify-between border-b border-slate-700 pb-3">
              <div className="flex items-center gap-2 text-white font-bold">
                <ClipboardPaste className="w-5 h-5 text-purple-400" />
                <span>Bulk Paste Keywords</span>
              </div>
              <button
                type="button"
                onClick={() => setShowBulkModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-300">
              Paste keywords below (separated by commas or line breaks). They will appear as labels in the upload area ready to review.
            </p>

            <textarea
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
              placeholder="Paste comma-separated or newline-separated keywords..."
              rows={10}
              className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 text-xs font-mono text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-purple-500 resize-y"
            />

            <div className="flex items-center justify-between pt-2">
              <span className="text-xs text-slate-400">
                {bulkText ? `${bulkText.split(/[\r\n,;]+/).filter(s => s.trim().length > 0).length.toLocaleString()} items detected` : 'Ready to paste'}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowBulkModal(false)}
                  className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg text-xs font-medium"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleBulkSubmit}
                  disabled={!bulkText.trim()}
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white rounded-lg text-xs font-semibold shadow-md"
                >
                  Stage Keywords
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-700/60 pb-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-gradient-to-tr from-purple-500 to-indigo-600 rounded-xl shadow-md shadow-purple-500/20 text-white">
            <Tags className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              Keyword Upload Area
              {stagedKeywords.length > 0 && (
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-purple-600/40 text-purple-200 border border-purple-500/40 font-mono font-bold animate-pulse">
                  {stagedKeywords.length.toLocaleString()} ready to upload
                </span>
              )}
            </h2>
            <p className="text-xs text-slate-400">
              Paste or import keywords &rarr; review labels &rarr; click <strong className="text-purple-300">Upload to Database</strong> to save & clear.
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileImport}
            accept=".json,.csv,.txt,application/json,text/plain,text/csv"
            className="hidden"
          />

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            title="Import keywords from TXT, CSV, or JSON file"
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-700/70 hover:bg-slate-600 text-slate-300 rounded-lg text-xs font-medium transition-colors"
          >
            <FileText className="w-3.5 h-3.5 text-cyan-400" />
            Import File
          </button>

          <button
            type="button"
            onClick={() => setShowBulkModal(true)}
            title="Paste large keyword list"
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-700/70 hover:bg-slate-600 text-slate-300 rounded-lg text-xs font-medium transition-colors"
          >
            <ClipboardPaste className="w-3.5 h-3.5 text-purple-400" />
            Bulk Paste
          </button>

          {stagedKeywords.length > 0 && (
            <button
              type="button"
              onClick={handleClearStaged}
              title="Clear staged labels"
              className="flex items-center gap-1 px-3 py-1.5 bg-red-950/40 hover:bg-red-900/60 border border-red-800/40 text-red-300 rounded-lg text-xs font-medium transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Cancel / Clear
            </button>
          )}

          {/* Upload to Database Button (Saves & Clears the Field) */}
          <button
            type="button"
            onClick={handleUploadToDb}
            disabled={isSaving || (stagedKeywords.length === 0 && !inputValue.trim())}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all shadow-md ${
              stagedKeywords.length > 0 || inputValue.trim()
                ? 'bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white shadow-purple-500/30 ring-2 ring-purple-400/50 animate-bounce'
                : 'bg-slate-700/60 text-slate-400 cursor-not-allowed'
            }`}
          >
            {isSaving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Saving to Database...
              </>
            ) : (
              <>
                <Upload className="w-4 h-4" />
                Upload to Database & Clear ({stagedKeywords.length})
              </>
            )}
          </button>
        </div>
      </div>

      {/* Notification Banner */}
      {notification && (
        <div className={`flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-xl text-xs ${
          notification.type === 'success'
            ? 'bg-green-500/15 border border-green-500/40 text-green-300'
            : notification.type === 'warning'
            ? 'bg-amber-500/15 border border-amber-500/40 text-amber-300'
            : 'bg-blue-500/15 border border-blue-500/40 text-blue-300'
        }`}>
          <div className="flex items-center gap-2">
            {notification.type === 'success' ? (
              <Check className="w-4 h-4 text-green-400 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0" />
            )}
            <span>{notification.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setNotification(null)}
            className="opacity-70 hover:opacity-100 p-0.5"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Input Field with Add Button */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder="Type or paste comma-separated keywords here (e.g., 4k, drone, ocean, sunset)..."
            className="w-full bg-slate-900/90 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
          />
        </div>
        <button
          type="button"
          onClick={() => handleAddKeywords(inputValue)}
          disabled={!inputValue.trim()}
          className="flex items-center gap-1.5 px-4 py-2.5 bg-purple-600 hover:bg-purple-500 disabled:bg-slate-700 text-white rounded-xl text-xs font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-md shadow-purple-600/20"
        >
          <Plus className="w-4 h-4" />
          Stage
        </button>
      </div>

      {/* Upload Staging Area (Labels with Cross Delete Icon) */}
      <div className="bg-slate-900/60 border border-slate-700/60 rounded-xl p-3.5 min-h-[90px] max-h-[200px] overflow-y-auto flex flex-wrap content-start gap-2">
        {stagedKeywords.length === 0 ? (
          <div className="w-full h-16 flex flex-col items-center justify-center text-slate-500 text-xs text-center">
            <span>Staging area is empty.</span>
            <span className="text-[11px] text-slate-600 mt-0.5">
              Paste or type keywords above &rarr; they resolve into labels here &rarr; click <strong>Upload to Database</strong> to save.
            </span>
          </div>
        ) : (
          stagedKeywords.map((kw, idx) => (
            <span
              key={`${kw}-${idx}`}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-purple-950/60 text-purple-200 border border-purple-700/70 hover:border-purple-500 shadow-sm transition-all"
            >
              <span className="truncate max-w-[200px]">{kw}</span>
              <button
                type="button"
                onClick={() => handleRemoveStaged(idx)}
                className="text-purple-400 hover:text-red-400 hover:bg-red-500/20 rounded-full p-0.5 transition-colors focus:outline-none"
                title={`Remove "${kw}"`}
                aria-label={`Remove ${kw}`}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </span>
          ))
        )}
      </div>

      {/* Database Status Bar & Viewer Toggle */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-800">
        <div className="flex items-center gap-2">
          <Database className="w-4 h-4 text-emerald-400" />
          <span className="text-xs text-slate-300">
            Database Status: <strong className="text-emerald-400 font-mono">{activeDbKeywords.length.toLocaleString()} keywords</strong> saved in <code className="text-purple-300 text-[11px]">keywords.json</code>
            {hasDbChanges && (
              <span className="text-amber-400 ml-1 font-semibold">({deletedDbKeywordsCount} unsaved deletion{deletedDbKeywordsCount > 1 ? 's' : ''})</span>
            )}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => exportKeywordsToFile(activeDbKeywords)}
            disabled={activeDbKeywords.length === 0}
            className="flex items-center gap-1.5 px-2.5 py-1 text-slate-400 hover:text-slate-200 text-xs font-medium transition-colors disabled:opacity-40 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            Export JSON
          </button>

          <button
            type="button"
            onClick={() => setShowDbViewer(prev => !prev)}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium transition-colors border cursor-pointer ${
              showDbViewer
                ? 'bg-slate-700 text-white border-slate-500'
                : hasDbChanges
                ? 'bg-amber-950/40 border-amber-600/50 text-amber-300 hover:bg-amber-900/50'
                : 'bg-slate-700/60 hover:bg-slate-700 text-slate-300 border-slate-600'
            }`}
          >
            {showDbViewer ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            {showDbViewer ? 'Hide DB List' : `View DB (${activeDbKeywords.length.toLocaleString()})`}
          </button>
        </div>
      </div>

      {/* Optional Database Keywords Viewer (Collapsible) */}
      {showDbViewer && (
        <div className="bg-slate-900/80 border border-slate-700 rounded-xl p-4 flex flex-col gap-3 animate-in fade-in">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-slate-300 flex items-center gap-1.5">
                <Database className="w-3.5 h-3.5 text-emerald-400" />
                Keywords in Database ({activeDbKeywords.length.toLocaleString()}):
              </span>
              {hasDbChanges && (
                <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-amber-950/70 border border-amber-600/50 text-amber-300 font-mono">
                  {deletedDbKeywordsCount} pending deletion
                </span>
              )}
            </div>

            <div className="flex items-center gap-2 flex-1 justify-end flex-wrap">
              <div className="relative max-w-xs flex-1 min-w-[160px]">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2" />
                <input
                  type="text"
                  value={dbSearchQuery}
                  onChange={(e) => {
                    setDbSearchQuery(e.target.value);
                    setVisibleDbCount(PAGE_SIZE);
                  }}
                  placeholder="Search database keywords..."
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-8 pr-3 py-1 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-purple-500"
                />
                {dbSearchQuery && (
                  <button
                    type="button"
                    onClick={() => setDbSearchQuery('')}
                    className="absolute right-2 top-1.5 text-slate-400 hover:text-white cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>

              {hasDbChanges && (
                <button
                  type="button"
                  onClick={handleRevertDbChanges}
                  disabled={isSaving}
                  className="px-2.5 py-1 text-slate-400 hover:text-slate-200 text-xs font-medium transition-colors cursor-pointer disabled:opacity-50"
                  title="Discard pending deletions and restore original database keywords"
                >
                  Discard
                </button>
              )}

              <button
                type="button"
                onClick={handleSaveDbDeletions}
                disabled={!hasDbChanges || isSaving}
                className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all shadow-sm shrink-0 ${
                  hasDbChanges
                    ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-600/30 border border-emerald-400 cursor-pointer active:scale-95'
                    : 'bg-slate-800 text-slate-500 border border-slate-700/60 cursor-not-allowed opacity-60'
                }`}
                title={hasDbChanges ? `Save deletions to database (${deletedDbKeywordsCount} deleted)` : 'No deletions to save (delete a keyword to activate)'}
              >
                {isSaving ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    Save to DB{hasDbChanges ? ` (${deletedDbKeywordsCount})` : ''}
                  </>
                )}
              </button>
            </div>
          </div>

          <div className="max-h-[160px] overflow-y-auto flex flex-wrap content-start gap-1.5 p-2 bg-black/20 rounded-lg border border-slate-800">
            {filteredDbKeywords.length === 0 ? (
              <span className="text-xs text-slate-500 p-2">No matching keywords in database.</span>
            ) : (
              <>
                {displayedDbKeywords.map((kw, idx) => (
                  <span
                    key={`db-${kw}-${idx}`}
                    className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-slate-800 text-slate-300 border border-slate-700 hover:border-slate-500 transition-all group"
                  >
                    <span className="truncate max-w-[200px]">{kw}</span>
                    <button
                      type="button"
                      onClick={() => handleDeleteDbKeyword(kw)}
                      className="text-slate-400 hover:text-red-400 hover:bg-red-500/20 rounded-full p-0.5 transition-colors focus:outline-none cursor-pointer"
                      title={`Delete "${kw}" from database`}
                      aria-label={`Delete ${kw}`}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
                {filteredDbKeywords.length > displayedDbKeywords.length && (
                  <button
                    type="button"
                    onClick={() => setVisibleDbCount(prev => prev + PAGE_SIZE)}
                    className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-950/40 text-emerald-300 border border-emerald-800/40 cursor-pointer hover:bg-emerald-900/60 transition-colors"
                  >
                    + Show More ({(filteredDbKeywords.length - displayedDbKeywords.length).toLocaleString()})
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Helper Info Footer */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-slate-400 bg-slate-900/40 p-2.5 rounded-lg border border-slate-800">
        <div className="flex items-center gap-2">
          <Info className="w-4 h-4 text-purple-400 shrink-0" />
          <span>
            <strong>AI Logic:</strong> Gemini picks matching keywords from the database first (creates own only if not enough match), and always automatically includes recognized places/locations.
          </span>
        </div>
        <div className="text-[11px] text-slate-500 font-mono">
          Only identical keywords are skipped.
        </div>
      </div>

      <ModalDialog config={dialogConfig} />
    </div>
  );
};

export default KeywordManager;
