// Native parity port of web/src/components/data-display/UsageCard.tsx.
//
// UsageCard is the shared "spend / volume" presentational primitive: an
// optional budget bar, three at-a-glance bands, a key/value detail grid,
// optional top-list breakdowns, an optional banner, and optional footer
// links. It stays pure presentational — every dynamic value arrives via props
// so the card is trivially testable. The browser-only dependencies have no
// place in the native parity tree, so they are reproduced natively:
//   - react-router-dom `<Link>` / `<a target="_blank">` -> a Pressable that
//     calls the new `onNavigate(href)` bridge prop. The `to` path and the
//     `external` flag are preserved verbatim on UsageCardFooterLink (external
//     drives the a11y hint; new-tab semantics do not exist on native).
//   - lucide `AlertTriangle` (banner) / `ExternalLink` (footer) -> the native
//     SemanticIcon glyph table ('warning' / 'externalLink'), rendered as text.
//   - Tailwind utility classes / CSS `var(--text-*)` -> StyleSheet + theme
//     tokens. The `className` passthrough is retained for source compatibility
//     but ignored on native.
// ReactNode props (label/value/sub/headline/title/...) stay ReactNode: a bare
// string/number cannot be a child on native, so each is wrapped in AppText
// while element values render as-is. See the .parity.json sidecar for the
// line-by-line source map.

import React, {type ReactNode} from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import {getSemanticIconDefinition} from '../../../components/icons/SemanticIcon';
import {AppText} from '../../../components/ui/AppText';
import {colors} from '../../../theme/tokens';

/** Visual intent driving accent colour for bars / banners / values. */
export type UsageCardIntent = 'normal' | 'warn' | 'danger';

/**
 * One at-a-glance band rendered in the band stack below the budget bar. Icon
 * is rendered to the left of the label; value is the large tabular-numeric
 * headline; sub is the small grey subtitle line.
 */
export interface UsageCardBand {
  icon?: ReactNode;
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  /** Adds a coloured ring + tinted background. Default 'normal'. */
  intent?: UsageCardIntent;
}

/**
 * One key/value cell rendered in the 2-column detail grid below the bands.
 * Used for "useful requests / skipped polls / avg latency / error rate"-style
 * tabular pairs.
 */
export interface UsageCardDetail {
  label: ReactNode;
  value: ReactNode;
  /** Colours the value text — e.g. red for high error rates. */
  intent?: UsageCardIntent;
}

/**
 * One row in a top-list breakdown. label is the left-aligned name (rendered in
 * a monospace font), value is the right-aligned count.
 */
export interface UsageCardTopListItem {
  key: string;
  label: ReactNode;
  value: ReactNode;
}

/**
 * One top-list block rendered in the block stack below the detail grid. Each
 * block has its own header + list.
 */
export interface UsageCardTopList {
  key: string;
  icon?: ReactNode;
  title: ReactNode;
  items: UsageCardTopListItem[];
}

/**
 * Optional budget progress bar. The card hides this section entirely if budget
 * is undefined, so consumers without a "spend cap" concept skip the bar.
 */
export interface UsageCardBudget {
  /** Pre-formatted "spent of total" headline, e.g. "$0.42 of $5.00". */
  headline: ReactNode;
  /** Right-side caption, e.g. "8% of monthly credit". */
  rightLabel?: ReactNode;
  /** Caption under the bar, e.g. "Day 5 of 30 · resets in 25 days". */
  caption?: ReactNode;
  /** 0..100 used for bar width AND the accessibility value. */
  pct: number;
  /** Visual intent — drives bar colour. */
  intent?: UsageCardIntent;
  /** Required for screen readers — short label naming the budget. */
  ariaLabel: string;
}

/**
 * Optional callout banner rendered after the top-lists, before the footer.
 * Defaults to danger intent (red) since most call-outs are warnings.
 */
