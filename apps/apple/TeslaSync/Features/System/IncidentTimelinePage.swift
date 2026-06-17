import SwiftUI

/// Native SwiftUI parity of `web/src/features/system/pages/IncidentTimelinePage.tsx` (route
/// `/system-status/incidents/:id`). The incident post-mortem surface: a header with the severity /
/// status / lifecycle controls, the full update timeline (newest first), an append-update form, and
/// the resolve close-out. It reproduces every region of the web page, binding through the
/// `@Observable` `IncidentTimelinePageModel` (ADR-004 — no networking in the view):
///   1. GlassPanel1 — the incident header (severity glyph, status + severity + source + duration
///      badges, description, affected components, started / resolved line, Resolve control).
///   2. The AI section — the existing `AIIncidentTimelineSummarizer` surface, fed the incident id
///      (web `<AIIncidentTimelineSummarizer incidentId={incident.id} />`).
///   3. GlassPanel2 — the deterministic timeline (web `[...updates].reverse()`).
///   4. GlassPanel3 — the append-update form (web `!isResolved` form).
///   5. GlassPanel4 — the not-found / no-access panel (web `error || !incident` branch).
///
/// Adaptive across macOS / iPad (regular) and iPhone (compact); every literal resolves from
/// `Localizable.xcstrings`; the page renders no SI measurements (timestamps + derived durations
/// only), so no unit conversion is involved. The panels live in `IncidentTimelinePageSections.swift`.
public struct IncidentTimelinePage: View {
    @State private var model: IncidentTimelinePageModel
    private let onBack: (() -> Void)?
    /// The production AI-summarizer model the host injects (web `<AIIncidentTimelineSummarizer>` wired
    /// to its real `useAiEnabled` gate + `/ai/system/incidents/{id}/summarize` stream). `nil` uses the
    /// representative sample composition for standalone / preview builds (ADR-004).
    private let aiSummarizerModel: IncidentSummarizerModel?

    @Environment(\.dismiss) private var dismiss

    public init(
        model: IncidentTimelinePageModel,
        aiSummarizerModel: IncidentSummarizerModel? = nil,
        onBack: (() -> Void)? = nil
    ) {
        _model = State(initialValue: model)
        self.aiSummarizerModel = aiSummarizerModel
        self.onBack = onBack
    }

    public init(
        incidentID: Int64?,
        rawID: String? = nil,
        dataSource: any IncidentTimelineDataSource = SampleIncidentTimelineDataSource(),
        aiSummarizerModel: IncidentSummarizerModel? = nil,
        onBack: (() -> Void)? = nil
    ) {
        _model = State(initialValue: IncidentTimelinePageModel(
            incidentID: incidentID,
            rawID: rawID,
            dataSource: dataSource
        ))
        self.aiSummarizerModel = aiSummarizerModel
        self.onBack = onBack
    }

    public var body: some View {
        ScrollView {
            content
                .padding(TSSpacing.lg)
                .frame(maxWidth: 768, alignment: .leading)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Color.TS.bg.ignoresSafeArea())
        .navigationTitle(navigationTitle)
        #if os(iOS)
            .navigationBarTitleDisplayMode(.large)
        #endif
            .toolbar { backToolbarItem }
            .overlay(alignment: .bottom) { toastOverlay }
            .task {
                guard case .loading = model.state else { return }
                await model.load()
            }
            .task(id: model.toast?.id) { await autoDismissToast() }
            .alert(
                IncidentTimelineStrings.confirmTitle,
                isPresented: $model.confirmResolve,
                actions: {
                    Button(IncidentTimelineStrings.confirmCancel, role: .cancel) { model.cancelResolve() }
                    Button(IncidentTimelineStrings.confirmConfirm) { Task { await model.resolve() } }
                },
                message: { Text(IncidentTimelineStrings.confirmMessage) }
            )
    }

    private var navigationTitle: Text {
        if let incident = model.incident {
            Text(verbatim: incident.title)
        } else {
            Text(IncidentTimelineStrings.title)
        }
    }

    // MARK: - State router (web isLoading / error / ready branches)

    @ViewBuilder
    private var content: some View {
        switch model.state {
        case .loading:
            loadingView
        case .error:
            notFoundPanel
        case .ready:
            if let incident = model.incident {
                readyContent(incident)
            } else {
                notFoundPanel
            }
        }
    }

