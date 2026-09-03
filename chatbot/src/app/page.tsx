'use client';

import { useState, useEffect, useRef } from 'react';
import ChatMessage from '@/components/ChatMessage';
import ChatInput from '@/components/ChatInput';
import ModelSelector, { MODELS } from '@/components/ModelSelector';
import Sidebar, { ChatSession } from '@/components/Sidebar';
import styles from './page.module.css';

export interface Attachment {
  name: string;
  type: string;
  data: string; // base64
}

export interface Message {
  id: string;
  role: 'user' | 'ai';
  content: string;
  attachments?: Attachment[];
}

export default function Home() {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedModel, setSelectedModel] = useState('gemini-3.6-flash');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Load from local storage
  useEffect(() => {
    const savedSessions = localStorage.getItem('chatSessions');
    const savedActiveId = localStorage.getItem('activeSessionId');
    const savedModel = localStorage.getItem('selectedModel');
    
    let loadedSessions: ChatSession[] = [];
    if (savedSessions) {
      try {
        loadedSessions = JSON.parse(savedSessions);
        setSessions(loadedSessions);
      } catch (e) {
        console.error("Failed to parse saved sessions", e);
      }
    }

    if (savedActiveId) {
      setActiveSessionId(savedActiveId);
      const current = loadedSessions.find(s => s.id === savedActiveId);
      if (current?.model && MODELS.some(m => m.id === current.model)) {
        setSelectedModel(current.model);
        return;
      }
    }

    if (savedModel) {
      const isValid = MODELS.some(m => m.id === savedModel);
      setSelectedModel(isValid ? savedModel : 'gemini-3.6-flash');
    }
  }, []);

  // Save to local storage
  useEffect(() => {
    try {
      // Strip large base64 data to prevent QuotaExceededError
      const safeSessions = sessions.map(s => ({
        ...s,
        messages: s.messages.map(m => ({
          ...m,
          attachments: m.attachments?.map(a => ({ ...a, data: '' })) 
        }))
      }));
      
      localStorage.setItem('chatSessions', JSON.stringify(safeSessions));
      if (activeSessionId) {
        localStorage.setItem('activeSessionId', activeSessionId);
      } else {
        localStorage.removeItem('activeSessionId');
      }
      localStorage.setItem('selectedModel', selectedModel);
    } catch (e) {
      console.warn("Could not save to localStorage", e);
    }
  }, [sessions, activeSessionId, selectedModel]);

  const activeSession = sessions.find(s => s.id === activeSessionId) || null;
  const messages = activeSession?.messages || [];

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  const createNewSession = (initialMessage?: Message, title?: string): ChatSession => {
    const newSession: ChatSession = {
      id: Date.now().toString(),
      title: title || 'New Conversation',
      messages: initialMessage ? [initialMessage] : [],
      interactionId: null,
      model: selectedModel,
      updatedAt: Date.now()
    };
    setSessions(prev => [...prev, newSession]);
    setActiveSessionId(newSession.id);
    return newSession;
  };

  const handleNewChat = () => {
    setActiveSessionId(null);
  };

  const handleSelectSession = (id: string) => {
    setActiveSessionId(id);
    const session = sessions.find(s => s.id === id);
    if (session?.model && MODELS.some(m => m.id === session.model)) {
      setSelectedModel(session.model);
    }
  };

  const handleModelChange = (newModel: string) => {
    setSelectedModel(newModel);
    if (activeSessionId) {
      updateActiveSession({ model: newModel });
    }
  };

  const handleDeleteSession = (id: string) => {
    setSessions(prev => prev.filter(s => s.id !== id));
    if (activeSessionId === id) {
      setActiveSessionId(null);
    }
  };

  const updateActiveSession = (updates: Partial<ChatSession>) => {
    setSessions(prev => prev.map(s => {
      if (s.id === activeSessionId) {
        return { ...s, ...updates, updatedAt: Date.now() };
      }
      return s;
    }));
  };

  const handleSendMessage = async (text: string, attachments?: Attachment[]) => {
    if (!text.trim() && (!attachments || attachments.length === 0)) return;

    const userMessage: Message = { id: Date.now().toString(), role: 'user', content: text, attachments };
    
    let currentSessionId = activeSessionId;
    let currentInteractionId = activeSession?.interactionId || null;

    // If no active session, create one with an auto-generated title
    if (!currentSessionId) {
      const title = text.length > 20 ? text.substring(0, 20) + '...' : text;
      const newSession = createNewSession(userMessage, title);
      currentSessionId = newSession.id;
    } else {
      // Append to existing
      updateActiveSession({ messages: [...messages, userMessage] });
    }

    setIsLoading(true);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          attachments: attachments,
          model: selectedModel,
          previous_interaction_id: currentInteractionId,
          history: messages.map(m => ({ role: m.role, content: m.content })),
        }),
      });

      const data = await response.json();

      if (response.ok) {
        const aiMessage: Message = { id: (Date.now() + 1).toString(), role: 'ai', content: data.response };
        setSessions(prev => prev.map(s => {
          if (s.id === currentSessionId) {
            return {
              ...s,
              messages: [...s.messages, aiMessage],
              interactionId: data.interaction_id || s.interactionId,
              model: selectedModel,
              updatedAt: Date.now()
            };
          }
          return s;
        }));
      } else {
        console.error('Error:', data.error, data.details);
        const errorMessage: Message = { id: (Date.now() + 1).toString(), role: 'ai', content: `Error: ${data.details || data.error || 'Unknown error'}` };
        setSessions(prev => prev.map(s => {
          if (s.id === currentSessionId) {
            return {
              ...s,
              messages: [...s.messages, errorMessage],
              interactionId: null, // Reset interactionId so subsequent turns can re-establish state
              updatedAt: Date.now()
            };
          }
          return s;
        }));
      }
    } catch (error) {
      console.error('Fetch error:', error);
      const errorMessage: Message = { id: (Date.now() + 1).toString(), role: 'ai', content: 'Network error. Please check your connection.' };
      setSessions(prev => prev.map(s => {
        if (s.id === currentSessionId) {
          return { ...s, messages: [...s.messages, errorMessage], interactionId: null, updatedAt: Date.now() };
        }
        return s;
      }));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={styles.appContainer}>
      <Sidebar 
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSelectSession={handleSelectSession}
        onNewChat={handleNewChat}
        onDeleteSession={handleDeleteSession}
      />
      
      <main className={styles.main}>
        <header className={styles.header}>
          <div className={styles.headerLeft}>
            <div className={styles.logo}>✦</div>
            <h1 className={styles.title}>Gemini AI</h1>
          </div>
          <div className={styles.headerRight}>
            <ModelSelector selectedModel={selectedModel} onSelectModel={handleModelChange} />
          </div>
        </header>

        <div className={styles.chatContainer}>
          {messages.length === 0 ? (
            <div className={styles.emptyState}>
              <div className={styles.emptyIcon}>✦</div>
              <h2>How can I help you today?</h2>
              <p>Select a model from the top right and start chatting.</p>
            </div>
          ) : (
            <div className={styles.messagesList}>
              {messages.map((msg) => (
                <ChatMessage key={msg.id} message={msg} />
              ))}
              {isLoading && (
                <div className={styles.loadingBubble}>
                  <div className={styles.dot}></div>
                  <div className={styles.dot}></div>
                  <div className={styles.dot}></div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        <div className={styles.inputArea}>
          <ChatInput onSend={handleSendMessage} isLoading={isLoading} />
        </div>
      </main>
    </div>
  );
}