export interface UsageCardBanner {
  title: ReactNode;
  description: ReactNode;
  intent?: UsageCardIntent;
  /** Optional trailing icon override; defaults to a warning glyph. */
  icon?: ReactNode;
}

/**
 * One footer link. The `external` flag is preserved from the web source where
 * it switched `<Link>` for `<a target="_blank">`; on native both navigate via
 * the `onNavigate` bridge and `external` only adjusts the accessibility hint.
 */
export interface UsageCardFooterLink {
  key: string;
  to: string;
  label: ReactNode;
  /** Renders as the primary (filled) variant; default secondary. */
  primary?: boolean;
  /** Source-of-truth external flag; informs the a11y hint on native. */
  external?: boolean;
}

export interface UsageCardProps {
  budget?: UsageCardBudget;
  bands?: UsageCardBand[];
  details?: UsageCardDetail[];
  topLists?: UsageCardTopList[];
  banner?: UsageCardBanner;
  footer?: UsageCardFooterLink[];
  /** Rendered when nothing else is — keeps the panel from being blank. */
  emptyMessage?: ReactNode;
  /**
   * Native navigation bridge invoked with a footer link's `to` path when it is
   * pressed. Replaces the web react-router `<Link>` / external anchor. No-op
   * when omitted.
   */
  onNavigate?: (href: string) => void;
  /** Web Tailwind override retained for source compatibility; ignored on native. */
  className?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  'data-testid'?: string;
  accessibilityLabel?: string;
}

// ----------------------------------------------------------------------------
// Visual helpers (native translation of the web Tailwind intent maps)
// ----------------------------------------------------------------------------

/** Bar fill: cyan/amber/red-500 at 70% (web `bg-{c}-500/70`). */
const INTENT_BAR_BG: Record<UsageCardIntent, string> = {
  normal: 'rgba(6, 182, 212, 0.7)',
  warn: 'rgba(245, 158, 11, 0.7)',
  danger: 'rgba(239, 68, 68, 0.7)',
};

/** Band ring + tint (web `intentBandRing`). */
const INTENT_BAND_RING: Record<UsageCardIntent, ViewStyle> = {
  normal: {backgroundColor: 'rgba(255, 255, 255, 0.03)'},
  warn: {
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    borderColor: 'rgba(245, 158, 11, 0.3)',
    borderWidth: 1,
  },
  danger: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderColor: 'rgba(239, 68, 68, 0.3)',
    borderWidth: 1,
  },
};

/** Value text colour (web `intentValueText`). */
const INTENT_VALUE_TEXT: Record<UsageCardIntent, string> = {
  normal: colors.textPrimary,
  warn: '#fcd34d', // amber-300
  danger: '#f87171', // red-400
};

/** Banner surface + border (web `intentBannerBg`). */
const INTENT_BANNER_BG: Record<UsageCardIntent, ViewStyle> = {
  normal: {
    backgroundColor: 'rgba(6, 182, 212, 0.1)',
    borderColor: 'rgba(6, 182, 212, 0.3)',
    borderWidth: 1,
  },
  warn: {
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    borderColor: 'rgba(245, 158, 11, 0.3)',
    borderWidth: 1,
  },
  danger: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderColor: 'rgba(239, 68, 68, 0.3)',
    borderWidth: 1,
  },
};

/** Banner title/icon colour (web container `text-{c}-200/100`). */
const INTENT_BANNER_TEXT: Record<UsageCardIntent, string> = {
  normal: '#a5f3fc', // cyan-200
  warn: '#fef3c7', // amber-100
  danger: '#fecaca', // red-200
};

/** Banner description colour (web `intentBannerDescription`). */
const INTENT_BANNER_DESC: Record<UsageCardIntent, string> = {
  normal: 'rgba(103, 232, 249, 0.8)', // cyan-300/80
  warn: 'rgba(253, 230, 138, 0.8)', // amber-200/80
  danger: 'rgba(252, 165, 165, 0.8)', // red-300/80
};

