//
//  FrontendErrorsCard.Projection.swift
//  TeslaSync — P4 feature view · 0243 · FrontendErrorsCard (Apple)
//
//  The pure projection from the coalesced input snapshot to the resolved view-state — extracted from
//  the state holder so the web component body (the headline total + the top-offender list + the
//  loading / no-data / no-errors branches) plus the P4 leaf contract stay unit testable in isolation
//  (no store, no SwiftUI).
//
//  Web branch order (reproduced verbatim):
//    isLoading                 → skeleton (loading)
//    !data                     → "Unable to load frontend error summary." (P4 leaf: retryable error)
//    data && top.length === 0  → headline total + "No frontend errors reported in the last hour."
//    data && top.length > 0    → headline total + offender list
//

import Foundation

// MARK: - Projection (web component body + P4 leaf contract)

/// Pure projection from the input snapshot to the resolved view-state — the native port of the web
/// `FrontendErrorsCard` render plus the P4 leaf contract. Unit tested across loading / error / empty
/// / data, the `total ?? 0` headline, and the offender name/route/count mapping.
public enum FrontendErrorsProjection {
    public static func resolve(
        _ input: FrontendErrorsInput,
        locale: Locale = .current
    ) -> FrontendErrorsResolved {
        // Web `if (isLoading) return <skeleton/>` — first load, no data yet.
        if input.isLoading, input.summary == nil {
            return FrontendErrorsResolved(phase: .loading)
        }
        // P4 leaf: an explicit query failure surfaces a retryable error (the web has no isError
        // branch; it falls through to the !data message — this is the sanctioned leaf enhancement).
        if let message = input.errorMessage, !message.isEmpty {
            return FrontendErrorsResolved(phase: .error(message))
        }
        // Web `if (!data) return "Unable to load frontend error summary."` — surfaced as a retryable
        // error so the operator can re-request (P4 leaf contract).
        guard let summary = input.summary else {
            return FrontendErrorsResolved(phase: .error(
                FrontendErrorsStrings.string(
                    "frontendErrors.unableToLoad",
                    "Unable to load frontend error summary."
                )
            ))
        }

        // Web `const total = data.total ?? 0` → fmtInt(total).
        let totalText = FrontendErrorsNumber.integer(summary.total, locale: locale)
        let rows = offenders(for: summary.top, locale: locale)

        // Web `top.length > 0 ? <list/> : <"No frontend errors…"/>`.
        if rows.isEmpty {
            return FrontendErrorsResolved(phase: .empty, totalText: totalText)
        }
        return FrontendErrorsResolved(phase: .data, totalText: totalText, offenders: rows)
    }

    // MARK: Offender list (web `top.map(...)`)

    /// Maps the raw top-offender rows to view-ready rows — the native port of the web `top.map`:
    /// `entry.name || '—'`, `entry.route || '—'`, `fmtInt(entry.count ?? 0)`. The stable id mirrors
    /// the web key `${name}|${route}|${idx}` so duplicate name/route pairs stay distinct.
    static func offenders(
        for entries: [FrontendErrorEntry],
        locale: Locale = .current
    ) -> [FrontendErrorsOffender] {
        entries.enumerated().map { index, entry in
            FrontendErrorsOffender(
                id: "\(entry.name)|\(entry.route)|\(index)",
                name: FrontendErrorsText.orDash(entry.name),
                route: FrontendErrorsText.orDash(entry.route),
                count: FrontendErrorsNumber.integer(entry.count, locale: locale)
            )
        }
    }
}
