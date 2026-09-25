import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { Link, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Button, Drawer, Textarea, Toggle, Text } from '@/components/ui'
import { HelixMark } from '@/components/branding/HelixMark'
import { useAiEnabled } from '@/hooks/useAiEnabled'
import { useAiStream, type AiStreamEvent } from '@/hooks/useAiStream'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { capturePageContext } from '@/lib/pageContext'
import { Icons } from '@/lib/icons'
import { ChatMessageItem, type UIChatMessage } from '@/features/system/components/chatbot/ChatMessageItem'

interface HelixSidePanelProps {
  open: boolean
  onClose: () => void
}

export function HelixSidePanel({ open, onClose }: HelixSidePanelProps) {
  const { t } = useTranslation()
  const { pathname } = useLocation()
  const mobile = useMediaQuery('(max-width: 1279px)')
  const enabled = useAiEnabled('chatbot-llm')
  const [includePage, setIncludePage] = useState(true)
  const [draft, setDraft] = useState('')
  const [messages, setMessages] = useState<UIChatMessage[]>([])
  const [sessionId, setSessionId] = useState(() => `s_${crypto.randomUUID()}`)
  const [request, setRequest] = useState<object | null>(null)
  const [replyId, setReplyId] = useState<number | null>(null)
  const nextId = useRef(0)
  const endRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (open && enabled) inputRef.current?.focus()
  }, [open, enabled])

  useEffect(() => {
    if (!open || mobile) return
    const onEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onEscape)
    return () => window.removeEventListener('keydown', onEscape)
  }, [open, mobile, onClose])

  const handleEvent = useCallback((event: AiStreamEvent) => {
    if (replyId === null) return
    if (event.type === 'delta') {
      setMessages(previous => previous.map(message =>
        message.id === replyId
          ? { ...message, content: message.content + event.text }
          : message,
      ))
    } else if (event.type === 'done' || event.type === 'error') {
      setMessages(previous => previous.map(message =>
        message.id === replyId
          ? {
              ...message,
              isStreaming: false,
              content: event.type === 'error'
                ? `${message.content}\n\n${t('chatbot.aiError', '(AI error: {{message}})', { message: event.message })}`
                : message.content,
            }
          : message,
      ))
      setReplyId(null)
      setRequest(null)
    }
  }, [replyId, t])

  const stream = useAiStream({
    url: '/ai/chatbot',
    body: request,
    onEvent: handleEvent,
    scopeKey: pathname,
  })

  useEffect(() => {
    if (request) stream.start()
    // A request is set only on submit. Do not restart when the stream changes state.
  }, [request])

  useEffect(() => {
    if (stream.state !== 'error' || replyId === null) return
    setMessages(previous => previous.map(message =>
      message.id === replyId
        ? { ...message, isStreaming: false, content: t('chatbot.aiError', '(AI error: {{message}})', { message: stream.error ?? 'stream failed' }) }
        : message,
    ))
    setReplyId(null)
    setRequest(null)
  }, [stream.state, stream.error, replyId, t])

  useEffect(() => {
    stream.cancel()
    setReplyId(null)
    setRequest(null)
    setMessages([])
    setSessionId(`s_${crypto.randomUUID()}`)
    // Scope changes are the only time the panel discards its transcript.
  }, [pathname])

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ block: 'end' })
  }, [open, messages])

  const send = () => {
    const text = draft.trim()
    if (!text || !enabled || request || stream.state === 'streaming') return
    const userId = ++nextId.current
    const assistantId = ++nextId.current
    const created = new Date().toISOString()
    setMessages(previous => [
      ...previous,
      { id: userId, session_id: sessionId, role: 'user', content: text, created_at: created },
      { id: assistantId, session_id: sessionId, role: 'assistant', content: '', created_at: created, isStreaming: true },
    ])
    setReplyId(assistantId)
    setRequest({
      message: text,
      session_id: sessionId,
      ...(includePage ? { page_context: capturePageContext(document, pathname) } : {}),
    })
    setDraft('')
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      send()
    }
  }

  const body = (
    <div className="flex min-h-0 flex-1 flex-col">
      {!enabled ? (
        <div className="m-5 rounded-shape-xl border border-[var(--border-default)] bg-[var(--surface-1)] p-6">
          <HelixMark className="mb-4 h-8 w-8 text-[var(--theme-primary)]" aria-hidden="true" />
          <Text as="p" variant="bodySm" className="mb-3">
            {t('statusBar.helix.disabled', 'Enable Helix Chat in Integrations to ask about this page.')}
          </Text>
          <Link className="text-[var(--theme-primary)] underline" to="/integrations/helix" onClick={onClose}>
            {t('statusBar.helix.configure', 'Configure Helix')}
          </Link>
        </div>
      ) : (
        <>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-5" aria-live="polite">
            {messages.length === 0 && (
              <Text as="p" variant="bodySm" className="text-center">
                {t('statusBar.helix.welcome', 'Ask Helix about the page you are viewing.')}
              </Text>
            )}
            {messages.map((message, index) => (
              <ChatMessageItem
                key={message.id}
                message={message}
                isLastAssistant={false}
                isLastUser={false}
                isFirstInGroup={index === 0 || messages[index - 1]?.role !== message.role}
                isLastInGroup={index === messages.length - 1 || messages[index + 1]?.role !== message.role}
                actionsDisabled
              />
            ))}
            <div ref={endRef} />
          </div>
          <div className="shrink-0 space-y-3 border-t border-[var(--border-default)] bg-[var(--surface-1)] p-4">
            <Toggle
              checked={includePage}
              onChange={setIncludePage}
              label={t('statusBar.helix.includePage', 'Include visible page text')}
              size="sm"
            />
            <Text as="p" variant="caption">
              {t('statusBar.helix.contextHint', 'Only visible page text, not form entries or hidden panels, is sent to your configured AI provider when you ask.')}
            </Text>
            <div className="flex items-end gap-2">
              <Textarea
                ref={inputRef}
                value={draft}
                onChange={event => setDraft(event.target.value)}
                onKeyDown={handleKeyDown}
                rows={2}
                aria-label={t('statusBar.helix.question', 'Ask Helix')}
                placeholder={t('statusBar.helix.placeholder', 'Ask about this page…')}
                className="min-w-0 flex-1"
              />
              <Button
                type="button"
                variant="primary"
                size="sm"
                disabled={!draft.trim() || !!request}
                onClick={send}
              >
                {t('statusBar.helix.send', 'Send')}
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  )

  const dock = typeof document === 'undefined' ? null : document.getElementById('helix-dock-slot')
  return mobile ? (
    <Drawer open={open} onClose={onClose} title={t('statusBar.helix.title', 'Helix chat')} size="md">
      {body}
    </Drawer>
  ) : open && dock ? createPortal(
    <section
      role="complementary"
      aria-label={t('statusBar.helix.title', 'Helix chat')}
      data-role="helix-side-panel"
      className="flex h-full w-[420px] max-w-[40vw] shrink-0 flex-col border-l border-[var(--border-default)] bg-[var(--bg-app)] pb-7"
    >
      <div className="flex h-[4.5rem] shrink-0 items-center justify-between border-b border-[var(--border-default)] bg-[var(--surface-1)] px-5">
        <Text as="h2" variant="bodySm" className="flex items-center gap-2 font-semibold">
          <HelixMark className="h-5 w-5 text-[var(--theme-primary)]" aria-hidden="true" />
          {t('statusBar.helix.title', 'Helix chat')}
        </Text>
        <Button type="button" variant="ghost" size="sm" onClick={onClose} aria-label={t('statusBar.helix.close', 'Close Helix chat')} className="min-h-9 min-w-9 p-0">
          <Icons.close className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
      {body}
    </section>,
    dock,
  ) : null
}
