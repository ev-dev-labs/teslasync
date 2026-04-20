import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Send, AlertTriangle } from 'lucide-react';
import { GlassPanel, Button, Input, Textarea } from '@/components/ui';
import { MethodBadge, type ParsedEndpoint } from './EndpointSidebar';

interface RequestBuilderProps {
  endpoint: ParsedEndpoint;
  onSend: (url: string, method: string, body?: string, headers?: Record<string, string>) => void;
  loading: boolean;
}

export default function RequestBuilder({ endpoint, onSend, loading }: RequestBuilderProps) {
  const { t } = useTranslation();
  const [params, setParams] = useState<Record<string, string>>({});
  const [body, setBody] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Reset state when endpoint changes
  useEffect(() => {
    const defaults: Record<string, string> = {};
    endpoint.parameters.forEach(p => {
      if (p.default != null) defaults[p.name] = String(p.default);
    });
    setParams(defaults);
    setConfirmOpen(false);

    if (endpoint.requestBody?.example) {
      setBody(JSON.stringify(endpoint.requestBody.example, null, 2));
    } else if (endpoint.requestBody) {
      setBody('{\n  \n}');
    } else {
      setBody('');
    }
  }, [endpoint]);

  // Build final URL with path and query params
  const buildUrl = useCallback(() => {
    let url = endpoint.path;
    endpoint.parameters
      .filter(p => p.in === 'path')
      .forEach(p => {
        url = url.replace(`{${p.name}}`, params[p.name] || `{${p.name}}`);
      });

    const queryParts = endpoint.parameters
      .filter(p => p.in === 'query' && params[p.name])
      .map(p => `${p.name}=${encodeURIComponent(params[p.name])}`);

    return queryParts.length > 0 ? `${url}?${queryParts.join('&')}` : url;
  }, [endpoint, params]);

  const isDestructive = endpoint.method !== 'GET';

  const handleSend = () => {
    if (isDestructive && !confirmOpen) {
      setConfirmOpen(true);
      return;
    }
    setConfirmOpen(false);
    const headers: Record<string, string> = {};
    if (apiKey.trim()) {
      headers['X-API-Key'] = apiKey.trim();
    }
    onSend(buildUrl(), endpoint.method, body || undefined, headers);
  };

  const handleCancel = () => setConfirmOpen(false);

  const pathParams = endpoint.parameters.filter(p => p.in === 'path');
  const queryParams = endpoint.parameters.filter(p => p.in === 'query');

  return (
    <div className="space-y-4">
      {/* URL bar */}
      <div className="flex items-center gap-2">
        <MethodBadge method={endpoint.method} className="text-xs !w-14 !py-1" />
        <code className="flex-1 text-sm text-white/80 font-mono bg-white/[0.03] rounded-lg px-3 py-2 border border-white/[0.06] overflow-x-auto whitespace-nowrap">
          /api/v1{buildUrl()}
        </code>
        <Button
          onClick={handleSend}
          disabled={loading}
          className="shrink-0"
        >
          <Send className="h-3.5 w-3.5 mr-1.5" />
          {loading ? t('playground.sending', 'Sending...') : t('playground.send', 'Send')}
        </Button>
      </div>

      {/* Destructive action confirmation */}
      {confirmOpen && (
        <div className="flex items-center gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2.5">
          <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
          <span className="text-xs text-amber-300 flex-1">
            {t('playground.confirmDestructive', 'This is a {{method}} request. Are you sure you want to send it?', { method: endpoint.method })}
          </span>
          <Button onClick={handleSend} className="!text-xs !px-3 !py-1">
            {t('playground.confirmYes', 'Yes, send')}
          </Button>
          <button
            onClick={handleCancel}
            className="text-xs text-white/50 hover:text-white/80 transition-colors"
          >
            {t('playground.cancel', 'Cancel')}
          </button>
        </div>
      )}

      {/* Summary & description */}
      {endpoint.summary && (
        <p className="text-sm text-white/60">{endpoint.summary}</p>
      )}
      {endpoint.description && endpoint.description !== endpoint.summary && (
        <p className="text-xs text-white/40">{endpoint.description}</p>
      )}

      {/* Path parameters */}
      {pathParams.length > 0 && (
        <GlassPanel className="p-4 space-y-3">
          <h4 className="text-xs font-semibold text-white/50 uppercase tracking-wider">
            {t('playground.pathParams', 'Path Parameters')}
          </h4>
          {pathParams.map(p => (
            <div key={p.name} className="flex items-center gap-3">
              <label className="text-xs text-white/50 w-28 font-mono shrink-0">
                {p.name} <span className="text-red-400">*</span>
              </label>
              <Input
                value={params[p.name] ?? ''}
                onChange={e => setParams(prev => ({ ...prev, [p.name]: e.target.value }))}
                placeholder={p.description || p.type}
                className="!text-xs !font-mono !py-1.5 flex-1"
              />
            </div>
          ))}
        </GlassPanel>
      )}

      {/* Query parameters */}
      {queryParams.length > 0 && (
        <GlassPanel className="p-4 space-y-3">
          <h4 className="text-xs font-semibold text-white/50 uppercase tracking-wider">
            {t('playground.queryParams', 'Query Parameters')}
          </h4>
          {queryParams.map(p => (
            <div key={p.name} className="flex items-center gap-3">
              <label className="text-xs text-white/50 w-28 font-mono shrink-0">
                {p.name}
                {p.required && <span className="text-red-400 ml-0.5">*</span>}
              </label>
              <Input
                value={params[p.name] ?? ''}
                onChange={e => setParams(prev => ({ ...prev, [p.name]: e.target.value }))}
                placeholder={p.description || `${p.type}${p.default != null ? ` (default: ${p.default})` : ''}`}
                className="!text-xs !font-mono !py-1.5 flex-1"
              />
            </div>
          ))}
        </GlassPanel>
      )}

      {/* Request body */}
      {endpoint.requestBody && (
        <GlassPanel className="p-4">
          <h4 className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-2">
            {t('playground.requestBody', 'Request Body')}
            <span className="text-white/30 font-normal ml-2">
              {endpoint.requestBody.contentType}
            </span>
          </h4>
          <Textarea
            value={body}
            onChange={e => setBody(e.target.value)}
            rows={8}
            className="!font-mono !text-xs"
            placeholder='{ "key": "value" }'
          />
        </GlassPanel>
      )}

      {/* API Key header (optional) */}
      <GlassPanel className="p-4">
        <h4 className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-2">
          {t('playground.authHeader', 'Authentication (Optional)')}
        </h4>
        <div className="flex items-center gap-3">
          <label className="text-xs text-white/50 w-28 font-mono shrink-0">X-API-Key</label>
          <Input
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder={t('playground.apiKeyPlaceholder', 'Leave empty to use session auth')}
            className="!text-xs !font-mono !py-1.5 flex-1"
            type="password"
          />
        </div>
        <p className="text-[10px] text-white/30 mt-2">
          {t('playground.authHint', 'Requests use your browser session by default. Enter an API key to test key-based auth.')}
        </p>
      </GlassPanel>
    </div>
  );
}
