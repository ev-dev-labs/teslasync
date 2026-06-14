//
//  WidgetShell.swift
//  TeslaSync — P4 widget primitive · 0013 · WidgetShell (Apple)
//
//  The SwiftUI surface — native parity of features/dashboard/widgets/WidgetShell.tsx. WidgetShell is
//  THE shared widget-chrome building block used by every dashboard widget: it wraps a caller-supplied
//  content slot with an optional titled header (icon + title + contextual "?" help + data-freshness
//  chip + pin + actions), renders the loading skeleton and the query-error state, and pulses softly
//  for 1.5 s when the data timestamp changes. Pure presentation — no networking, no data source; the
//  hosting widget supplies every input (web: a pure presentational component).
//
//  The pure decisions (render state, freshness status/label, pulse, layout) live in
//  WidgetShell.Model.swift; the freshness chip / help / pin subviews live in WidgetShell.Views.swift.
//

import Foundation
import SwiftUI

// MARK: - i18n facade SwiftUI helper (P1/S10)

public extension WidgetShellStrings {
    /// SwiftUI `Text` for a key with the web English fallback. Kept here (not in the model file) so
    /// the model stays SwiftUI-free.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - Freshness input (web granular props / `query` → DataFreshness)

/// The freshness inputs the shell forwards to its `DataFreshness` chip — the native bundle covering
/// both web paths: the granular `updatedAt`/`isFetching`/`isStale`/`isError`/`onRefresh` props and the
/// `query` convenience (resolve a `FreshnessQuery` to these fields at the call site). Carries the
/// `onRefresh` closure, so it is a view-layer input rather than part of the Sendable pure model.
public struct WidgetShellFreshness {
    public var updatedAtMillis: Double?
    public var isFetching: Bool
    public var isStale: Bool
    public var isError: Bool
    public var onRefresh: (@MainActor () -> Void)?

    public init(
        updatedAtMillis: Double? = nil,
        isFetching: Bool = false,
        isStale: Bool = false,
        isError: Bool = false,
        onRefresh: (@MainActor () -> Void)? = nil
    ) {
        self.updatedAtMillis = updatedAtMillis
        self.isFetching = isFetching
        self.isStale = isStale
        self.isError = isError
        self.onRefresh = onRefresh
    }
}

/// The pin inputs the shell forwards to its `PinButton` — the resolved pin state plus a toggle
/// callback. The host owns persistence (web composes `usePinned`/`useTogglePin`); the shell stays
/// presentational.
public struct WidgetShellPin {
    public var isPinned: Bool
    public var onToggle: @MainActor () -> Void

    public init(isPinned: Bool, onToggle: @escaping @MainActor () -> Void) {
        self.isPinned = isPinned
        self.onToggle = onToggle
    }
}

// MARK: - WidgetShell (the primitive)

/// The widget-chrome shell. Faithfully to the web source it renders, in order of precedence:
///   • `loading` → a full-bleed shimmer skeleton (web `<Skeleton className="h-full rounded-xl" />`);
///   • `error`   → a centered query-error state (web `<QueryError />`);
///   • otherwise → the content surface: a titled header (icon + title + help + freshness + pin +
///     actions) above the caller's content slot, or — when there is no title — the content with the
///     compact freshness chip overlaid top-trailing and an optional actions row.
/// It pulses a soft green glow for 1.5 s whenever the freshness timestamp changes (Reduce-Motion
/// safe), and emits the P1/S11 `view.opened` diagnostic on appear.
public struct WidgetShell<Content: View, Actions: View, Icon: View>: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static var surfaceSlug: String {
        WidgetShellSurface.slug
    }

    private let title: String?
    private let loading: Bool
    private let error: String?
    private let noPadding: Bool
    private let freshness: WidgetShellFreshness?
    private let help: WidgetHelp?
    private let pin: WidgetShellPin?
    private let telemetry: any WidgetShellTelemetry
    private let renderIcon: Bool
    private let renderActions: Bool
    private let icon: @MainActor () -> Icon
    private let actions: @MainActor () -> Actions
    private let content: @MainActor () -> Content

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var justUpdated = false

