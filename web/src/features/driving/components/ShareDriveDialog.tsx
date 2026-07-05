import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Trash2, Eye, ExternalLink } from 'lucide-react';
import { Modal, Button, CopyButton, Toggle, Select, Input } from '@/components/ui';
import { GlassPanel } from '@/components/ui';
import { Spinner, AlertBanner } from '@/components/feedback';
import { useCreateShareLink, useShareLinks, useRevokeShareLink } from '@/api/hooks/useSharing';
import { formatDate } from '@/lib/dateFormat';

interface ShareDriveDialogProps {
  driveId: string;
  open: boolean;
  onClose: () => void;
}

export function ShareDriveDialog({ driveId, open, onClose }: ShareDriveDialogProps) {
  const { t } = useTranslation();
  const createShare = useCreateShareLink(driveId);
  const { data: existingShares, isLoading: sharesLoading, error: sharesError } = useShareLinks(driveId);
  const revokeShare = useRevokeShareLink(driveId);

  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [includeSpeed, setIncludeSpeed] = useState(true);
  const [includeTelemetry, setIncludeTelemetry] = useState(false);
  const [expiryDays, setExpiryDays] = useState('30');
  const [title, setTitle] = useState('');

  const expiryOptions = useMemo(
    () => [
      { value: '7', label: t('share.expiry7d', '7 days') },
      { value: '30', label: t('share.expiry30d', '30 days') },
      { value: '90', label: t('share.expiry90d', '90 days') },
      { value: '0', label: t('share.expiryNever', 'Never') },
    ],
    [t],
  );

  const handleCreate = async () => {
    try {
      const result = await createShare.mutateAsync({
        title: title.trim() || undefined,
        include_speed: includeSpeed,
        include_telemetry: includeTelemetry,
        expires_in_days: Number(expiryDays) || undefined,
      });
      // Guard a malformed success (no token) so we never build a broken
      // "/s/undefined" link — stay on the form for the user to retry.
      if (result?.token) {
        setShareUrl(`${window.location.origin}/s/${result.token}`);
      }
    } catch {
      // useCreateShareLink.onError already surfaces a toast; swallow the
      // rejection so this click handler doesn't raise an unhandled promise
      // rejection and the form stays interactive.
    }
  };

  const handleRevoke = async (token: string) => {
    try {
      await revokeShare.mutateAsync(token);
    } catch {
      // useRevokeShareLink.onError already notifies; keep the list usable.
    }
  };

  const handleClose = () => {
    setShareUrl(null);
    setTitle('');
    onClose();
  };

  const shares = existingShares ?? [];

  return (
    <Modal open={open} onClose={handleClose} title={t('share.title', 'Share Drive')}>
      <div className="space-y-6">
        {/* Create new share */}
        {!shareUrl ? (
          <div className="space-y-4">
            <p className="text-sm text-[var(--text-secondary)]">
              {t('share.description', 'Generate a public link to share this drive report. Anyone with the link can view the map, stats, and charts — no login required.')}
            </p>

            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('share.titlePlaceholder', 'Optional title (e.g., "SF to LA Road Trip")')}
              aria-label={t('share.titleLabel', 'Share title')}
            />

            <Toggle
              label={t('share.includeSpeed', 'Include speed data')}
              checked={includeSpeed}
              onChange={setIncludeSpeed}
            />
            <Toggle
              label={t('share.includeTelemetry', 'Include detailed telemetry (battery, power)')}
              checked={includeTelemetry}
              onChange={setIncludeTelemetry}
            />

            <Select
              label={t('share.expiry', 'Link expires after')}
              value={expiryDays}
              onChange={(e) => setExpiryDays(e.target.value)}
              options={expiryOptions}
            />

            <Button onClick={handleCreate} loading={createShare.isPending} className="w-full">
              <Link className="h-4 w-4 mr-2" />
              {t('share.generate', 'Generate Link')}
            </Button>
          </div>
        ) : (
          /* Share URL result */
          <div className="space-y-3">
            <p className="text-sm text-green-400">
              {t('share.created', 'Share link created!')}
            </p>
            <Input value={shareUrl} readOnly aria-label={t('share.linkLabel', 'Share link URL')} />
            <div className="flex gap-2">
              <CopyButton
                text={shareUrl}
                variant="primary"
                size="md"
                withToast
                label={t('share.copy', 'Copy Link')}
                className="flex-1"
              />
              <Button
                variant="outline"
                onClick={() => window.open(shareUrl, '_blank', 'noopener,noreferrer')}
                aria-label={t('share.openLink', 'Open link in a new tab')}
              >
                <ExternalLink className="h-4 w-4" />
              </Button>
            </div>
            <Button variant="ghost" onClick={() => setShareUrl(null)} className="w-full">
              {t('share.createAnother', 'Create another link')}
            </Button>
          </div>
        )}

        {/* Existing shares — always rendered with explicit loading / error /
            empty / list states so the section is never a blank void. */}
        <div className="space-y-2 border-t border-[var(--border-subtle)] pt-4">
          <h3 className="text-sm font-medium text-[var(--text-secondary)]">
            {t('share.existing', 'Active Share Links')}
          </h3>
          {sharesLoading ? (
            <div className="flex justify-center py-4">
              <Spinner className="h-5 w-5" />
            </div>
          ) : sharesError ? (
            <AlertBanner variant="danger" role="alert">
              {t('share.loadError', 'Could not load your existing share links. Please try again.')}
            </AlertBanner>
          ) : shares.length > 0 ? (
            <div className="space-y-2">
              {shares.map((share) => {
                const isExpired = share.expires_at
                  ? new Date(share.expires_at) < new Date()
                  : false;
                return (
                  <GlassPanel key={share.id} className="p-3 flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-[var(--text-primary)] truncate">
                        {share.title ?? t('share.untitled', 'Untitled share')}
                      </p>
                      <div className="flex items-center gap-3 text-xs text-[var(--text-muted)]">
                        <span className="flex items-center gap-1">
                          <Eye className="h-3 w-3" />
                          {share.views ?? 0} {t('share.views', 'views')}
                        </span>
                        <span>
                          {isExpired
                            ? t('share.expired', 'Expired')
                            : share.expires_at
                              ? t('share.expiresOn', 'Expires {{date}}', { date: formatDate(share.expires_at) })
                              : t('share.noExpiry', 'No expiry')}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <CopyButton
                        text={`${window.location.origin}/s/${share.token}`}
                        variant="ghost"
                        size="sm"
                        iconOnly
                        withToast
                        ariaLabel={t('share.copyLink', 'Copy link')}
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRevoke(share.token)}
                        aria-label={t('share.revoke', 'Revoke')}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-red-400" />
                      </Button>
                    </div>
                  </GlassPanel>
                );
              })}
            </div>
          ) : (
            <p className="py-2 text-center text-sm text-[var(--text-muted)]">
              {t('share.none', 'No active share links yet.')}
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
}
