//
//  ResourcesPanel.swift
//  TeslaSync — P4 shared surface · 0198 · ResourcesPanel (Apple)
//
//  The SwiftUI surface — the public API of the server-resources at-a-glance panel, the parity of the web
//  `<ResourcesPanel rows footnote id className />`. Like the web component it is driven entirely by its
//  props + the per-row optional icon slot + the optional footnote slot; there is no data source, so there
//  is nothing to wire. The view binds through ``ResourcesPanelModel`` (P1/S8) for the derived projection,
//  the localized title + empty message (P1/S10), and the once-only `view.opened` telemetry (P1/S11), and
//  pushes prop changes into the holder via `.onChange` so a reused panel re-renders faithfully. No
//  networking, no Tailwind ports — chrome is token-driven (P1/S9) and every string resolves through P1/S10.
//
//  Slot erasure: the per-row `icon` and the panel `footnote` are arbitrary caller-composed views (the web
//  `ReactNode` slots), so each is type-erased to `AnyView?` — the same slot pattern the sibling HealthRow
//  uses — with a `nil` standing in for an omitted slot (web `icon != null` / `footnote != null`). The
//  generic initializers keep the call site type-safe (the caller passes a real `@ViewBuilder` closure);
//  erasure happens once, inside `init`, so the surface stays a single concrete type. The web `id` maps to
//  an `accessibilityIdentifier` (the native peer of the DOM id used for scroll/anchor + UI tests); the web
//  `className` (a Tailwind-merge affordance) has no native equivalent and is intentionally not ported.
//

import SwiftUI

// MARK: - ResourceRow (web `ResourceRow`)

/// One resource row's props — the native peer of the web `ResourceRow` interface. Carries the label, the
/// formatted value, the optional sub-label, the optional `percent`, and the optional decorative icon slot
/// (erased to `AnyView?`). The Equatable structural subset used by the projection + the `.onChange`
/// reuse-guard is exposed as ``inputs`` (the icon view is excluded — it is not Equatable).
public struct ResourceRow: Identifiable {
    /// Stable identity for `ForEach` — the web `key={row.label}`; defaults to the label.
    public let id: String
    /// The left-aligned row label, e.g. "Memory" (web `label`).
    public let label: String
    /// The right-aligned formatted value, e.g. "1.8 GB" (web `valueText`).
    public let valueText: String
    /// The optional sub-label rendered after the value, e.g. "of 8 GB" (web `metaText`).
    public let metaText: String?
    /// The optional 0–100 usage percent driving the bar + severity (web `percent`); `nil` → no bar.
    public let percent: Double?
    /// The erased decorative icon slot (web `icon`); `nil` for an omitted icon (web `undefined`).
    let iconSlot: AnyView?

    /// The prop-style initializer — the parity of one web `ResourceRow`. `label` / `valueText` are
    /// required; `metaText` / `percent` default to omitted (web optional); the `icon` builder defaults to
    /// omitted (web `undefined`), detected as an `EmptyView` so it reserves no layout.
    public init(
        id: String? = nil,
        label: String,
        valueText: String,
        metaText: String? = nil,
        percent: Double? = nil,
        @ViewBuilder icon: () -> some View = { EmptyView() }
    ) {
        self.id = id ?? label
        self.label = label
        self.valueText = valueText
        self.metaText = metaText
        self.percent = percent
        iconSlot = ResourceRow.slot(icon)
    }

    /// Erases the icon to `AnyView`, mapping an `EmptyView` builder to `nil` (web `undefined` icon) so it
    /// reserves no layout. The builder is only invoked for a real icon.
    private static func slot<Icon: View>(_ build: () -> Icon) -> AnyView? {
        Icon.self == EmptyView.self ? nil : AnyView(build())
    }

    /// The Equatable structural subset fed into the projection + the `.onChange` reuse-guard.
    var inputs: ResourceRowInputs {
        ResourceRowInputs(
            id: id,
            label: label,
            valueText: valueText,
            metaText: metaText,
            percent: percent,
            hasIcon: iconSlot != nil
        )
    }
}

// MARK: - ResourcesPanel (the shared surface)

