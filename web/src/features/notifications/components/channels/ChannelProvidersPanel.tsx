/**
 * ChannelProvidersPanel — an at-a-glance reference of every provider TeslaSync
 * can deliver to, annotated with how many channels of each kind the user has
 * configured. Purely derived from the provider catalog + the channels list;
 * it adds no new data source and stays null-safe when channels are absent.
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, GlassPanel, Heading, Text } from '@/components/ui';
import type { NotificationChannel } from '@/api/types';
import { CHANNEL_TYPES } from './channelMeta';

interface ChannelProvidersPanelProps {
  channels: NotificationChannel[];
}

export function ChannelProvidersPanel({ channels }: ChannelProvidersPanelProps) {
  const { t } = useTranslation();

  // Derive per-kind counts + the number of provider types in use once per
  // `channels` change. Guard against a null/kind-less row so a single
  // malformed API entry can't crash the whole reference panel.
  const { counts, inUse } = useMemo(() => {
    const map = new Map<string, number>();
    for (const ch of channels ?? []) {
      if (!ch?.kind) continue;
      map.set(ch.kind, (map.get(ch.kind) ?? 0) + 1);
    }
    const used = CHANNEL_TYPES.reduce(
      (n, p) => n + ((map.get(p.value) ?? 0) > 0 ? 1 : 0),
      0,
    );
    return { counts: map, inUse: used };
  }, [channels]);

  return (
    <GlassPanel className="flex h-full flex-col p-4 sm:p-5">
      <div className="mb-3">
        <Heading level="panel" as="h3">
          {t('notifications.channels.providers.title', 'Supported providers')}
        </Heading>
        <Text as="p" variant="caption" className="mt-0.5">
          {t('notifications.channels.providers.subtitle', '{{inUse}} of {{total}} provider types in use', {
            inUse,
            total: CHANNEL_TYPES.length,
          })}
        </Text>
      </div>

      <ul className="grid list-none grid-cols-1 gap-2 sm:grid-cols-2 2xl:grid-cols-3">
        {CHANNEL_TYPES.map((p) => {
          const Icon = p.icon;
          const count = counts.get(p.value) ?? 0;
          return (
            <li
              key={p.value}
              className="flex items-center gap-3 rounded-lg bg-white/[0.02] p-3 ring-1 ring-white/5"
            >
              <div
                className="shrink-0 rounded-lg p-2 ring-1"
                style={{ background: `${p.color}15`, borderColor: `${p.color}30` }}
              >
                <Icon className="h-4 w-4" style={{ color: p.color }} aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1">
                <Text as="p" variant="body" className="truncate">{p.label}</Text>
                <Text as="p" variant="caption">
                  {count > 0
                    ? t('notifications.channels.providers.configured', '{{count}} configured', { count })
                    : t('notifications.channels.providers.notConfigured', 'Not configured')}
                </Text>
              </div>
              {count > 0 && (
                // Decorative reinforcement of the "{{count}} configured"
                // caption above; hidden from AT to avoid a duplicate reading.
                <Badge variant="success" size="sm" aria-hidden="true">{count}</Badge>
              )}
            </li>
          );
        })}
      </ul>
    </GlassPanel>
  );
}
