import React, { useState, useEffect, useRef } from 'react';
import { X, AlertTriangle, Trash2, Folder, Edit2, AlertCircle, HelpCircle } from 'lucide-react';

export interface ModalDialogConfig {
  isOpen: boolean;
  type?: 'confirm' | 'prompt' | 'alert';
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  promptValue?: string;
  promptPlaceholder?: string;
  isDestructive?: boolean;
  onConfirm: (inputValue?: string) => void;
  onCancel?: () => void;
}

interface ModalDialogProps {
  config: ModalDialogConfig | null;
}

const ModalDialog: React.FC<ModalDialogProps> = ({ config }) => {
  const [inputValue, setInputValue] = useState(config?.promptValue || '');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (config?.isOpen && config.type === 'prompt') {
      setInputValue(config.promptValue || '');
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 50);
    }
  }, [config?.isOpen, config?.promptValue, config?.type]);

  if (!config || !config.isOpen) return null;

  const {
    type = 'confirm',
    title,
    message,
    confirmText = type === 'alert' ? 'OK' : 'Confirm',
    cancelText = 'Cancel',
    promptPlaceholder = '',
    isDestructive = false,
    onConfirm,
    onCancel,
  } = config;

  const handleConfirm = () => {
    onConfirm(type === 'prompt' ? inputValue : undefined);
  };

  const handleCancel = () => {
    if (onCancel) {
      onCancel();
    } else {
      onConfirm(undefined);
    }
  };

  const renderIcon = () => {
    if (isDestructive) {
      return (
        <div className="p-2.5 bg-gradient-to-tr from-red-600 to-rose-600 rounded-xl text-white shadow-lg shadow-red-950/30 shrink-0">
          <Trash2 className="w-5 h-5" />
        </div>
      );
    }
    if (type === 'prompt') {
      return (
        <div className="p-2.5 bg-gradient-to-tr from-blue-600 to-indigo-600 rounded-xl text-white shadow-lg shadow-indigo-950/30 shrink-0">
          <Folder className="w-5 h-5" />
        </div>
      );
    }
    if (type === 'alert') {
      return (
        <div className="p-2.5 bg-gradient-to-tr from-amber-600 to-orange-600 rounded-xl text-white shadow-lg shadow-amber-950/30 shrink-0">
          <AlertCircle className="w-5 h-5" />
        </div>
      );
    }
    return (
      <div className="p-2.5 bg-gradient-to-tr from-purple-600 to-indigo-600 rounded-xl text-white shadow-lg shadow-purple-950/30 shrink-0">
        <HelpCircle className="w-5 h-5" />
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div 
        className="bg-slate-800 border border-slate-700 rounded-2xl max-w-md w-full shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700/80 bg-slate-900/40">
          <div className="flex items-center gap-3">
            {renderIcon()}
            <div>
              <h3 className="text-base font-bold text-white">{title}</h3>
            </div>
          </div>
          <button
            onClick={handleCancel}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700/50 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">{message}</p>

          {type === 'prompt' && (
            <div>
              <input
                ref={inputRef}
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleConfirm();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    handleCancel();
                  }
                }}
                placeholder={promptPlaceholder}
                className="w-full bg-slate-900/90 border border-slate-700 focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none transition-all font-medium"
              />
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-700/80 bg-slate-900/30">
          {type !== 'alert' && (
            <button
              onClick={handleCancel}
              className="px-4 py-2 rounded-xl text-sm font-medium bg-slate-700 hover:bg-slate-600 text-slate-200 transition-colors cursor-pointer"
            >
              {cancelText}
            </button>
          )}

          <button
            onClick={handleConfirm}
            className={`px-5 py-2 rounded-xl text-sm font-semibold transition-all shadow-lg cursor-pointer ${
              isDestructive
                ? 'bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 text-white shadow-red-950/40 active:scale-95'
                : 'bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white shadow-purple-950/40 active:scale-95'
            }`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ModalDialog;
