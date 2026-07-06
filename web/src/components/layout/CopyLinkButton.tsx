import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Link2 } from 'lucide-react';
import { Button } from '../ui/Button';
import { useOptionalToast } from '../feedback/Toast';

/**
 * CopyLinkButton — copies the current URL (path + query string) to the
 * clipboard so users can share a filtered/deep-linked view of the page.
 *
 * Pair with `useUrlState` for the actual filter state.
 *
 * Use sparingly — only on pages where sharing makes sense
 * (filtered Notifications, a Drives date range, a specific Map view).
 * Don't sprinkle this on every page.
 *
 * Toast feedback is resolved via `useOptionalToast` so the button degrades
 * gracefully (no crash) when rendered outside a `<ToastProvider>` — the copy
 * still succeeds, only the transient confirmation toast is skipped.
 */
export function CopyLinkButton() {
  const { t } = useTranslation();
  const toast = useOptionalToast();
  const [copied, setCopied] = useState(false);
  // Track the pending "Copied → idle" reset so we can cancel it on unmount and
  // never call setState on an unmounted component (React warning / stale timer).
  const resetTimer = useRef<number | undefined>(undefined);

  useEffect(
    () => () => {
      if (resetTimer.current !== undefined) window.clearTimeout(resetTimer.current);
    },
    [],
  );

  const handleClick = useCallback(async () => {
    if (typeof window === 'undefined') return;
    const url = window.location.href;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        // Fallback for older browsers / non-secure contexts.
        const ta = document.createElement('textarea');
        ta.value = url;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        let ok = false;
        try {
          ok = document.execCommand('copy');
        } finally {
          document.body.removeChild(ta);
        }
        // execCommand reports failure with a falsy return rather than throwing;
        // surface it so the error toast fires instead of a false "copied".
        if (!ok) throw new Error('execCommand copy failed');
      }
      setCopied(true);
      toast?.success(t('common.copyLink.success', 'Link copied to clipboard'));
      if (resetTimer.current !== undefined) window.clearTimeout(resetTimer.current);
      resetTimer.current = window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast?.error(t('common.copyLink.error', 'Could not copy link'));
    }
  }, [toast, t]);

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      icon={copied ? <Check className="h-3.5 w-3.5" /> : <Link2 className="h-3.5 w-3.5" />}
      onClick={handleClick}
      aria-label={t('common.copyLink.label', 'Copy link to this view')}
    >
      {copied ? t('common.copyLink.copied', 'Copied') : t('common.copyLink.action', 'Copy link')}
    </Button>
  );
}
