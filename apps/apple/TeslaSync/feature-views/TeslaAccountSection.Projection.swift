//
//  TeslaAccountSection.Projection.swift
//  TeslaSync — P4 feature view · 0216 · TeslaAccountSection (Apple)
//
//  The pure projection from the coalesced status snapshot to the resolved view-state — extracted from
//  the state holder so the web component body (the status ladder, the expiring-soon pill, the
//  token-expiry line, the action-set selector) plus the P4 leaf contract stay unit testable in
//  isolation (no store, no SwiftUI).
//
//  Web branch order (reproduced):
//    isLoading & nothing resolved → loading skeleton (P4 leaf)
//    explicit fetch error         → retryable error (P4 leaf)
//    authenticated == nil         → empty (web "auth status unknown" — friendly, never blank)
//    otherwise                    → data (connected / disconnected / not-connected)
//

import Foundation

/// Pure projection from the status snapshot to the resolved view-state — the native port of the web
/// `TeslaAccountSection` render plus the P4 leaf contract. Unit tested across loading / error / empty /
/// data, every status kind, the expiring-soon arithmetic, and the token-expiry line.
public enum TeslaAccountProjection {
    public static func resolve(
        _ input: TeslaAccountStatusInput,
        localize: TeslaAccountLocalize = TeslaAccountStrings.string,
        locale: Locale = .current,
        timeZone: TimeZone = .current
    ) -> TeslaAccountResolved {
        // Initial fetch — nothing resolved yet (P4 leaf loading skeleton). A background refresh that
        // still carries a known auth signal is NOT loading; it keeps rendering the section.
        if input.isLoading, input.authenticated == nil, input.expiresAtRaw == nil, input.errorMessage == nil {
            return TeslaAccountResolved(phase: .loading)
        }
        // Explicit fetch failure → retryable error (P4 leaf; the web has no error branch — it is the
        // sanctioned leaf enhancement so the operator can re-request the auth status).
        if let message = input.errorMessage, !message.isEmpty {
            return TeslaAccountResolved(phase: .error(message))
        }

        let presentation = presentation(
            input: input,
            localize: localize,
            locale: locale,
            timeZone: timeZone
        )

        // A resolved-but-unknown authenticated flag is the section's friendly "empty" surface; a
        // concrete true/false is the data surface. Both render the same chrome, never a blank box.
        if input.authenticated == nil {
            return TeslaAccountResolved(phase: .empty(presentation))
        }
        return TeslaAccountResolved(phase: .data(presentation))
    }

    // MARK: Presentation (web status row + expiring pill + token line + action selector)

    static func presentation(
        input: TeslaAccountStatusInput,
        localize: TeslaAccountLocalize,
        locale: Locale,
        timeZone: TimeZone
    ) -> TeslaAccountPresentation {
        let expiry = TeslaAccountDate.expiry(from: input.expiresAtRaw)
        let statusKind = TeslaAccountLogic.statusKind(
            authenticated: input.authenticated,
            pillDisconnected: input.pillDisconnected
        )
        let isAuthenticated = TeslaAccountLogic.isAuthenticated(input.authenticated)
        let statusLabel = statusLabel(for: statusKind, localize: localize)
        let reconnectBody = statusKind == .disconnected
            ? localize("tesla.reauth.body", "Reconnect to resume live data and commands.")
            : nil

        // The "expires soon" pill only renders inside the web connected branch.
        let expiringDays = statusKind == .connected
            ? TeslaAccountLogic.expiringSoonDays(
                authenticated: input.authenticated,
                expiry: expiry,
                now: input.now
            )
            : nil
        let expiringLabel = expiringSoonLabel(days: expiringDays, localize: localize, locale: locale)

        let tokenExpiresLine = tokenExpiresLine(
            statusKind: statusKind,
            expiry: expiry,
            localize: localize,
            locale: locale,
            timeZone: timeZone
        )

        let summary = TeslaAccountAccessibility.summary(
            title: localize("tesla.title", "Tesla Account"),
            status: statusLabel,
            detail: accessibilityDetail(
                statusKind: statusKind,
                expiringLabel: expiringLabel,
                tokenExpiresLine: tokenExpiresLine,
                reconnectBody: reconnectBody
            )
        )

        return TeslaAccountPresentation(
            statusKind: statusKind,
            isAuthenticated: isAuthenticated,
            statusLabel: statusLabel,
            reconnectBody: reconnectBody,
            expiringSoonDays: expiringDays,
            expiringSoonLabel: expiringLabel,
            tokenExpiresLine: tokenExpiresLine,
            accessibilitySummary: summary
        )
    }

    // MARK: Expiring-soon label (web `Expires in {{days}}d`)

    static func expiringSoonLabel(days: Int?, localize: TeslaAccountLocalize, locale: Locale) -> String? {
        days.map { value in
            String(
                format: localize("tesla.expiringSoon", "Expires in %@d"),
                TeslaAccountNumber.integer(value, locale: locale)
            )
        }
    }

    // MARK: Accessibility detail (web status-row detail copy)

    static func accessibilityDetail(
        statusKind: TeslaAccountStatusKind,
        expiringLabel: String?,
        tokenExpiresLine: String?,
        reconnectBody: String?
    ) -> String {
        let parts: [String] = switch statusKind {
        case .connected:
            [expiringLabel, tokenExpiresLine].compactMap(\.self)
        case .disconnected:
            [reconnectBody].compactMap(\.self)
        case .notConnected:
            []
        }
        return parts.joined(separator: ". ")
    }

    // MARK: Status label (web `tesla.connected` / `.disconnected` / `.notConnected`)

    static func statusLabel(for kind: TeslaAccountStatusKind, localize: TeslaAccountLocalize) -> String {
        switch kind {
        case .connected:
            localize("tesla.connected", "Connected")
        case .disconnected:
            localize("tesla.disconnected", "Disconnected")
        case .notConnected:
            localize("tesla.notConnected", "Not connected")
        }
    }

    // MARK: Token-expiry line (web `{tesla.tokenExpires} {formatDateTime(expires_at)}`)

    /// The token-expiry line shown in the connected branch when an expiry string is present. A
    /// present-but-unparseable expiry renders the web `formatDateTime` fallback dash; a missing expiry
    /// renders no line (web `auth.expires_at &&`).
    static func tokenExpiresLine(
        statusKind: TeslaAccountStatusKind,
        expiry: TeslaAccountExpiry,
        localize: TeslaAccountLocalize,
        locale: Locale,
        timeZone: TimeZone
    ) -> String? {
        guard statusKind == .connected else { return nil }
        let label = localize("tesla.tokenExpires", "Token expires")
        switch expiry {
        case let .at(date):
            let formatted = TeslaAccountDate.formatExpiry(date, locale: locale, timeZone: timeZone)
            return "\(label) \(formatted)"
        case .unparseable:
            return "\(label) —"
        case .none:
            return nil
        }
    }
}