    /// Web loading branch ("Loading incident…"): a labelled spinner over skeleton rows so the region
    /// is never blank (ADR-011). [parity: loading state]
    private var loadingView: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            HStack(spacing: TSSpacing.sm) {
                TSSpinner()
                Text(IncidentTimelineStrings.loading)
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textSecondary)
            }
            ForEach(0 ..< 3, id: \.self) { _ in
                TSSkeleton(height: 96, cornerRadius: TSRadius.md)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(IncidentTimelineStrings.loading))
    }

    /// Web `error || !incident` branch — GlassPanel4: the "Incident {id} not found or you don't have
    /// access." panel with a Back-to-System-Status affordance plus a retry so the region recovers
    /// (ADR-011 — never a blank region). [parity: GlassPanel4]
    private var notFoundPanel: some View {
        TSFadeIn(delay: 0.05) {
            TSGlassPanel {
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    Text(IncidentTimelineStrings.notFoundSubtitle)
                        .font(Font.TS.panel)
                        .foregroundStyle(Color.TS.textPrimary)
                    Text(verbatim: IncidentTimelineStrings.notFoundMessage(id: model.rawID))
                        .font(Font.TS.body)
                        .foregroundStyle(Color.TS.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                    notFoundActions
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var notFoundActions: some View {
        HStack(spacing: TSSpacing.md) {
            Button(action: goBack) {
                HStack(spacing: TSSpacing.xs) {
                    Image(systemName: "arrow.left").font(.system(size: 12, weight: .semibold))
                    Text(IncidentTimelineStrings.backToStatus)
                }
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(IncidentTimelineStrings.backToStatus))
            TSButton(variant: .secondary, size: .small, action: retry, label: backLabel)
        }
    }

    private func backLabel() -> some View {
        Text(IncidentTimelineStrings.back)
    }

    private func retry() {
        Task { await model.refresh() }
    }

    /// Web resolved body — the header, the AI section, the timeline, and (when open) the append
    /// form, in the same vertical order as the web page. [parity: success state]
    private func readyContent(_ incident: IncidentTimelineDetail) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.xl) {
            Text(verbatim: IncidentTimelineStrings.subtitle(id: incident.id))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            TSFadeIn(delay: 0.05) { IncidentHeaderPanel(incident: incident, model: model) }
            TSFadeIn(delay: 0.10) { aiSection(incident.id) }
            TSFadeIn(delay: 0.15) { IncidentTimelinePanel(incident: incident) }
            if !incident.isResolved {
                TSFadeIn(delay: 0.20) { IncidentAppendFormPanel(incident: incident, model: model) }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// The web anonymous AI region — the injected production summarizer when the host wired one,
    /// else the representative sample composition (web `<AIIncidentTimelineSummarizer incidentId={…}/>`).
    @ViewBuilder
    private func aiSection(_ incidentID: Int64) -> some View {
        if let aiSummarizerModel {
            IncidentTimelineAISection(model: aiSummarizerModel)
        } else {
            IncidentTimelineAISection(incidentID: incidentID)
        }
    }

    // MARK: - Back affordance (web `actions` Back button → navigate('/system-status'))

    private var backToolbarItem: some ToolbarContent {
        ToolbarItem(placement: .cancellationAction) {
            Button(action: goBack) {
                HStack(spacing: TSSpacing.xs) {
                    Image(systemName: "arrow.left").font(.system(size: 12, weight: .semibold))
                    Text(IncidentTimelineStrings.back)
                }
            }
            .accessibilityLabel(Text(IncidentTimelineStrings.back))
        }
    }

    private func goBack() {
        if let onBack {
            onBack()
        } else {
            dismiss()
        }
    }

    // MARK: - Toast (web useToast)

    @ViewBuilder
    private var toastOverlay: some View {
        if let toast = model.toast {
            IncidentTimelineToastView(toast: toast) { model.dismissToast() }
                .padding(TSSpacing.lg)
                .animation(.easeInOut(duration: TSMotion.normalDuration), value: toast.id)
        }
    }

    private func autoDismissToast() async {
        guard model.toast != nil else { return }
        try? await Task.sleep(for: .seconds(4))
        if !Task.isCancelled { model.dismissToast() }
    }
}

// MARK: - SwiftUI i18n helper (verbatim runtime strings → LocalizedStringKey)

/// Bridges already-resolved runtime strings (durations, interpolated copy) into the
/// `LocalizedStringKey`-typed component parameters the shared components expect, rendering them
/// verbatim (the same trick the sibling `IncidentForm` / `IncidentsCard` views use).
enum ITView {
    static func verbatim(_ resolved: String) -> LocalizedStringKey {
        "\(resolved)"
    }
}

// MARK: - Toast banner (web useToast.success / .error)

/// The transient feedback banner — the native counterpart of the web `toast.success` / `toast.error`
/// (the append-required / append-success / append-failure / resolve-success / resolve-failure copy).
struct IncidentTimelineToastView: View {
    let toast: IncidentTimelineToast
    let onDismiss: () -> Void

    var body: some View {
        let tint = toast.isError ? Color.TS.statusDanger : Color.TS.statusSuccess
        return HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
            Image(systemName: toast.isError ? "exclamationmark.triangle.fill" : "checkmark.circle.fill")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(tint)
                .accessibilityHidden(true)
            Text(verbatim: toast.message)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: TSSpacing.sm)
            Button(action: onDismiss) {
                Image(systemName: "xmark").font(.system(size: 10, weight: .bold))
            }
            .buttonStyle(.plain)
            .foregroundStyle(Color.TS.textMuted)
            .accessibilityLabel(Text(IncidentTimelineStrings.confirmCancel))
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(tint.opacity(0.1), in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(tint.opacity(0.3), lineWidth: 1)
        )
        .transition(.move(edge: .bottom).combined(with: .opacity))
        .accessibilityElement(children: .combine)
    }
}
