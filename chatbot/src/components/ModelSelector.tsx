import React from 'react';
import styles from './ModelSelector.module.css';

interface Props {
  selectedModel: string;
  onSelectModel: (model: string) => void;
}

export const MODELS = [
  { id: 'gemini-3.5-flash-lite', name: 'Gemini 3.5 Flash-Lite (Recommended)' },
  { id: 'gemini-3.6-flash', name: 'Gemini 3.6 Flash' },
  { id: 'gemini-3.1-flash-lite', name: 'Gemini 3.1 Flash-Lite' },
  { id: 'gemma-4-31b-it', name: 'Gemma 4 (31B)' },
  { id: 'gemma-4-26b-a4b-it', name: 'Gemma 4 (26B MoE)' }
];

export default function ModelSelector({ selectedModel, onSelectModel }: Props) {
  return (
    <div className={styles.selectorWrapper}>
      <select 
        className={styles.select}
        value={selectedModel}
        onChange={(e) => onSelectModel(e.target.value)}
      >
        {MODELS.map(model => (
          <option key={model.id} value={model.id}>
            {model.name}
          </option>
        ))}
      </select>
      <div className={styles.chevron}>
        <svg suppressHydrationWarning width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      </div>
    </div>
  );
}
