import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout/PageContainer';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Spinner } from '@/components/feedback/Spinner';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

const SUGGESTIONS = [
  'What is my current battery level?',
  'How many miles did I drive this week?',
  'Show me my charging history',
  'What is my most efficient drive?',
  'When was my last software update?',
  'How much have I spent on charging?',
];

export default function ChatbotPage() {
  const { t } = useTranslation();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function sendMessage(text: string) {
    if (!text.trim()) return;
    const userMsg: Message = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: text.trim(),
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    // Simulated bot response
    setTimeout(() => {
      const botMsg: Message = {
        id: `a-${Date.now()}`,
        role: 'assistant',
        content: `I received your query: "${text.trim()}". This is a placeholder response — connect to your AI backend for real answers.`,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, botMsg]);
      setLoading(false);
    }, 1000);
  }

  return (
    <PageContainer title={t('AI Assistant')} subtitle={t('Ask anything about your Tesla fleet')}>
      <Card className="flex flex-col h-[600px]">
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 && (
            <div className="text-center py-12 space-y-4">
              <p className="text-2xl font-bold">{t('How can I help you?')}</p>
              <div className="flex flex-wrap gap-2 justify-center max-w-md mx-auto">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => sendMessage(s)}
                    className="text-xs px-3 py-1.5 rounded-full border border-gray-700 hover:border-cyan-400 text-gray-300 hover:text-cyan-300 transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[75%] rounded-lg px-4 py-2 ${
                  msg.role === 'user'
                    ? 'bg-cyan-500/20 text-cyan-100'
                    : 'bg-gray-800 text-gray-200'
                }`}
              >
                <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                <p className="text-xs text-gray-500 mt-1">
                  {new Date(msg.timestamp).toLocaleTimeString()}
                </p>
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex justify-start">
              <div className="bg-gray-800 rounded-lg px-4 py-2">
                <Spinner size="sm" label={t('Thinking...')} />
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        <div className="border-t border-gray-700 p-3 flex gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage(input);
              }
            }}
            placeholder={t('Ask about your fleet...')}
            className="flex-1"
          />
          <Button variant="primary" disabled={!input.trim() || loading} onClick={() => sendMessage(input)}>
            {t('Send')}
          </Button>
        </div>
      </Card>
    </PageContainer>
  );
}
