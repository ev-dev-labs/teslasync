import { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Bot, Send, User, Sparkles, MessageSquare, Clock, Loader2 } from 'lucide-react';

import { PageContainer } from '@/components/layout/PageContainer';
import { GlassPanel, Button, Input } from '@/components/ui';
import { FadeIn } from '@/components/motion';
import { usePageTitle } from '@/hooks/usePageTitle';
import { formatTime } from '@/lib/dateFormat';
import { cn } from '@/lib/cn';
import { sendChatMessage, getChatHistory, getChatSessions } from '@/api/devtools';
import type { ChatMessage } from '@/api/types';

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const SUGGESTED_QUERIES = [
  'How many vehicles do I have?',
  'Total distance last 30 days',
  'What are my battery levels?',
  'How many drives this week?',
  'Charging cost this month',
  'What was my longest drive?',
  'Top speed record',
  'Tell me about my last drive',
  'Show my geofences',
  'How many alerts do I have?',
];

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function ChatbotPage() {
  const { t } = useTranslation();
  usePageTitle(t('chatbot.title', 'AI Assistant'));

  const [sessionId, setSessionId] = useState('');
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [showSessions, setShowSessions] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  /* ---- queries ---- */
  const { data: sessions = [] } = useQuery({
    queryKey: ['chat-sessions'],
    queryFn: getChatSessions,
  });

  const historyQuery = useQuery({
    queryKey: ['chat-history', sessionId],
    queryFn: () => getChatHistory(sessionId),
    enabled: !!sessionId,
  });

  useEffect(() => {
    if (historyQuery.data) setMessages(historyQuery.data);
  }, [historyQuery.data]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  /* ---- mutation ---- */
  const sendMut = useMutation({
    mutationFn: (message: string) => sendChatMessage(message, sessionId || undefined),
    onSuccess: (data) => {
      if (!sessionId) setSessionId(data.session_id);
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now(),
          session_id: data.session_id,
          role: 'assistant',
          content: data.response,
          created_at: new Date().toISOString(),
        },
      ]);
    },
  });

  /* ---- handlers ---- */
  const handleSend = useCallback(() => {
    const msg = input.trim();
    if (!msg || sendMut.isPending) return;
    setInput('');
    setMessages((prev) => [
      ...prev,
      {
        id: Date.now() - 1,
        session_id: sessionId || 'pending',
        role: 'user',
        content: msg,
        created_at: new Date().toISOString(),
      },
    ]);
    sendMut.mutate(msg);
  }, [input, sendMut, sessionId]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const startNewSession = useCallback(() => {
    setSessionId('');
    setMessages([]);
    inputRef.current?.focus();
  }, []);

  const loadSession = useCallback((sid: string) => {
    setSessionId(sid);
    setShowSessions(false);
  }, []);

  /* ---- render ---- */
  return (
    <PageContainer
      title={t('chatbot.title', 'AI Assistant')}
      subtitle={t('chatbot.subtitle', 'Ask anything about your Tesla fleet')}
      actions={
        <div className="flex items-center gap-2">
          <Button
            onClick={() => setShowSessions(!showSessions)}
            variant="ghost"
            size="sm"
            icon={<Clock className="h-4 w-4" />}
          >
            {t('chatbot.history', 'History')}
          </Button>
          <Button
            onClick={startNewSession}
            variant="secondary"
            size="sm"
            icon={<Sparkles className="h-4 w-4" />}
          >
            {t('chatbot.newChat', 'New Chat')}
          </Button>
        </div>
      }
    >
      <div className="flex flex-1 gap-4 min-h-0" style={{ height: 'calc(100vh - 14rem)' }}>
        {/* Session sidebar */}
        {showSessions && (
          <FadeIn>
            <GlassPanel className="w-60 shrink-0 overflow-y-auto p-3 space-y-1">
              <p className="text-xs font-semibold uppercase tracking-wider px-2 py-1 text-[var(--text-secondary)]">
                {t('chatbot.sessions', 'Sessions')}
              </p>
              {sessions.map((sid) => (
                <Button
                  key={sid}
                  variant="ghost"
                  size="sm"
                  onClick={() => loadSession(sid)}
                  className={cn(
                    'w-full justify-start text-xs truncate',
                    sid === sessionId ? 'bg-purple-500/10 text-purple-400' : '',
                  )}
                >
                  <MessageSquare className="h-3 w-3 mr-2 shrink-0" />
                  {sid}
                </Button>
              ))}
              {sessions.length === 0 && (
                <p className="text-xs px-2 py-4 text-center text-[var(--text-muted)]">
                  {t('chatbot.noSessions', 'No sessions yet')}
                </p>
              )}
            </GlassPanel>
          </FadeIn>
        )}

        {/* Chat area */}
        <GlassPanel className="flex flex-col flex-1 !p-0 overflow-hidden">
          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full space-y-6 py-12">
                <div className="relative">
                  <div className="absolute inset-0 rounded-full bg-purple-500/10 blur-xl scale-150" />
                  <div className="relative rounded-full bg-gradient-to-br from-purple-500/20 to-blue-500/20 p-6 border border-white/5">
                    <Bot className="h-12 w-12 text-purple-400/60" />
                  </div>
                </div>
                <div className="text-center space-y-2">
                  <p className="text-lg font-semibold text-[var(--text-primary)]">
                    {t('chatbot.howCanIHelp', 'How can I help you?')}
                  </p>
                  <p className="text-sm text-[var(--text-secondary)]">
                    {t('chatbot.askAbout', 'Ask about your vehicles, drives, charging, and more')}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 justify-center max-w-lg">
                  {SUGGESTED_QUERIES.slice(0, 6).map((q) => (
                    <Button
                      key={q}
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setInput(q);
                        inputRef.current?.focus();
                      }}
                      className="rounded-full border border-white/5 hover:border-purple-500/20 hover:text-purple-400"
                    >
                      {q}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <FadeIn key={msg.id || i}>
                <div className={cn('flex gap-3', msg.role === 'user' ? 'justify-end' : 'justify-start')}>
                  {msg.role === 'assistant' && (
                    <div className="shrink-0 rounded-lg bg-gradient-to-br from-purple-500/20 to-blue-500/20 p-1.5 h-fit mt-1">
                      <Bot className="h-4 w-4 text-purple-400" />
                    </div>
                  )}
                  <div
                    className={cn(
                      'rounded-2xl px-4 py-3 max-w-[90%] sm:max-w-[80%] text-sm leading-relaxed',
                      msg.role === 'user'
                        ? 'bg-cyan-500/10 border border-cyan-500/20'
                        : 'bg-white/5 border border-white/5',
                    )}
                  >
                    <p className="text-[var(--text-primary)] whitespace-pre-wrap">{msg.content}</p>
                    <p className="text-[10px] mt-2 opacity-40">{formatTime(msg.created_at)}</p>
                  </div>
                  {msg.role === 'user' && (
                    <div className="shrink-0 rounded-lg bg-cyan-500/10 p-1.5 h-fit mt-1">
                      <User className="h-4 w-4 text-cyan-400" />
                    </div>
                  )}
                </div>
              </FadeIn>
            ))}

            {sendMut.isPending && (
              <FadeIn>
                <div className="flex gap-3 items-start">
                  <div className="rounded-lg bg-gradient-to-br from-purple-500/20 to-blue-500/20 p-1.5">
                    <Bot className="h-4 w-4 text-purple-400" />
                  </div>
                  <GlassPanel className="!p-3 flex items-center gap-2">
                    <Loader2 className="h-4 w-4 text-purple-400 animate-spin" />
                    <span className="text-sm text-[var(--text-secondary)]">
                      {t('chatbot.thinking', 'Thinking...')}
                    </span>
                  </GlassPanel>
                </div>
              </FadeIn>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="p-4 border-t" style={{ borderColor: 'var(--glass-border)' }}>
            <div className="flex items-center gap-3">
              <Input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={t('chatbot.placeholder', 'Ask about your fleet...')}
                aria-label={t('chatbot.inputLabel', 'Type a message')}
                className="flex-1"
              />
              <Button
                onClick={handleSend}
                disabled={!input.trim() || sendMut.isPending}
                variant="primary"
                icon={<Send className="h-5 w-5" />}
              />
            </div>
          </div>
        </GlassPanel>
      </div>
    </PageContainer>
  );
}
