import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, Button, Heading, Text } from '@/components/ui';
import { cn } from '@/lib/cn';
import {
  COMMANDS,
  type CommandCategory,
  type CommandDef,
} from '../../commands';
import { CollapsibleCommandGroup } from '../CollapsibleCommandGroup';
import {
  COMMAND_DOMAINS,
  type CommandDomainId,
} from './commandDomains';

interface CommandDomainBrowserProps {
  activeDomainId: CommandDomainId;
  vehicleKey: number;
  onDomainChange: (domain: CommandDomainId) => void;
  renderTile: (definition: CommandDef) => ReactNode;
}

const COMMANDS_BY_CATEGORY = new Map<CommandCategory, CommandDef[]>();
for (const command of COMMANDS) {
  const categoryCommands = COMMANDS_BY_CATEGORY.get(command.category) ?? [];
  categoryCommands.push(command);
  COMMANDS_BY_CATEGORY.set(command.category, categoryCommands);
}

export function CommandDomainBrowser({
  activeDomainId,
  vehicleKey,
  onDomainChange,
  renderTile,
}: CommandDomainBrowserProps) {
  const { t } = useTranslation();
  const activeDomain =
    COMMAND_DOMAINS.find((domain) => domain.id === activeDomainId) ??
    COMMAND_DOMAINS[0];
  const activeCount = activeDomain.categories.reduce(
    (total, category) => total + (COMMANDS_BY_CATEGORY.get(category)?.length ?? 0),
    0,
  );

  return (
    <div className="space-y-4">
      <div
        role="tablist"
        aria-label={t('commands.domain.aria', 'Command domains')}
        className="grid grid-cols-2 gap-2 xl:grid-cols-4"
      >
        {COMMAND_DOMAINS.map((domain) => {
          const Icon = domain.icon;
          const selected = domain.id === activeDomain.id;
          return (
            <Button
              key={domain.id}
              type="button"
              role="tab"
              size="lg"
              variant={selected ? 'secondary' : 'ghost'}
              aria-selected={selected}
              aria-controls={`command-domain-${domain.id}`}
              onClick={() => onDomainChange(domain.id)}
              className={cn(
                'h-auto min-h-12 justify-start px-3 text-left',
                selected && 'border-cyan-400/30 bg-cyan-500/10',
              )}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              <Text size="xs" weight="semibold">
                {t(domain.labelKey, domain.labelFallback)}
              </Text>
            </Button>
          );
        })}
      </div>

      <div
        id={`command-domain-${activeDomain.id}`}
        role="tabpanel"
        className="space-y-3 rounded-xl border border-[var(--border-subtle)] bg-white/[0.02] p-3 sm:p-4"
      >
        <div className="flex flex-col gap-1 border-b border-[var(--border-subtle)] pb-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <Heading level="panel">
              {t(activeDomain.labelKey, activeDomain.labelFallback)}
            </Heading>
            <Text as="p" size="xs" color="muted" className="mt-1">
              {t(activeDomain.descriptionKey, activeDomain.descriptionFallback)}
            </Text>
          </div>
          <Badge variant="info" className="self-start">
            {t('commands.workspace.domainCount', '{{count}} actions', {
              count: activeCount,
            })}
          </Badge>
        </div>

        {activeDomain.categories.map((category, index) => {
          const commands = COMMANDS_BY_CATEGORY.get(category) ?? [];
          return (
            <CollapsibleCommandGroup
              key={category}
              category={category}
              vehicleKey={vehicleKey}
              count={commands.length}
              defaultOpen={index === 0}
            >
              {commands.map(renderTile)}
            </CollapsibleCommandGroup>
          );
        })}
      </div>
    </div>
  );
}
