import SwiftUI

// The composed panel subviews for `IncidentTimelinePage` — split out so each file stays within the
// SwiftLint file-length budget. Every user-facing string resolves from `Localizable.xcstrings`;
// colors / spacing come from the P2 design tokens; every interactive element carries a VoiceOver
// label. No SI measurements are rendered (timestamps + derived durations only).

// MARK: - GlassPanel1 — Incident header (web first GlassPanel)

/// The incident header — the native parity of the web first `<GlassPanel>`: the severity glyph, the
/// status + severity + source + open/resolved-duration badges, the description, the affected
/// components, the started / resolved metadata line, and the Resolve control (open incidents only).
struct IncidentHeaderPanel: View {
    let incident: IncidentTimelineDetail
    @Bindable var model: IncidentTimelinePageModel

    var body: some View {
        TSGlassPanel {
            HStack(alignment: .top, spacing: TSSpacing.md) {
                Image(systemName: IncidentTimelineFormat.severitySymbolName(incident.severity))
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(IncidentTimelineFormat.severityColor(incident.severity))
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: TSSpacing.sm) {
                    badgeRow
                    if !incident.description.isEmpty {
                        Text(verbatim: incident.description)
                            .font(Font.TS.body)
                            .foregroundStyle(Color.TS.textSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    affectsLine
                    startedLine
                }
                Spacer(minLength: TSSpacing.sm)
                if !incident.isResolved {
                    resolveButton
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private var affectsLine: some View {
        if !incident.affectedComponents.isEmpty {
            Text(verbatim: IncidentTimelineStrings.affects(
                components: incident.affectedComponents.joined(separator: ", ")
            ))
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
            .fixedSize(horizontal: false, vertical: true)
        }
    }

    @ViewBuilder
    private var badgeRow: some View {
        let severityColor = IncidentTimelineFormat.severityColor(incident.severity)
        ViewThatFits(in: .horizontal) {
            HStack(spacing: TSSpacing.sm) { badgeRowContent(severityColor) }
            VStack(alignment: .leading, spacing: TSSpacing.xs) { badgeRowContent(severityColor) }
        }
    }

    @ViewBuilder
    private func badgeRowContent(_ severityColor: Color) -> some View {
        TSBadge(IncidentTimelineStrings.statusKey(incident.status),
                tone: IncidentTimelineFormat.statusTone(incident.status))
        Text(IncidentTimelineStrings.severityKey(incident.severity))
            .font(Font.TS.caption)
            .textCase(.uppercase)
            .tracking(0.6)
            .foregroundStyle(severityColor)
        Text(verbatim: incident.source)
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
        durationBadge
    }

    /// The open / resolved duration badge (web `Open · {dur}` neutral / `Resolved · {dur}` success).
    /// Wrapped in a per-minute `TimelineView` so an open incident's elapsed time counts up live.
    private var durationBadge: some View {
        TimelineView(.periodic(from: .now, by: 60)) { context in
            if incident.isResolved {
                TSBadge(ITView.verbatim(resolvedDurationText), tone: .success)
            } else {
                TSBadge(ITView.verbatim(openDurationText(now: context.date)), tone: .neutral)
            }
        }
    }

    private var resolvedDurationText: String {
        IncidentTimelineStrings.resolvedBadge(
            duration: IncidentTimelineFormat.duration(from: incident.startedAt, to: incident.resolvedAt)
        )
    }

    private func openDurationText(now: Date) -> String {
        IncidentTimelineStrings.openBadge(
            duration: IncidentTimelineFormat.duration(from: incident.startedAt, now: now)
        )
    }

    private var startedLine: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "clock").font(.system(size: 10)).foregroundStyle(Color.TS.textMuted)
            Text(verbatim: startedText)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityElement(children: .combine)
    }

    private var startedText: String {
        var line = IncidentTimelineStrings.started(date: IncidentTimelineFormat.dateTime(incident.startedAt))
        if let resolvedAt = incident.resolvedAt {
            line += " · " + IncidentTimelineStrings.resolvedAt(date: IncidentTimelineFormat.dateTime(resolvedAt))
        }
        return line
    }

    private var resolveButton: some View {
        TSButton(
            variant: .primary,
            size: .small,
            isLoading: model.isResolving,
            action: { model.requestResolve() },
            label: {
                HStack(spacing: TSSpacing.xs) {
                    Image(systemName: "checkmark.circle").font(.system(size: 12, weight: .semibold))
                    Text(IncidentTimelineStrings.resolve)
                }
            }
        )
        .accessibilityLabel(Text(IncidentTimelineStrings.resolve))
    }
}

// MARK: - GlassPanel2 — Timeline (web `[...updates].reverse()`)

/// The deterministic update timeline — the native parity of the web second `<GlassPanel>`: a heading
/// with the entry count, then the updates newest-first. An entryless incident shows a friendly hint
/// rather than a blank region (ADR-011).
struct IncidentTimelinePanel: View {
    let incident: IncidentTimelineDetail

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                heading
                if incident.updates.isEmpty {
                    Text(IncidentTimelineStrings.timelineEmpty)
                        .font(Font.TS.body)
                        .foregroundStyle(Color.TS.textMuted)
                        .frame(maxWidth: .infinity, alignment: .leading)
                } else {
                    updatesList
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var updatesList: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            ForEach(incident.updatesNewestFirst) { update in
                IncidentTimelineRow(update: update)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(IncidentTimelineStrings.timelineHeading))
    }

    private var heading: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "bubble.left.and.bubble.right")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.TS.textSecondary)
                .accessibilityHidden(true)
            Text(IncidentTimelineStrings.timelineHeading)
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
            Text(verbatim: IncidentTimelineStrings.entries(count: incident.updates.count))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
    }
}

