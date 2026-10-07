/**
 * In-app summary of `docs/THREAT_MODEL.md` — the exact guarantees and
 * explicit non-guarantees this feature makes, rendered so users don't need
 * to read source to understand the security model. This panel is static
 * content; it never fetches anything.
 */
import { useTranslation } from 'react-i18next';
import { AlertTriangle, ShieldCheck } from 'lucide-react';
import { GlassPanel } from '@/components/ui';
import { Text } from '@/components/ui';
import { InlineCallout } from '@/components/feedback';
import { PACK_CAPABILITY_CATALOG, MANIFEST_LIMITS } from '../lib/manifestTypes';
import { SANDBOX_BUDGETS } from '../lib/sandboxRunner';
import { TrustDistinctionNote } from './TrustDistinctionNote';

export function SecurityMethodologyPanel() {
  const { t } = useTranslation();

  const guarantees = [
    t('intelPacks.security.g1', 'No code execution: never eval, new Function, dynamic import(), or a same-origin iframe. Formulas are interpreted as a closed AST vocabulary, not run as code.'),
    t('intelPacks.security.g2', 'No network requests originate from pack content. Sandbox preview data is a fixed, bundled synthetic dataset compiled into this build.'),
    t('intelPacks.security.g3', 'Signature verification is cryptographic (SHA-256 + Ed25519 via Web Crypto), never a hand-rolled or heuristic check.'),
    t('intelPacks.security.g4', 'No silent weak fallback: if Web Crypto or Ed25519 is unavailable, installation of a signed pack fails explicitly rather than degrading.'),
    t('intelPacks.security.g5', 'Structural resource ceilings on the raw JSON (size, depth, node count, string/array lengths, per-formula AST node count and depth).'),
    t('intelPacks.security.g6', 'Runtime execution budgets bound every sandbox run: a step ceiling, a wall-clock deadline, and row/output-point caps.'),
    t('intelPacks.security.g7', 'Deny-by-default capabilities: the allowlist itself is closed (parse-time reject for anything else), and each capability additionally requires your explicit install-time grant.'),
    t('intelPacks.security.g8', 'A valid signature proves key possession and content integrity — nothing about the publisher\u2019s trustworthiness.'),
    t('intelPacks.security.g9', 'Local-first persistence: installed packs, trust decisions, and the audit log live in IndexedDB (or a documented localStorage fallback) — never a server round-trip.'),
  ];

  const nonGuarantees = [
    t('intelPacks.security.ng1', 'Signature verification does NOT vouch for a publisher\u2019s intentions, competence, or good faith. Anyone can generate a keypair and sign anything with it.'),
    t('intelPacks.security.ng2', 'Canonicalization is a documented, internally-consistent subset of RFC 8785 (JCS) — not a certified, byte-for-byte-interoperable implementation with arbitrary third-party tooling.'),
    t('intelPacks.security.ng3', 'Unsigned packs are unverified by definition. They can be previewed but cannot be enabled without the explicit, clearly-labeled local-development trust flow — a convenience for experimentation, not a security boundary.'),
    t('intelPacks.security.ng4', 'The sandbox proves computational safety, not real-world analytical correctness. A formula can look reasonable against sample data and still be a poor model of real behavior.'),
    t('intelPacks.security.ng5', 'Automation recommendations never execute anything. They are plain strings a human reviews and manually recreates in the Automation Builder.'),
    t('intelPacks.security.ng6', 'Ed25519 support in Web Crypto is a newer browser feature than SHA-256. Older or locked-down browsers, or any non-secure-context origin, cannot install signed packs by design.'),
    t('intelPacks.security.ng7', 'The IndexedDB → localStorage storage fallback is about persistence reliability only; it has no bearing on cryptographic verification.'),
    t('intelPacks.security.ng8', 'Multi-table writes (e.g. install + audit log append) are not cross-table transactional — each table is written atomically on its own.'),
  ];

  return (
    <div className="space-y-6">
      <TrustDistinctionNote />

      <GlassPanel padding="md">
        <Text variant="bodySm" className="font-semibold mb-2 flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-emerald-400" aria-hidden />
          {t('intelPacks.security.guaranteesTitle', 'Guarantees')}
        </Text>
        <ul className="list-disc pl-5 space-y-1.5 text-xs text-[var(--text-secondary)]">
          {guarantees.map((g, i) => (
            <li key={i}>{g}</li>
          ))}
        </ul>
      </GlassPanel>

      <GlassPanel padding="md">
        <Text variant="bodySm" className="font-semibold mb-2 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-400" aria-hidden />
          {t('intelPacks.security.nonGuaranteesTitle', 'Explicit non-guarantees')}
        </Text>
        <ul className="list-disc pl-5 space-y-1.5 text-xs text-[var(--text-secondary)]">
          {nonGuarantees.map((g, i) => (
            <li key={i}>{g}</li>
          ))}
        </ul>
      </GlassPanel>

      <GlassPanel padding="md">
        <Text variant="bodySm" className="font-semibold mb-2">
          {t('intelPacks.security.limitsTitle', 'Resource ceilings & budgets in this build')}
        </Text>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-xs text-[var(--text-secondary)]">
          <div className="flex justify-between border-b border-[var(--border-subtle)] py-1"><dt>{t('intelPacks.security.maxBytes', 'Max envelope size')}</dt><dd>{MANIFEST_LIMITS.maxEnvelopeJsonBytes.toLocaleString()} B</dd></div>
          <div className="flex justify-between border-b border-[var(--border-subtle)] py-1"><dt>{t('intelPacks.security.maxDepth', 'Max JSON depth')}</dt><dd>{MANIFEST_LIMITS.maxJsonDepth}</dd></div>
          <div className="flex justify-between border-b border-[var(--border-subtle)] py-1"><dt>{t('intelPacks.security.maxNodes', 'Max JSON node count')}</dt><dd>{MANIFEST_LIMITS.maxJsonNodeCount.toLocaleString()}</dd></div>
          <div className="flex justify-between border-b border-[var(--border-subtle)] py-1"><dt>{t('intelPacks.security.maxExprNodes', 'Max AST nodes per formula')}</dt><dd>{MANIFEST_LIMITS.maxExprNodesPerFormula}</dd></div>
          <div className="flex justify-between border-b border-[var(--border-subtle)] py-1"><dt>{t('intelPacks.security.maxExprDepth', 'Max AST depth per formula')}</dt><dd>{MANIFEST_LIMITS.maxExprDepth}</dd></div>
          <div className="flex justify-between border-b border-[var(--border-subtle)] py-1"><dt>{t('intelPacks.security.sandboxSteps', 'Max sandbox evaluation steps')}</dt><dd>{SANDBOX_BUDGETS.maxTotalSteps.toLocaleString()}</dd></div>
          <div className="flex justify-between border-b border-[var(--border-subtle)] py-1"><dt>{t('intelPacks.security.sandboxDuration', 'Max sandbox wall-clock time')}</dt><dd>{SANDBOX_BUDGETS.maxDurationMs} ms</dd></div>
          <div className="flex justify-between py-1"><dt>{t('intelPacks.security.sandboxRows', 'Max sandbox sample rows')}</dt><dd>{SANDBOX_BUDGETS.maxRows}</dd></div>
        </dl>
      </GlassPanel>

      <GlassPanel padding="md">
        <Text variant="bodySm" className="font-semibold mb-2">
          {t('intelPacks.security.capabilitiesTitle', 'The complete capability allowlist')}
        </Text>
        <p className="text-xs text-[var(--text-muted)] mb-2">
          {t('intelPacks.security.capabilitiesIntro', 'There is no field for a "write", "command", or "network" capability anywhere in the schema — requesting one is structurally impossible, not merely denied.')}
        </p>
        <ul className="space-y-1.5">
          {PACK_CAPABILITY_CATALOG.map((c) => (
            <li key={c.id} className="text-xs">
              <span className="font-mono text-[var(--text-primary)]">{c.id}</span>
              <span className="text-[var(--text-muted)]"> — {c.description}</span>
            </li>
          ))}
        </ul>
      </GlassPanel>

      <InlineCallout variant="warning" icon={<AlertTriangle />}>
        {t(
          'intelPacks.security.browserNote',
          'Ed25519 in Web Crypto requires a secure context (HTTPS or localhost) and a modern browser (roughly Chrome/Edge 137+, Firefox 130+, Safari 17+ — exact floors vary by OS). Older or locked-down browsers cannot install signed packs; this is by design, not a bug.',
        )}
      </InlineCallout>
    </div>
  );
}