/// `ResourcesPanel` — the SwiftUI parity of `components/status/ResourcesPanel.tsx`: a glass panel with a
/// "Resources" heading and a stack of label / value rows, each with an optional severity-coloured usage
/// bar, plus an optional footnote. Renders the real branches of the web source — each severity, bar
/// present / absent, icon / sub-label present / absent, the empty-rows case, and footnote present / absent
/// — with the web composition.
public struct ResourcesPanel: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = ResourcesPanelSurface.slug

    private let rows: [ResourceRow]
    private let accessibilityID: String?
    private let footnoteSlot: AnyView?

    @State private var model: ResourcesPanelModel

    /// The prop-style initializer — the parity of the web `<ResourcesPanel … />`. `rows` is required
    /// (web required prop); `accessibilityIdentifier` maps the web `id` (default omitted); the `footnote`
    /// builder defaults to omitted (web `undefined`), detected as an `EmptyView`.
    public init<Footnote: View>(
        rows: [ResourceRow],
        accessibilityIdentifier: String? = nil,
        @ViewBuilder footnote: () -> Footnote = { EmptyView() },
        telemetry: any ResourcesPanelTelemetry = OSLogResourcesPanelTelemetry()
    ) {
        self.rows = rows
        accessibilityID = accessibilityIdentifier
        footnoteSlot = ResourcesPanel.slot(footnote)

        let resolvedInputs = ResourcesPanelInputs(
            rows: rows.map(\.inputs),
            hasFootnote: Footnote.self != EmptyView.self
        )
        _model = State(initialValue: ResourcesPanelModel(inputs: resolvedInputs, telemetry: telemetry))
    }

    public var body: some View {
        ResourcesPanelContentView(
            projection: model.projection,
            rows: rows,
            title: model.title,
            emptyMessage: model.emptyMessage,
            footnote: footnoteSlot,
            accessibilityIdentifier: accessibilityID
        )
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .onChange(of: currentInputs) { _, newInputs in
            model.update(newInputs)
        }
    }

    /// The props recomputed from the live values — the `.onChange` key that lets a reused panel re-derive
    /// its layout when the host swaps the rows or toggles the footnote.
    private var currentInputs: ResourcesPanelInputs {
        ResourcesPanelInputs(rows: rows.map(\.inputs), hasFootnote: footnoteSlot != nil)
    }

    /// Erases the footnote to `AnyView`, mapping an `EmptyView` builder to `nil` (web `undefined`).
    private static func slot<Footnote: View>(_ build: () -> Footnote) -> AnyView? {
        Footnote.self == EmptyView.self ? nil : AnyView(build())
    }
}

// MARK: - ResourcesPanelContentView (web `ResourcesPanel` body)

/// The panel body — the native peer of the web `ResourcesPanel` render output. A pure function of its
/// projection + the original rows (for the per-row icon slots, paired back by order) + the localized
/// title / empty message + the footnote slot: it renders the heading, the stacked rows (or the friendly
/// empty state when there are none), and the footnote, all inside the shared glass panel.
struct ResourcesPanelContentView: View {
    let projection: ResourcesPanelProjection
    let rows: [ResourceRow]
    let title: String
    let emptyMessage: String
    let footnote: AnyView?
    let accessibilityIdentifier: String?

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            Text(verbatim: title)
                .font(Font.TS.body)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textPrimary)
                .accessibilityAddTraits(.isHeader)

            if projection.isEmpty {
                ResourcesPanelEmptyView(message: emptyMessage)
            } else {
                rowStack
            }

            if let footnote {
                footnote
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.textMuted)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(TSSpacing.lg)
        .tsGlassPanel()
        .modifier(OptionalAccessibilityIdentifier(identifier: accessibilityIdentifier))
    }

    /// The stacked rows (web `<div className="space-y-3">`), each paired with its icon slot by order.
    private var rowStack: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            ForEach(Array(projection.rows.enumerated()), id: \.element.id) { index, rowProjection in
                ResourceRowView(
                    projection: rowProjection,
                    icon: index < rows.count ? rows[index].iconSlot : nil
                )
            }
        }
    }
}

// MARK: - OptionalAccessibilityIdentifier (web `id` → native identifier)

/// Applies an `accessibilityIdentifier` only when the web `id` prop is supplied, leaving the view
/// untouched otherwise (so an absent `id` does not stamp an empty identifier). The native peer of the
/// web GlassPanel DOM `id` used for scroll/anchor targeting + UI tests.
private struct OptionalAccessibilityIdentifier: ViewModifier {
    let identifier: String?

    func body(content: Content) -> some View {
        if let identifier {
            content.accessibilityIdentifier(identifier)
        } else {
            content
        }
    }
}