const FOOTER_PRIMARY_TEXT = '#a5f3fc'; // cyan-200
const FOOTER_SECONDARY_TEXT = '#67e8f9'; // cyan-300

const WARNING_GLYPH = getSemanticIconDefinition('warning').glyph;
const EXTERNAL_LINK_GLYPH = getSemanticIconDefinition('externalLink').glyph;

/**
 * Renders a ReactNode that may be a bare string/number. Native text cannot be
 * a bare child, so primitives are wrapped in AppText (honoring `style`) while
 * elements render as-is (they carry their own styling).
 */
function renderNode(node: ReactNode, style?: StyleProp<TextStyle>): ReactNode {
  if (node === null || node === undefined || node === false || node === true) {
    return null;
  }
  if (typeof node === 'string' || typeof node === 'number') {
    return <AppText style={style}>{node}</AppText>;
  }
  return node;
}

// ----------------------------------------------------------------------------
// Component
// ----------------------------------------------------------------------------

export function UsageCard({
  budget,
  bands,
  details,
  topLists,
  banner,
  footer,
  emptyMessage,
  onNavigate,
  className: _className,
  style,
  testID,
  'data-testid': dataTestID,
  accessibilityLabel,
}: UsageCardProps) {
  const hasAnything =
    !!budget ||
    (bands && bands.length > 0) ||
    (details && details.length > 0) ||
    (topLists && topLists.length > 0) ||
    !!banner ||
    (footer && footer.length > 0);

  if (!hasAnything) {
    const message = emptyMessage ?? 'No data to display yet.';
    return (
      <View
        accessibilityLabel={accessibilityLabel}
        style={style}
        testID={testID ?? dataTestID ?? 'usage-card-empty'}>
        {renderNode(message, styles.empty)}
      </View>
    );
  }

  return (
    <View
      accessibilityLabel={accessibilityLabel}
      style={[styles.root, style]}
      testID={testID ?? dataTestID ?? 'usage-card'}>
      {budget ? <BudgetSection budget={budget} /> : null}

      {bands && bands.length > 0 ? <BandsSection bands={bands} /> : null}

      {details && details.length > 0 ? (
        <DetailsSection details={details} />
      ) : null}

      {topLists && topLists.length > 0 ? (
        <TopListsSection topLists={topLists} />
      ) : null}

      {banner ? <BannerSection banner={banner} /> : null}

      {footer && footer.length > 0 ? (
        <FooterSection links={footer} onNavigate={onNavigate} />
      ) : null}
    </View>
  );
}

UsageCard.displayName = 'UsageCard';

// ----------------------------------------------------------------------------
// Sections (kept private — UsageCard is the public contract)
// ----------------------------------------------------------------------------

function BudgetSection({budget}: {budget: UsageCardBudget}) {
  const intent = budget.intent ?? 'normal';
  const barColor = INTENT_BAR_BG[intent];
  // Preserve the unclamped pct in the accessibility value so screen readers
  // announce "over budget" overflow accurately. The visual width clamps to
  // 100% so the bar doesn't overflow its container.
  const widthPct = Math.max(0, Math.min(100, budget.pct));
  const ariaPct = Math.max(0, Math.round(budget.pct));
  return (
    <View style={styles.budgetSection}>
      <View style={styles.budgetHeader}>
        {renderNode(budget.headline, styles.budgetHeadline)}
        {budget.rightLabel
          ? renderNode(
              budget.rightLabel,
              intent === 'danger'
                ? styles.budgetRightDanger
                : styles.budgetRightMuted,
            )
          : null}
      </View>
      <View
        accessibilityLabel={budget.ariaLabel}
        accessibilityRole="progressbar"
        accessibilityValue={{max: 100, min: 0, now: ariaPct}}
        style={styles.budgetTrack}
        testID="usage-card-budget-bar">
        <View
          style={[
            styles.budgetFill,
            {backgroundColor: barColor, width: `${widthPct}%`},
          ]}
        />
      </View>
      {budget.caption ? renderNode(budget.caption, styles.budgetCaption) : null}
    </View>
  );
}

