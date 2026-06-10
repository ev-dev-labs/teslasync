//
//  IncidentsCard.Views.swift
//  TeslaSync — P4 feature view · 0247 · IncidentsCard (Apple)
//
//  The composed subviews for the IncidentsCard surface: the i18n SwiftUI bridge (`ICView`),
//  the severity color/glyph + status badge tone mappings (the native form of the web
//  `SEVERITY_TONE` / `STATUS_BADGE` maps), the card header (alert glyph + title + count badge +
//  the "Log incident" CTA), the populated content (inline reload error + the staggered rows on
//  a per-minute display clock), and the per-incident row (web `<Link>` → a native, accessible
//  button that opens the incident timeline). Every user-facing string routes through the P1/S10
//  facade; every interactive element carries a VoiceOver label; colors/spacing come from the
//  P1/S9 tokens — no Tailwind ported.
//

import SwiftUI

// MARK: - SwiftUI i18n helpers (web `t(key, default)`)

/// Bridges the `IncidentsCardStrings` facade into the SwiftUI text types the shared components
/// expect, so no view holds a hardcoded literal and runtime-resolved strings flow into
/// `LocalizedStringKey`-typed component parameters verbatim.
enum ICView {
    /// A `LocalizedStringKey` that renders an already-resolved string verbatim.
    static func key(_ resolved: String) -> LocalizedStringKey {
        "\(resolved)"
    }

    /// A `LocalizedStringKey` for a descriptor, resolved through the facade.
    static func key(_ descriptor: LocalizedText) -> LocalizedStringKey {
        key(IncidentsCardStrings.string(descriptor))
    }

    /// A verbatim `Text` for a descriptor, resolved through the facade.
    static func text(_ descriptor: LocalizedText) -> Text {
        Text(verbatim: IncidentsCardStrings.string(descriptor))
    }

    /// The raw resolved string for a descriptor (a11y labels, interpolations).
    static func string(_ descriptor: LocalizedText) -> String {
        IncidentsCardStrings.string(descriptor)
    }
}

// MARK: - Severity / status → design-system color (web `SEVERITY_TONE` / `STATUS_BADGE`)

extension IncidentSeverityRank {
    /// The status color the rank renders as — the native escalation of the web amber → orange
    /// → red ramp, built from the semantic tokens (the "elevated" orange is the perceptual
    /// blend of the warning + danger tokens, so it adapts to light/dark/high-contrast like the
    /// endpoints).
    var color: Color {
        switch self {
        case .caution: Color.TS.statusWarning
        case .elevated: Color.TS.statusWarning.mix(with: Color.TS.statusDanger, by: 0.5)
        case .critical: Color.TS.statusDanger
        }
    }
}

extension IncidentBadgeTone {
    /// The shared `TSBadge` tone this status badge renders as (web `STATUS_BADGE` variant).
    var tsTone: TSTone {
        switch self {
        case .danger: .danger
        case .warning: .warning
        case .info: .info
        case .success: .success
        }
    }
}

// MARK: - Header (web `<h3>⚠ Active incidents <Badge/></h3>` + ghost "Log incident")

/// The card header: the alert glyph, the "Active incidents" title, the active-count badge
/// (shown only when there are incidents, web `<Badge>{incidents.length}</Badge>`), and the
/// trailing ghost "Log incident" CTA that opens the `IncidentForm` sheet (web
/// `onClick={() => setOpen(true)}`).
struct IncidentsHeader: View {
    @Bindable var model: IncidentsCardModel

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Color.TS.statusWarning)
                .accessibilityHidden(true)
            ICView.text(IncidentsCardText.title)
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
            if !model.incidents.isEmpty {
                TSBadge(ICView.key(String(model.count)), tone: .warning)
            }
            Spacer(minLength: TSSpacing.sm)
            logButton
        }
        .accessibilityElement(children: .contain)
    }

    private var logButton: some View {
        TSButton(
            variant: .ghost,
            size: .small,
            action: { model.presentLogForm() },
            label: {
                HStack(spacing: TSSpacing.xs) {
                    Image(systemName: "plus")
                        .font(.system(size: 11, weight: .semibold))
                        .accessibilityHidden(true)
                    ICView.text(IncidentsCardText.logCta)
                }
            }
        )
        .accessibilityLabel(ICView.text(IncidentsCardText.logCta))
        .accessibilityIdentifier(IncidentsCardAccessibility.logCtaID)
    }
}

