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
  const [selectedModel, setSelectedModel] = useState('gemini-3.5-flash-lite');
  const [isLoaded, setIsLoaded] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Load from local storage safely on mount
  useEffect(() => {
    try {
      const savedSessions = localStorage.getItem('chatSessions');
      const savedActiveId = localStorage.getItem('activeSessionId');
      const savedModel = localStorage.getItem('selectedModel');
      
      let loadedSessions: ChatSession[] = [];
      if (savedSessions) {
        try {
          loadedSessions = JSON.parse(savedSessions);
          if (Array.isArray(loadedSessions)) {
            setSessions(loadedSessions);
          }
        } catch (e) {
          console.error("Failed to parse saved sessions", e);
        }
      }

      if (savedActiveId && loadedSessions.some(s => s.id === savedActiveId)) {
        setActiveSessionId(savedActiveId);
        const current = loadedSessions.find(s => s.id === savedActiveId);
        if (current?.model && MODELS.some(m => m.id === current.model)) {
          setSelectedModel(current.model);
        }
      } else if (loadedSessions.length > 0) {
        setActiveSessionId(loadedSessions[0].id);
      } else {
        setActiveSessionId(null);
      }

      if (savedModel && MODELS.some(m => m.id === savedModel)) {
        setSelectedModel(savedModel);
      }
    } catch (e) {
      console.warn("Could not read from localStorage", e);
    } finally {
      setIsLoaded(true);
    }
  }, []);

  // Save to local storage only AFTER initial load completes
  useEffect(() => {
    if (!isLoaded) return;
    try {
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
  }, [sessions, activeSessionId, selectedModel, isLoaded]);

  const activeSession = sessions.find(s => s.id === activeSessionId) || null;
  const messages = activeSession?.messages || [];

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

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
      setSessions(prev => prev.map(s => s.id === activeSessionId ? { ...s, model: newModel } : s));
    }
  };

  const handleDeleteSession = (id: string) => {
    setSessions(prev => prev.filter(s => s.id !== id));
    if (activeSessionId === id) {
      setActiveSessionId(null);
    }
  };

  const handleSendMessage = async (text: string, attachments?: Attachment[]) => {
    if (!text.trim() && (!attachments || attachments.length === 0)) return;

    const userMsgId = `${Date.now()}-user`;
    const userMessage: Message = { id: userMsgId, role: 'user', content: text, attachments };
    
    // Check if current active session exists
    let targetSessionId = activeSessionId;
    const existingSession = sessions.find(s => s.id === targetSessionId);
    let previousInteractionId: string | null = null;
    let conversationHistory: { role: 'user' | 'ai'; content: string }[] = [];

    if (!targetSessionId || !existingSession) {
      // Create new session immediately with the user message
      const newSessionId = `${Date.now()}`;
      targetSessionId = newSessionId;
      const title = text.length > 24 ? text.substring(0, 24) + '...' : text;
      const newSession: ChatSession = {
        id: newSessionId,
        title: title || 'New Conversation',
        messages: [userMessage],
        interactionId: null,
        model: selectedModel,
        updatedAt: Date.now()
      };
      
      setSessions(prev => [newSession, ...prev]);
      setActiveSessionId(newSessionId);
    } else {
      // Append user message immediately to existing session
      previousInteractionId = existingSession.interactionId || null;
      conversationHistory = existingSession.messages.map(m => ({ role: m.role, content: m.content }));
      
      setSessions(prev => prev.map(s => {
        if (s.id === targetSessionId) {
          return {
            ...s,
            messages: [...s.messages, userMessage],
            updatedAt: Date.now()
          };
        }
        return s;
      }));
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
          previous_interaction_id: previousInteractionId,
          history: conversationHistory,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        const aiMessage: Message = { 
          id: `${Date.now()}-ai`, 
          role: 'ai', 
          content: data.response || 'No response returned.' 
        };
        
        setSessions(prev => prev.map(s => {
          if (s.id === targetSessionId) {
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
        console.error('API error response:', data);
        const errorContent = data.details || data.error || 'Unknown error occurred while contacting AI.';
        const errorMessage: Message = { 
          id: `${Date.now()}-err`, 
          role: 'ai', 
          content: `⚠️ Error: ${errorContent}` 
        };
        
        setSessions(prev => prev.map(s => {
          if (s.id === targetSessionId) {
            return {
              ...s,
              messages: [...s.messages, errorMessage],
              interactionId: null,
              updatedAt: Date.now()
            };
          }
          return s;
        }));
      }
    } catch (error: any) {
      console.error('Fetch error:', error);
      const errorMessage: Message = { 
        id: `${Date.now()}-err`, 
        role: 'ai', 
        content: `⚠️ Network error: Could not reach server (${error?.message || 'Check connection'}).` 
      };
      
      setSessions(prev => prev.map(s => {
        if (s.id === targetSessionId) {
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