/// One timeline entry — the native parity of the web `<li>`: a left accent rule, the status badge,
/// the absolute timestamp, the optional author, and the (pre-wrapped) message body.
struct IncidentTimelineRow: View {
    let update: IncidentTimelineUpdate

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            RoundedRectangle(cornerRadius: 1, style: .continuous)
                .fill(Color.TS.border)
                .frame(width: 2)
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                metaRow
                Text(verbatim: update.message)
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private var metaRow: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: TSSpacing.sm) { metaContent }
            VStack(alignment: .leading, spacing: TSSpacing.xs) { metaContent }
        }
    }

    @ViewBuilder
    private var metaContent: some View {
        TSBadge(IncidentTimelineStrings.statusKey(update.status),
                tone: IncidentTimelineFormat.statusTone(update.status))
        Text(verbatim: IncidentTimelineFormat.dateTime(update.at))
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
        if let author = update.author, !author.isEmpty {
            Text(verbatim: "· \(author)")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
    }
}

// MARK: - GlassPanel3 — Append-update form (web `!isResolved` form)

/// The append-update form — the native parity of the web third `<GlassPanel>` (rendered only while
/// the incident is open): an "Add update" heading, the message editor with the web instructional
/// copy, the optional status-change picker, and the submit control ("Add update" / "Adding…").
struct IncidentAppendFormPanel: View {
    let incident: IncidentTimelineDetail
    @Bindable var model: IncidentTimelinePageModel

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                TSPanelTitle(IncidentTimelineStrings.addUpdate)
                VStack(alignment: .leading, spacing: TSSpacing.xs) {
                    TSHelperText(IncidentTimelineStrings.messageHint)
                    TSTextArea(text: messageBinding, minHeight: 84)
                        .accessibilityLabel(Text(IncidentTimelineStrings.messageLabel))
                }
                controlsRow
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var messageBinding: Binding<String> {
        Binding(get: { model.message }, set: { model.setMessage($0) })
    }

    private var controlsRow: some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .center, spacing: TSSpacing.md) {
                statusPicker
                Spacer(minLength: TSSpacing.sm)
                submitButton
            }
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                statusPicker
                submitButton
            }
        }
    }

    private var statusPicker: some View {
        TSSelect(selection: $model.statusChange, options: statusOptions)
            .accessibilityLabel(Text(IncidentTimelineStrings.statusAria))
    }

    private var statusOptions: [TSSelectOption<IncidentTimelineStatusChange>] {
        let currentLabel = IncidentTimelineStrings.statusLabel(incident.status)
        let keepLabel = IncidentTimelineStrings.keepStatus(current: currentLabel)
        return [
            TSSelectOption(.keep, ITView.verbatim(keepLabel)),
            TSSelectOption(.change(.investigating), IncidentTimelineStrings.optionInvestigating),
            TSSelectOption(.change(.identified), IncidentTimelineStrings.optionIdentified),
            TSSelectOption(.change(.monitoring), IncidentTimelineStrings.optionMonitoring),
            TSSelectOption(.change(.resolved), IncidentTimelineStrings.optionResolved)
        ]
    }

    private var submitButton: some View {
        TSButton(
            variant: .primary,
            size: .medium,
            action: { Task { await model.appendUpdate() } },
            label: {
                HStack(spacing: TSSpacing.xs) {
                    if model.isAppending {
                        ProgressView().controlSize(.mini).tint(.white).accessibilityHidden(true)
                    }
                    Text(submitTitle)
                }
            }
        )
        .disabled(model.isAppendDisabled)
        .accessibilityLabel(Text(submitTitle))
    }

    private var submitTitle: LocalizedStringKey {
        model.isAppending ? IncidentTimelineStrings.adding : IncidentTimelineStrings.addUpdate
    }
}

// MARK: - AI section (web `<AIIncidentTimelineSummarizer incidentId={incident.id} />`)

/// The Helix incident-timeline summarizer, fed the incident id — the exact composition the web page
/// performs. The shared surface owns the AI feature-gate + its own data states; this wrapper only
/// supplies the in-scope incident, defaulting to the same representative ready input the surface's
/// own previews use. The production app injects the real streaming source via `init(model:)` at
/// composition time (ADR-004); this surface owns a separate parity ledger row, so it is reproduced
/// here (the web page's anonymous AI region) but not counted among this page's parity items.
struct IncidentTimelineAISection: View {
    @State private var model: IncidentSummarizerModel

    init(incidentID: Int64) {
        let source = InMemoryIncidentSummarizerSource(initial: IncidentSummarizerInput(
            availability: .resolved(enabled: true),
            incidentID: Int(incidentID),
            connection: .live,
            stream: .idle
        ))
        _model = State(initialValue: IncidentSummarizerModel(source: source))
    }

    init(model: IncidentSummarizerModel) {
        _model = State(initialValue: model)
    }

    var body: some View {
        AIIncidentTimelineSummarizer(model: model)
    }
}