    /// Funnel initialiser shared by every public initialiser so the `renderIcon` / `renderActions`
    /// flags (whether the caller supplied a real slot vs. an injected `EmptyView`) are set exactly
    /// once. `fileprivate` so the `where`-constrained convenience initialisers below can call it.
    fileprivate init(
        title: String?,
        loading: Bool,
        error: String?,
        noPadding: Bool,
        freshness: WidgetShellFreshness?,
        help: WidgetHelp?,
        pin: WidgetShellPin?,
        telemetry: any WidgetShellTelemetry,
        renderIcon: Bool,
        renderActions: Bool,
        icon: @escaping @MainActor () -> Icon,
        actions: @escaping @MainActor () -> Actions,
        content: @escaping @MainActor () -> Content
    ) {
        self.title = title
        self.loading = loading
        self.error = error
        self.noPadding = noPadding
        self.freshness = freshness
        self.help = help
        self.pin = pin
        self.telemetry = telemetry
        self.renderIcon = renderIcon
        self.renderActions = renderActions
        self.icon = icon
        self.actions = actions
        self.content = content
    }

    /// Primary initialiser — caller supplies the icon, actions, and content slots.
    public init(
        title: String? = nil,
        loading: Bool = false,
        error: String? = nil,
        noPadding: Bool = false,
        freshness: WidgetShellFreshness? = nil,
        help: WidgetHelp? = nil,
        pin: WidgetShellPin? = nil,
        telemetry: any WidgetShellTelemetry = OSLogWidgetShellTelemetry(),
        @ViewBuilder icon: @escaping @MainActor () -> Icon,
        @ViewBuilder actions: @escaping @MainActor () -> Actions,
        @ViewBuilder content: @escaping @MainActor () -> Content
    ) {
        self.init(
            title: title, loading: loading, error: error, noPadding: noPadding,
            freshness: freshness, help: help, pin: pin, telemetry: telemetry,
            renderIcon: true, renderActions: true,
            icon: icon, actions: actions, content: content
        )
    }

    public var body: some View {
        surface
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .shadow(
                color: justUpdated ? Color.TS.statusSuccess.opacity(0.15) : .clear,
                radius: justUpdated ? 12 : 0
            )
            .animation(
                reduceMotion ? nil : .easeInOut(duration: TSMotion.slowDuration),
                value: justUpdated
            )
            .onAppear { telemetry.viewOpened(surface: Self.surfaceSlug) }
            .onChange(of: updatedKey) { oldValue, newValue in
                if WidgetShellPulse.shouldPulse(previous: oldValue, next: newValue) {
                    triggerPulse()
                }
            }
    }

    private var updatedKey: Double? {
        freshness?.updatedAtMillis
    }

