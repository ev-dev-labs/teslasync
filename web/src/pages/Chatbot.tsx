import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { Bot, Send, User, Sparkles, MessageSquare, Clock, Loader2 } from 'lucide-react'
import clsx from 'clsx'
import { sendChatMessage, getChatHistory, getChatSessions, ChatMessage } from '../api'

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
]

export default function Chatbot() {
  const [sessionId, setSessionId] = useState<string>('')
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [showSessions, setShowSessions] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const { data: sessions = [] } = useQuery({
    queryKey: ['chat-sessions'],
    queryFn: getChatSessions,
  })

  const historyQuery = useQuery({
    queryKey: ['chat-history', sessionId],
    queryFn: () => getChatHistory(sessionId),
    enabled: !!sessionId,
  })

  useEffect(() => {
    if (historyQuery.data) {
      setMessages(historyQuery.data)
    }
  }, [historyQuery.data])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const sendMut = useMutation({
    mutationFn: (message: string) => sendChatMessage(message, sessionId || undefined),
    onSuccess: (data) => {
      if (!sessionId) setSessionId(data.session_id)
      setMessages(prev => [...prev, {
        id: Date.now(),
        session_id: data.session_id,
        role: 'assistant',
        content: data.response,
        created_at: new Date().toISOString(),
      }])
    },
  })

  const handleSend = () => {
    const msg = input.trim()
    if (!msg || sendMut.isPending) return
    setInput('')

    // Add user message immediately
    setMessages(prev => [...prev, {
      id: Date.now() - 1,
      session_id: sessionId || 'pending',
      role: 'user',
      content: msg,
      created_at: new Date().toISOString(),
    }])

    sendMut.mutate(msg)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const startNewSession = () => {
    setSessionId('')
    setMessages([])
    inputRef.current?.focus()
  }

  const loadSession = (sid: string) => {
    setSessionId(sid)
    setShowSessions(false)
  }

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)]">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="absolute inset-0 rounded-xl bg-neon-purple/20 blur-md" />
            <div className="relative rounded-xl bg-gradient-to-br from-neon-purple/80 to-neon-blue/80 p-2.5">
              <Bot className="h-6 w-6 text-[var(--text-primary)]" />
            </div>
          </div>
          <div>
            <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>AI Assistant</h1>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Ask anything about your Tesla fleet</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowSessions(!showSessions)}
            className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium bg-white/5 hover:bg-white/10 transition-colors"
            style={{ color: 'var(--text-secondary)' }}
          >
            <Clock className="h-4 w-4" /> History
          </button>
          <button
            onClick={startNewSession}
            className="flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium bg-neon-purple/10 text-neon-purple hover:bg-neon-purple/20 border border-neon-purple/20 transition-colors"
          >
            <Sparkles className="h-4 w-4" /> New Chat
          </button>
        </div>
      </div>

      <div className="flex flex-1 gap-4 min-h-0">
        {/* Session sidebar */}
        <AnimatePresence>
          {showSessions && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 240, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              className="glass-card !p-3 overflow-y-auto shrink-0 space-y-1"
            >
              <p className="text-xs font-semibold uppercase tracking-wider px-2 py-1" style={{ color: 'var(--text-secondary)' }}>Sessions</p>
              {sessions.map(sid => (
                <button
                  key={sid}
                  onClick={() => loadSession(sid)}
                  className={clsx(
                    'w-full text-left rounded-lg px-3 py-2 text-xs truncate transition-colors',
                    sid === sessionId ? 'bg-neon-purple/10 text-neon-purple' : 'hover:bg-white/5'
                  )}
                  style={{ color: sid === sessionId ? undefined : 'var(--text-secondary)' }}
                >
                  <MessageSquare className="h-3 w-3 inline mr-2" />
                  {sid}
                </button>
              ))}
              {sessions.length === 0 && (
                <p className="text-xs px-2 py-4 text-center" style={{ color: 'var(--text-tertiary)' }}>No sessions yet</p>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Chat area */}
        <div className="flex flex-col flex-1 glass-card !p-0 overflow-hidden">
          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full space-y-6 py-12">
                <div className="relative">
                  <div className="absolute inset-0 rounded-full bg-neon-purple/10 blur-xl scale-150" />
                  <div className="relative rounded-full bg-gradient-to-br from-neon-purple/20 to-neon-blue/20 p-6 border border-white/5">
                    <Bot className="h-12 w-12 text-neon-purple/60" />
                  </div>
                </div>
                <div className="text-center space-y-2">
                  <p className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>How can I help you?</p>
                  <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Ask about your vehicles, drives, charging, and more</p>
                </div>

                {/* Suggested queries */}
                <div className="flex flex-wrap gap-2 justify-center max-w-lg">
                  {SUGGESTED_QUERIES.slice(0, 6).map(q => (
                    <button
                      key={q}
                      onClick={() => { setInput(q); inputRef.current?.focus() }}
                      className="rounded-full px-3 py-1.5 text-xs font-medium bg-white/5 hover:bg-neon-purple/10 hover:text-neon-purple border border-white/5 hover:border-neon-purple/20 transition-all"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <motion.div
                key={msg.id || i}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={clsx('flex gap-3', msg.role === 'user' ? 'justify-end' : 'justify-start')}
              >
                {msg.role === 'assistant' && (
                  <div className="shrink-0 rounded-lg bg-gradient-to-br from-neon-purple/20 to-neon-blue/20 p-1.5 h-fit mt-1">
                    <Bot className="h-4 w-4 text-neon-purple" />
                  </div>
                )}
                <div
                  className={clsx(
                    'rounded-2xl px-4 py-3 max-w-[90%] sm:max-w-[80%] text-sm leading-relaxed',
                    msg.role === 'user'
                      ? 'bg-neon-cyan/10 border border-neon-cyan/20'
                      : 'bg-white/5 border border-white/5'
                  )}
                  style={{ color: 'var(--text-primary)' }}
                >
                  {msg.role === 'assistant' ? (
                    <div className="prose prose-sm prose-invert max-w-none" dangerouslySetInnerHTML={{ __html: formatMarkdown(msg.content) }} />
                  ) : (
                    msg.content
                  )}
                  <p className="text-[10px] mt-2 opacity-40">{new Date(msg.created_at).toLocaleTimeString()}</p>
                </div>
                {msg.role === 'user' && (
                  <div className="shrink-0 rounded-lg bg-neon-cyan/10 p-1.5 h-fit mt-1">
                    <User className="h-4 w-4 text-neon-cyan" />
                  </div>
                )}
              </motion.div>
            ))}

            {sendMut.isPending && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex gap-3 items-start">
                <div className="rounded-lg bg-gradient-to-br from-neon-purple/20 to-neon-blue/20 p-1.5">
                  <Bot className="h-4 w-4 text-neon-purple" />
                </div>
                <div className="glass-card !p-3 flex items-center gap-2">
                  <Loader2 className="h-4 w-4 text-neon-purple animate-spin" />
                  <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>Thinking...</span>
                </div>
              </motion.div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="p-4 border-t" style={{ borderColor: 'var(--glass-border)' }}>
            <div className="flex items-center gap-3">
              <input
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask about your fleet..."
                className="flex-1 rounded-xl border px-4 py-3 text-sm outline-none transition-colors focus:border-neon-purple/50"
                style={{ background: 'var(--surface-2)', borderColor: 'var(--glass-border)', color: 'var(--text-primary)' }}
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || sendMut.isPending}
                className="rounded-xl p-3 bg-gradient-to-r from-neon-purple/80 to-neon-blue/80 text-[var(--text-primary)] hover:from-neon-purple hover:to-neon-blue transition-all disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <Send className="h-5 w-5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Simple markdown formatter for bold and newlines */
function formatMarkdown(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^- /gm, '&bull; ')
    .replace(/\n/g, '<br/>')
}