function BandsSection({bands}: {bands: UsageCardBand[]}) {
  return (
    <View style={styles.bands}>
      {bands.map((b, i) => {
        const intent = b.intent ?? 'normal';
        return (
          <View key={i} style={[styles.bandRoot, INTENT_BAND_RING[intent]]}>
            <View style={styles.bandLabelRow}>
              {b.icon ? (
                <View style={styles.iconBox}>
                  {renderNode(b.icon, styles.iconGlyph)}
                </View>
              ) : null}
              {renderNode(b.label, styles.bandLabel)}
            </View>
            {renderNode(b.value, styles.bandValue)}
            {b.sub ? renderNode(b.sub, styles.bandSub) : null}
          </View>
        );
      })}
    </View>
  );
}

function DetailsSection({details}: {details: UsageCardDetail[]}) {
  return (
    <View style={styles.detailsSection}>
      {details.map((d, i) => {
        const intent = d.intent ?? 'normal';
        return (
          <View
            key={i}
            style={[
              styles.detailCell,
              i % 2 === 0 ? styles.detailCellLeft : styles.detailCellRight,
            ]}>
            {renderNode(d.label, styles.detailLabel)}
            {renderNode(d.value, [
              styles.detailValue,
              {color: INTENT_VALUE_TEXT[intent]},
            ])}
          </View>
        );
      })}
    </View>
  );
}