    private func triggerPulse() {
        guard !reduceMotion else { return }
        justUpdated = true
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(1500))
            justUpdated = false
        }
    }

    // MARK: Top-level render branch (web early returns)

    @ViewBuilder private var surface: some View {
        switch WidgetShellState.resolve(loading: loading, error: error) {
        case .loading:
            loadingView
        case .error:
            errorView
        case .ready:
            readyView
        }
    }

    /// Web `<Skeleton className="h-full rounded-xl" />` — a full-bleed shimmer filling the widget.
    private var loadingView: some View {
        GeometryReader { geo in
            TSSkeleton(height: max(geo.size.height, 1), cornerRadius: TSRadius.lg)
        }
    }

    /// Web `<div className="h-full flex items-center justify-center p-4"><QueryError /></div>`. The web
    /// `QueryError` ignores the raw error string for display (a status-less `Error` falls through to
    /// the generic network copy), so we render the shared `TSQueryError` / `TSErrorDisplay` generic
    /// state, wiring the freshness refresh as the retry when one is available.
    private var errorView: some View {
        Group {
            if let onRefresh = freshness?.onRefresh {
                TSQueryError(onRetry: onRefresh)
            } else {
                TSErrorDisplay(title: "error.queryTitle", message: "error.queryMessage")
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
        .padding(TSSpacing.lg)
    }

    // MARK: Ready surface (titled header / title-less overlay)

    private var readyView: some View {
        ZStack(alignment: .topTrailing) {
            VStack(alignment: .leading, spacing: 0) {
                header
                bodyArea
            }
            overlayFreshness
        }
    }

    @ViewBuilder private var header: some View {
        if WidgetShellLayout.showsTitleHeader(title: title), let title {
            titledHeader(title)
        } else if renderActions {
            // Web title-less actions row: `flex justify-end px-4 pt-3 pb-1`.
            HStack(spacing: TSSpacing.sm) {
                Spacer(minLength: 0)
                actions()
            }
            .padding(.horizontal, TSSpacing.lg)
            .padding(.top, TSSpacing.sm)
            .padding(.bottom, 2)
        }
    }

    private func titledHeader(_ title: String) -> some View {
        HStack(spacing: TSSpacing.sm) {
            HStack(spacing: 6) {
                if renderIcon {
                    icon()
                        .font(.system(size: 12))
                        .foregroundStyle(Color.TS.textMuted)
                }
                Text(verbatim: title)
                    .font(Font.TS.label)
                    .foregroundStyle(Color.TS.textMuted)
                    .textCase(.uppercase)
                    .kerning(0.6)
                    .lineLimit(1)
                    .truncationMode(.tail)
                if let help {
                    WidgetShellHelpButton(title: title, help: help)
                }
            }
            Spacer(minLength: TSSpacing.sm)
            HStack(spacing: TSSpacing.sm) {
                if let freshness {
                    freshnessChip(freshness, compact: false)
                }
                if let pin {
                    WidgetShellPinButton(isPinned: pin.isPinned, onToggle: pin.onToggle)
                }
                if renderActions {
                    actions()
                }
            }
        }
        .padding(.horizontal, TSSpacing.lg)
        .padding(.top, TSSpacing.sm)
        .padding(.bottom, 2)
        .accessibilityElement(children: .contain)
    }

    private var bodyArea: some View {
        content()
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .padding(bodyInsets)
    }

    private var bodyInsets: EdgeInsets {
        // Web `!noPadding ? 'px-4 pb-3' : ''` (header supplies the top gap; the body has none).
        noPadding
            ? EdgeInsets()
            : EdgeInsets(top: 0, leading: TSSpacing.lg, bottom: TSSpacing.md, trailing: TSSpacing.lg)
    }

    /// Web overlay freshness for title-less widgets: `absolute top-1.5 right-1.5 z-[5]`, compact.
    @ViewBuilder private var overlayFreshness: some View {
        if !WidgetShellLayout.showsTitleHeader(title: title), let freshness {
            freshnessChip(freshness, compact: true)
                .padding(6)
        }
    }

    private func freshnessChip(_ freshness: WidgetShellFreshness, compact: Bool) -> WidgetShellFreshnessChip {
        WidgetShellFreshnessChip(
            updatedAtMillis: freshness.updatedAtMillis,
            isFetching: freshness.isFetching,
            isStale: freshness.isStale,
            isError: freshness.isError,
            compact: compact,
            onRefresh: freshness.onRefresh
        )
    }
}

// MARK: - Convenience initialisers (omit unused icon / actions slots)

public extension WidgetShell where Actions == EmptyView {
    /// Icon + content, no trailing actions.
    init(
        title: String? = nil,
        loading: Bool = false,
        error: String? = nil,
        noPadding: Bool = false,
        freshness: WidgetShellFreshness? = nil,
        help: WidgetHelp? = nil,
        pin: WidgetShellPin? = nil,
        telemetry: any WidgetShellTelemetry = OSLogWidgetShellTelemetry(),
        @ViewBuilder icon: @escaping @MainActor () -> Icon,
        @ViewBuilder content: @escaping @MainActor () -> Content
    ) {
        self.init(
            title: title, loading: loading, error: error, noPadding: noPadding,
            freshness: freshness, help: help, pin: pin, telemetry: telemetry,
            renderIcon: true, renderActions: false,
            icon: icon, actions: { EmptyView() }, content: content
        )
    }
}

public extension WidgetShell where Icon == EmptyView {
    /// Actions + content, no leading icon.
    init(
        title: String? = nil,
        loading: Bool = false,
        error: String? = nil,
        noPadding: Bool = false,
        freshness: WidgetShellFreshness? = nil,
        help: WidgetHelp? = nil,
        pin: WidgetShellPin? = nil,
        telemetry: any WidgetShellTelemetry = OSLogWidgetShellTelemetry(),
        @ViewBuilder actions: @escaping @MainActor () -> Actions,
        @ViewBuilder content: @escaping @MainActor () -> Content
    ) {
        self.init(
            title: title, loading: loading, error: error, noPadding: noPadding,
            freshness: freshness, help: help, pin: pin, telemetry: telemetry,
            renderIcon: false, renderActions: true,
            icon: { EmptyView() }, actions: actions, content: content
        )
    }
}

public extension WidgetShell where Icon == EmptyView, Actions == EmptyView {
    /// Content only — the most common case (no icon, no actions).
    init(
        title: String? = nil,
        loading: Bool = false,
        error: String? = nil,
        noPadding: Bool = false,
        freshness: WidgetShellFreshness? = nil,
        help: WidgetHelp? = nil,
        pin: WidgetShellPin? = nil,
        telemetry: any WidgetShellTelemetry = OSLogWidgetShellTelemetry(),
        @ViewBuilder content: @escaping @MainActor () -> Content
    ) {
        self.init(
            title: title, loading: loading, error: error, noPadding: noPadding,
            freshness: freshness, help: help, pin: pin, telemetry: telemetry,
            renderIcon: false, renderActions: false,
            icon: { EmptyView() }, actions: { EmptyView() }, content: content
        )
    }
}