// MARK: - Content (web populated `<ul>` of incident rows)

/// The populated body: the inline reload error (when a refresh failed while rows remain) and
/// the staggered incident rows. The rows are driven by a per-minute display clock
/// (`TimelineView`) so the relative "Started …" labels stay current without a model timer —
/// the native parity of the web `now` tick the page feeds the card.
struct IncidentsContent: View {
    let model: IncidentsCardModel
    let onOpen: (ActiveIncident) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            if let message = model.inlineErrorMessage {
                IncidentsInlineError(message: message)
            }
            TimelineView(.periodic(from: .now, by: 60)) { context in
                IncidentsRows(model: model, now: context.date, onOpen: onOpen)
            }
        }
    }
}

/// The staggered list of incident rows (web `<ul className="space-y-1">`).
struct IncidentsRows: View {
    let model: IncidentsCardModel
    let now: Date
    let onOpen: (ActiveIncident) -> Void

    var body: some View {
        TSStaggerContainer(spacing: TSSpacing.xs) {
            ForEach(Array(model.incidents.enumerated()), id: \.element.id) { index, incident in
                TSStaggerItem(index: index) {
                    IncidentRow(model: model, incident: incident, now: now, onOpen: onOpen)
                }
            }
        }
    }
}

// MARK: - Row (web `<Link to="/system-status/incidents/:id">`)

/// One incident row — the native parity of the web `<Link>`: the severity glyph, the title +
/// status badge + severity label, the optional "Affects:" line, and the "Started … · N
/// updates" metadata, with a trailing chevron. The whole row is a single accessible button
/// that opens the incident timeline (web route navigation).
struct IncidentRow: View {
    let model: IncidentsCardModel
    let incident: ActiveIncident
    let now: Date
    let onOpen: (ActiveIncident) -> Void

    var body: some View {
        Button { onOpen(incident) } label: {
            HStack(alignment: .top, spacing: TSSpacing.md) {
                severityGlyph
                details
                Spacer(minLength: TSSpacing.sm)
                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Color.TS.textMuted)
                    .accessibilityHidden(true)
            }
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.sm)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: model.rowAccessibilityLabel(incident, now: now)))
        .accessibilityAddTraits(.isButton)
        .accessibilityIdentifier(IncidentsCardAccessibility.rowID(incident.id))
    }

    private var severityColor: Color {
        IncidentsCardAdapter.severityRank(incident.severity).color
    }

    private var severityGlyph: some View {
        Image(systemName: IncidentsCardAdapter.severitySymbolName(incident.severity))
            .font(.system(size: 14, weight: .semibold))
            .foregroundStyle(severityColor)
            .padding(.top, 2)
            .accessibilityHidden(true)
    }

    private var details: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            titleRow
            if let affects = IncidentsCardAdapter.affectsLine(incident.affectedComponents, localize: model.localize) {
                Text(verbatim: affects)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Text(verbatim: metadata)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var titleRow: some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
            Text(verbatim: incident.title)
                .font(Font.TS.body)
                .fontWeight(.medium)
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
                .truncationMode(.tail)
                .layoutPriority(1)
            TSBadge(ICView.key(statusLabel), tone: IncidentsCardAdapter.statusTone(incident.status).tsTone)
            Text(verbatim: severityLabel)
                .font(Font.TS.caption)
                .foregroundStyle(severityColor)
        }
    }

    private var statusLabel: String {
        model.localize(IncidentsCardText.status(incident.status))
    }

    private var severityLabel: String {
        model.localize(IncidentsCardText.severity(incident.severity))
    }

    private var metadata: String {
        IncidentsCardAdapter.metadataLine(
            now: now,
            startedAt: incident.startedAt,
            updateCount: incident.updateCount,
            localize: model.localize
        )
    }
}
