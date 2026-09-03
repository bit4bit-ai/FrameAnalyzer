import React, { useState, useRef, useEffect } from 'react';
import styles from './ChatInput.module.css';
import { Attachment } from '@/app/page';

interface Props {
  onSend: (text: string, attachments?: Attachment[]) => void;
  isLoading: boolean;
}

export default function ChatInput({ onSend, isLoading }: Props) {
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [text]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if ((text.trim() || attachments.length > 0) && !isLoading) {
      onSend(text, attachments);
      setText('');
      setAttachments([]);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    Array.from(files).forEach(file => {
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          const base64Data = (event.target.result as string).split(',')[1];
          setAttachments(prev => [...prev, {
            name: file.name,
            type: file.type,
            data: base64Data
          }]);
        }
      };
      reader.readAsDataURL(file);
    });
    
    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const removeAttachment = (index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  };

  const hasContent = text.trim() || attachments.length > 0;

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      {attachments.length > 0 && (
        <div className={styles.previewContainer}>
          {attachments.map((att, i) => (
            <div key={i} className={styles.previewItem}>
              {att.type.startsWith('image/') ? (
                <img src={`data:${att.type};base64,${att.data}`} alt={att.name} className={styles.thumbnail} />
              ) : (
                <div className={styles.docIcon}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" suppressHydrationWarning>
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                    <polyline points="14 2 14 8 20 8"></polyline>
                    <line x1="16" y1="13" x2="8" y2="13"></line>
                    <line x1="16" y1="17" x2="8" y2="17"></line>
                    <polyline points="10 9 9 9 8 9"></polyline>
                  </svg>
                  <span className={styles.docName}>{att.name}</span>
                </div>
              )}
              <button type="button" className={styles.removeBtn} onClick={() => removeAttachment(i)}>×</button>
            </div>
          ))}
        </div>
      )}

      <div className={styles.inputContainer}>
        <button type="button" className={styles.attachButton} onClick={() => fileInputRef.current?.click()}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" suppressHydrationWarning>
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path>
          </svg>
        </button>
        <input 
          type="file" 
          multiple 
          ref={fileInputRef} 
          onChange={handleFileSelect} 
          style={{ display: 'none' }}
          accept="image/*,.pdf,.txt,.csv"
        />

        <textarea
          ref={textareaRef}
          className={styles.textarea}
          placeholder="Ask me anything..."
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isLoading}
          rows={1}
        />
        
        <button 
          type="submit" 
          className={`${styles.sendButton} ${hasContent && !isLoading ? styles.active : ''}`}
          disabled={!hasContent || isLoading}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" suppressHydrationWarning>
            <line x1="22" y1="2" x2="11" y2="13"></line>
            <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
          </svg>
        </button>
      </div>
    </form>
  );
}
