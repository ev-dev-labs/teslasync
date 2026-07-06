import { useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  KeyRound,
  Radio,
  BookOpen,
  ShieldCheck,
  ChevronRight,
  ExternalLink,
} from 'lucide-react';

import { GlassPanel, IconBox, PanelTitle, Text } from '@/components/ui';
import { VisuallyHidden } from '@/components/a11y';
import { cn } from '@/lib/cn';
import { type NeonColor } from '@/lib/tokens';

interface ResourceLink {
  key: string;
  icon: ReactNode;
  color: NeonColor;
  title: string;
  desc: string;
  /** Internal SPA route (react-router). Mutually exclusive with `href`. */
  to?: string;
  /** External document link opened in a new tab. */
  href?: string;
}

const rowClasses = cn(
  'group flex min-h-[44px] items-center gap-3 rounded-xl border border-[var(--border-subtle)]',
  'bg-white/[0.02] p-3 transition-colors hover:border-cyan-400/30 hover:bg-white/[0.04]',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50',
);

/**
 * Resources & help side panel for the onboarding page.
 *
 * Elevates the original footer help links into a first-class panel:
 * the Tesla account page, the Fleet Telemetry setup guide, and the
 * documentation — plus a privacy reassurance note. Internal links use
 * the SPA router; external doc links open in a new tab.
 */
export function OnboardingResources({ className }: { className?: string }) {
  const { t } = useTranslation();

  const links = useMemo<ResourceLink[]>(
    () => [
    {
      key: 'account',
      icon: <KeyRound className="h-4 w-4" aria-hidden="true" />,
      color: 'cyan',
      title: t('onboarding.resources.account.title', 'Tesla account'),
      desc: t('onboarding.resources.account.desc', 'Connect or manage your Fleet API access.'),
      to: '/tesla-account',
    },
    {
      key: 'guide',
      icon: <Radio className="h-4 w-4" aria-hidden="true" />,
      color: 'green',
      title: t('onboarding.resources.guide.title', 'Fleet Telemetry setup guide'),
      desc: t('onboarding.resources.guide.desc', 'Configure streaming so live data starts arriving.'),
      href: '/docs/fleet-telemetry-setup',
    },
    {
      key: 'docs',
      icon: <BookOpen className="h-4 w-4" aria-hidden="true" />,
      color: 'purple',
      title: t('onboarding.resources.docs.title', 'Documentation'),
      desc: t('onboarding.resources.docs.desc', 'Guides, reference, and troubleshooting.'),
      href: '/docs/',
    },
    ],
    [t],
  );

  return (
    <GlassPanel className={cn('p-4 sm:p-5', className)}>
      <PanelTitle className="mb-3">
        {t('onboarding.resources.title', 'Resources & help')}
      </PanelTitle>

      <nav aria-label={t('onboarding.resources.title', 'Resources & help')}>
        <ul className="space-y-2.5">
          {links.map((link) => {
            const body = (
              <>
                <IconBox color={link.color} size="sm">
                  {link.icon}
                </IconBox>
                <span className="min-w-0 flex-1">
                  <Text as="span" size="sm" weight="medium" color="primary" className="block truncate">
                    {link.title}
                  </Text>
                  <Text variant="caption" as="span" className="block">
                    {link.desc}
                  </Text>
                </span>
                {link.href ? (
                  <>
                    <ExternalLink
                      aria-hidden="true"
                      className="h-4 w-4 shrink-0 text-[var(--text-muted)] transition-colors group-hover:text-cyan-300"
                    />
                    <VisuallyHidden>
                      {t('onboarding.resources.newTab', '(opens in a new tab)')}
                    </VisuallyHidden>
                  </>
                ) : (
                  <ChevronRight
                    aria-hidden="true"
                    className="h-4 w-4 shrink-0 text-[var(--text-muted)] transition-colors group-hover:text-cyan-300"
                  />
                )}
              </>
            );

            return (
              <li key={link.key}>
                {link.to ? (
                  <Link to={link.to} className={rowClasses}>
                    {body}
                  </Link>
                ) : (
                  <a
                    href={link.href}
                    target="_blank"
                    rel="noreferrer noopener"
                    className={rowClasses}
                  >
                    {body}
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-emerald-400/20 bg-emerald-500/[0.06] p-3">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" aria-hidden="true" />
        <Text variant="caption" as="p">
          {t(
            'onboarding.resources.privacy',
            'TeslaSync runs entirely on your hardware. No data ever leaves your install.',
          )}
        </Text>
      </div>
    </GlassPanel>
  );
}
