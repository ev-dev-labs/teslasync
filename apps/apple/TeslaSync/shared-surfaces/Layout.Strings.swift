//
//  Layout.Strings.swift
//  TeslaSync — P4 shared surface · 0169 · Layout (Apple)
//
//  The P1/S10 i18n facade for the app shell — the native peer of the `t(key, default)` calls in `Layout.tsx`.
//  It resolves the surface's strings by key with the web English fallback, so the views hold no hardcoded
//  prose. The 20 keys the web source uses are mirrored verbatim (see the "Web source keys" group); the rest
//  are the native chrome / a11y keys the P4 leaf states + freshness axis need. Keys live in the "Layout"
//  table, folded into the app `Localizable.xcstrings` at integration time; in test / preview bundles
//  `NSLocalizedString` returns the `value:` fallback, keeping the labels deterministic.
//
//  Nav item labels + section titles are NOT here: the web renders them verbatim from `navSections`
//  (`navI18nKeys` is intentionally empty), so they are data carried by ``LayoutNavCatalog``.
//

import Foundation

/// Resolves the surface's strings by key with the web English fallback (the P1/S10 facade).
public enum LayoutStrings {
    public static let table = "Layout"

    public static let string: LayoutResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    // MARK: - Web source keys (verbatim from Layout.tsx)

    /// Web `t('theme.openPicker', 'Open theme picker')`.
    public static var themeOpenPicker: String {
        string("theme.openPicker", "Open theme picker")
    }

    /// Web `t('theme.customize', 'Customize…')`.
    public static var themeCustomize: String {
        string("theme.customize", "Customize…")
    }

    /// Web `t('alerts.toast.title', 'Alert')`.
    public static var alertsToastTitle: String {
        string("alerts.toast.title", "Alert")
    }

    /// Web `t('alerts.toast.view', 'View')`.
    public static var alertsToastView: String {
        string("alerts.toast.view", "View")
    }

    /// Web `t('a11y.primaryNav', 'Primary')` — the sidebar's accessible name.
    public static var a11yPrimaryNav: String {
        string("a11y.primaryNav", "Primary")
    }

    /// Web `t('nav.closeSidebar', 'Close sidebar')`.
    public static var navCloseSidebar: String {
        string("nav.closeSidebar", "Close sidebar")
    }

    /// Web `t('nav.currentSection', 'Current')` — the active-section card's accessible name.
    public static var navCurrentSection: String {
        string("nav.currentSection", "Current")
    }

    /// Web `t('nav.unpinCurrent', 'Remove current page from pinned')`.
    public static var navUnpinCurrent: String {
        string("nav.unpinCurrent", "Remove current page from pinned")
    }

    /// Web `t('nav.pinCurrent', 'Pin current page')`.
    public static var navPinCurrent: String {
        string("nav.pinCurrent", "Pin current page")
    }

    /// Web `t('nav.pinnedAction', 'Pinned')` — the active-card pin button's pressed label.
    public static var navPinnedAction: String {
        string("nav.pinnedAction", "Pinned")
    }

    /// Web `t('nav.pinAction', 'Pin')` — the active-card pin button's idle label.
    public static var navPinAction: String {
        string("nav.pinAction", "Pin")
    }

    /// Web `t('nav.pinned', 'Pinned')` — the pinned-group header.
    public static var navPinned: String {
        string("nav.pinned", "Pinned")
    }

    /// Web `t('nav.recentlyUsed', 'Recently Used')` — the recent-group header.
    public static var navRecentlyUsed: String {
        string("nav.recentlyUsed", "Recently Used")
    }

    /// Web `t('nav.sections', 'Sections')` — the sections-group header.
    public static var navSections: String {
        string("nav.sections", "Sections")
    }

    /// Web `t('nav.expandAll', 'Expand all sections')`.
    public static var navExpandAll: String {
        string("nav.expandAll", "Expand all sections")
    }

    /// Web `t('nav.collapseAll', 'Collapse all sections')`.
    public static var navCollapseAll: String {
        string("nav.collapseAll", "Collapse all sections")
    }

    /// Web `t('a11y.primaryHeader', 'Site header')` — the header's accessible name.
    public static var a11yPrimaryHeader: String {
        string("a11y.primaryHeader", "Site header")
    }

    /// Web `t('nav.openSidebar', 'Open sidebar')`.
    public static var navOpenSidebar: String {
        string("nav.openSidebar", "Open sidebar")
    }

    /// Web `t('nav.quickSearchHint', 'Ctrl+K to jump')`.
    public static var navQuickSearchHint: String {
        string("nav.quickSearchHint", "Ctrl+K to jump")
    }

    /// Web `t('nav.unpinPage', { page, defaultValue: 'Unpin {{page}}' })` — interpolated per page label.
    public static func navUnpinPage(_ page: String) -> String {
        string("nav.unpinPage", "Unpin {{page}}").replacingOccurrences(of: "{{page}}", with: page)
    }

    // MARK: - Native chrome / a11y additions (no blank box — see the leaf states)

    /// VoiceOver label for the initial loading skeleton (web has no shell loading state).
    public static var loadingA11y: String {
        string("layout.loadingA11y", "Loading navigation")
    }

    /// Title of the empty-navigation state (the web shell never fully empties; the P4 contract shows it).
    public static var emptyTitle: String {
        string("layout.emptyTitle", "No navigation available")
    }

    /// Message under the empty-navigation state.
    public static var emptyMessage: String {
        string("layout.emptyMessage", "Sign in or add a vehicle to populate the menu.")
    }

    /// Title of the error tile shown when a shell feed fails (web has no QueryError peer in the shell).
    public static var errorTitle: String {
        string("layout.errorTitle", "Couldn't load the menu")
    }

    /// Retry action on the error tile.
    public static var retry: String {
        string("layout.retry", "Retry")
    }

    /// Accessible name of a navigation destination row, suffixed with the current/badge context.
    public static var openSection: String {
        string("layout.openSection", "Toggle section")
    }

    /// Freshness chip label — the shell feeds are live.
    public static var live: String {
        string("layout.live", "Live")
    }

    /// Freshness chip label — the shell feeds are older than the freshness window.
    public static var stale: String {
        string("layout.stale", "Stale")
    }

    /// Freshness chip label — no connectivity; cached chrome is shown.
    public static var offline: String {
        string("layout.offline", "Offline")
    }

    /// Expanded VoiceOver label for the stale freshness chip (it is a refresh button).
    public static var staleA11y: String {
        string("layout.staleA11y", "Stale — tap to refresh")
    }

    /// Expanded VoiceOver label for the offline freshness chip.
    public static var offlineA11y: String {
        string("layout.offlineA11y", "Offline — showing the cached menu")
    }

    /// VoiceOver label for the main content region (web `<main role="main">`).
    public static var mainContent: String {
        string("layout.mainContent", "Main content")
    }

    /// Accessible name of the notification-bell trigger the shell places (web `NotificationBellPopover`).
    public static var notifications: String {
        string("layout.notifications", "Notifications")
    }

    /// Stand-in copy for the host-content slot in standalone previews/tests.
    public static var contentSlot: String {
        string("layout.contentSlot", "Page content appears here.")
    }
}