function TopListsSection({topLists}: {topLists: UsageCardTopList[]}) {
  return (
    <View style={styles.topLists}>
      {topLists.map(tl => (
        <View key={tl.key} style={styles.topListBlock}>
          <View style={styles.topListHeader}>
            {tl.icon ? (
              <View style={styles.iconBox}>
                {renderNode(tl.icon, styles.iconGlyph)}
              </View>
            ) : null}
            {renderNode(tl.title, styles.topListTitle)}
          </View>
          <View style={styles.topListUl}>
            {tl.items.map(item => (
              <View key={item.key} style={styles.topListItem}>
                <View style={styles.topListItemLabelSlot}>
                  {typeof item.label === 'string' ||
                  typeof item.label === 'number' ? (
                    <AppText numberOfLines={1} style={styles.topListItemLabel}>
                      {item.label}
                    </AppText>
                  ) : (
                    item.label
                  )}
                </View>
                {renderNode(item.value, styles.topListItemValue)}
              </View>
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

function BannerSection({banner}: {banner: UsageCardBanner}) {
  const intent = banner.intent ?? 'danger';
  const textColor = INTENT_BANNER_TEXT[intent];
  const iconNode =
    banner.icon != null ? (
      renderNode(banner.icon, [styles.bannerIcon, {color: textColor}])
    ) : (
      <AppText
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[styles.bannerIcon, {color: textColor}]}
        weight="bold">
        {WARNING_GLYPH}
      </AppText>
    );
  return (
    <View
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
      accessible
      style={[styles.banner, INTENT_BANNER_BG[intent]]}>
      {iconNode}
      <View style={styles.bannerBody}>
        {renderNode(banner.title, [styles.bannerTitle, {color: textColor}])}
        {renderNode(banner.description, [
          styles.bannerDesc,
          {color: INTENT_BANNER_DESC[intent]},
        ])}
      </View>
    </View>
  );
}

function FooterSection({
  links,
  onNavigate,
}: {
  links: UsageCardFooterLink[];
  onNavigate?: (href: string) => void;
}) {
  return (
    <View style={styles.footerSection}>
      {links.map(link => {
        const textColor = link.primary
          ? FOOTER_PRIMARY_TEXT
          : FOOTER_SECONDARY_TEXT;
        return (
          <Pressable
            accessibilityHint={
              link.external ? 'Opens an external link' : undefined
            }
            accessibilityRole="link"
            key={link.key}
            onPress={() => onNavigate?.(link.to)}
            style={[styles.footerLink, link.primary && styles.footerLinkPrimary]}
            testID={`usage-card-footer-${link.key}`}>
            {renderNode(link.label, [styles.footerLinkLabel, {color: textColor}])}
            <AppText
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={[styles.linkIcon, {color: textColor}]}
              weight="bold">
              {EXTERNAL_LINK_GLYPH}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bandLabel: {
    color: colors.textMuted,
    fontSize: 12,
    letterSpacing: 0.6,
    lineHeight: 16,
    textTransform: 'uppercase',
  },
  bandLabelRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  bandRoot: {
    borderRadius: 8,
    padding: 12,
  },
  bandSub: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 16,
  },
  bandValue: {
    color: colors.textPrimary,
    fontWeight: '600',
    marginTop: 4,
  },
  bands: {
    gap: 12,
  },
  banner: {
    alignItems: 'flex-start',
    borderRadius: 8,
    flexDirection: 'row',
    gap: 8,
    padding: 12,
  },
  bannerBody: {
    flexShrink: 1,
  },
  bannerDesc: {
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
  },
  bannerIcon: {
    fontSize: 12,
    lineHeight: 18,
    marginTop: 2,
  },
  bannerTitle: {
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 20,
  },
  budgetCaption: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 16,
  },
  budgetFill: {
    height: '100%',
  },
  budgetHeader: {
    alignItems: 'baseline',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  budgetHeadline: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
  },
  budgetRightDanger: {
    color: '#f87171', // red-400
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 20,
  },
  budgetRightMuted: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
  },
  budgetSection: {
    gap: 8,
  },
  budgetTrack: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 9999,
    height: 8,
    overflow: 'hidden',
    width: '100%',
  },
  detailCell: {
    width: '50%',
  },
  detailCellLeft: {
    paddingRight: 8,
  },
  detailCellRight: {
    paddingLeft: 8,
  },
  detailLabel: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 16,
  },
  detailValue: {
    fontSize: 14,
    lineHeight: 20,
  },
  detailsSection: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: 4,
  },
  empty: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
  },
  footerLink: {
    alignItems: 'center',
    borderRadius: 6,
    flexDirection: 'row',
    gap: 6,
    minHeight: 36,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  footerLinkLabel: {
    fontSize: 12,
    fontWeight: '500',
    lineHeight: 16,
  },
  footerLinkPrimary: {
    backgroundColor: 'rgba(6, 182, 212, 0.15)',
    borderColor: 'rgba(34, 211, 238, 0.3)',
    borderWidth: 1,
  },
  footerSection: {
    borderTopColor: 'rgba(255, 255, 255, 0.06)',
    borderTopWidth: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingTop: 8,
  },
  iconBox: {
    alignItems: 'center',
    height: 14,
    justifyContent: 'center',
    width: 14,
  },
  iconGlyph: {
    fontSize: 9,
    letterSpacing: 0.2,
    lineHeight: 12,
    textAlign: 'center',
  },
  linkIcon: {
    fontSize: 9,
    letterSpacing: 0.2,
    lineHeight: 14,
  },
  root: {
    gap: 16,
  },
  topListBlock: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: 8,
    padding: 12,
  },
  topListHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  topListItem: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'space-between',
  },
  topListItemLabel: {
    color: colors.textSecondary,
    fontFamily: 'monospace',
    fontSize: 12,
    lineHeight: 16,
  },
  topListItemLabelSlot: {
    flexShrink: 1,
  },
  topListItemValue: {
    color: colors.textPrimary,
    fontSize: 14,
    lineHeight: 20,
  },
  topListTitle: {
    color: colors.textMuted,
    fontSize: 12,
    letterSpacing: 0.6,
    lineHeight: 16,
    textTransform: 'uppercase',
  },
  topListUl: {
    gap: 4,
    marginTop: 8,
  },
  topLists: {
    gap: 12,
  },
});
