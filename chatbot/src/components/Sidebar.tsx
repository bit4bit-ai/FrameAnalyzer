import React from 'react';
import styles from './Sidebar.module.css';
import { Message } from '@/app/page';
import { MODELS } from './ModelSelector';

export interface ChatSession {
  id: string;
  title: string;
  messages: Message[];
  interactionId: string | null;
  model?: string;
  updatedAt: number;
}

interface Props {
  sessions: ChatSession[];
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
  onNewChat: () => void;
  onDeleteSession: (id: string) => void;
}

export default function Sidebar({ sessions, activeSessionId, onSelectSession, onNewChat, onDeleteSession }: Props) {
  // Sort sessions by recently updated
  const sortedSessions = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);

  const getModelName = (modelId?: string) => {
    const found = MODELS.find(m => m.id === modelId);
    return found ? found.name : (modelId || 'Gemini 3.6 Flash');
  };

  return (
    <div className={styles.sidebar}>
      <button className={styles.newChatBtn} onClick={onNewChat}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" suppressHydrationWarning>
          <line x1="12" y1="5" x2="12" y2="19"></line>
          <line x1="5" y1="12" x2="19" y2="12"></line>
        </svg>
        New Chat
      </button>

      <div className={styles.sessionList}>
        {sortedSessions.map(session => (
          <div 
            key={session.id} 
            className={`${styles.sessionItem} ${session.id === activeSessionId ? styles.active : ''}`}
            onClick={() => onSelectSession(session.id)}
          >
            <div className={styles.sessionInfo}>
              <div className={styles.sessionTitle}>
                {session.title || 'New Conversation'}
              </div>
              <div className={styles.modelBadge}>
                {getModelName(session.model)}
              </div>
            </div>
            <button 
              className={styles.deleteBtn} 
              onClick={(e) => {
                e.stopPropagation();
                onDeleteSession(session.id);
              }}
              title="Delete chat"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" suppressHydrationWarning>
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              </svg>
            </button>
          </div>
        ))}
        {sessions.length === 0 && (
          <div className={styles.emptyText}>No recent chats</div>
        )}
      </div>
    </div>
  );
}
