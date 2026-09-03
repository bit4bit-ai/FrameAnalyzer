import React from 'react';
import styles from './ChatMessage.module.css';
import { Message } from '@/app/page';

interface Props {
  message: Message;
}

export default function ChatMessage({ message }: Props) {
  const isUser = message.role === 'user';

  return (
    <div className={`${styles.messageWrapper} ${isUser ? styles.userWrapper : styles.aiWrapper}`}>
      {!isUser && (
        <div className={styles.avatar}>
          ✦
        </div>
      )}
      <div className={`${styles.bubble} ${isUser ? styles.userBubble : styles.aiBubble}`}>
        {message.attachments && message.attachments.length > 0 && (
          <div className={styles.attachmentGrid}>
            {message.attachments.map((att, i) => (
              <div key={i} className={styles.attachmentItem}>
                {att.type.startsWith('image/') ? (
                  <img src={`data:${att.type};base64,${att.data}`} alt={att.name} className={styles.attachedImage} />
                ) : (
                  <div className={styles.attachedDoc}>
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
              </div>
            ))}
          </div>
        )}
        
        {message.content && message.content.split('\n').map((line, i) => (
          <p key={i}>{line}</p>
        ))}
      </div>
    </div>
  );
}
