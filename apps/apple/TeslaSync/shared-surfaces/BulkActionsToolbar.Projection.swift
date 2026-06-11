//
//  BulkActionsToolbar.Projection.swift
//  TeslaSync — P4 shared surface · 0078 · BulkActionsToolbar (Apple)
//
//  The pure projection from the input snapshot to the resolved view-state, split from the model for
//  the lint length budget. Everything here is deterministic and resolves its copy through the
//  injected `BulkActionsResolve` seam, so the rendered text + every render branch is asserted without
//  a view or a bundle. The web "render nothing while the selection is empty" gate becomes the
//  friendly empty state (P4 leaf contract), so the surface never collapses to a blank box.
//

import Foundation

// MARK: - Resolved view-state (web render branches + P4 leaf contract)

/// The resolved, view-ready state — `phase` selects the body, and for the `active` phase every label
/// is already localized + every action already projected, so the view is a pure function of this
/// value.
public struct BulkActionsResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        case loading
        case empty
        case error(String)
        case active
    }

    public let phase: Phase
    public let count: Int
    public let countLabel: String
    public let nounText: String?
    public let totalText: String?
    public let toolbarLabel: String
    public let selectionSummary: String
    public let clearLabel: String
    public let actions: [BulkActionViewState]

    public init(
        phase: Phase,
        count: Int,
        countLabel: String,
        nounText: String?,
        totalText: String?,
        toolbarLabel: String,
        selectionSummary: String,
        clearLabel: String,
        actions: [BulkActionViewState]
    ) {
        self.phase = phase
        self.count = count
        self.countLabel = countLabel
        self.nounText = nounText
        self.totalText = totalText
        self.toolbarLabel = toolbarLabel
        self.selectionSummary = selectionSummary
        self.clearLabel = clearLabel
        self.actions = actions
    }

    /// A non-active chrome state (loading / empty / error) — keeps the localized toolbar + clear
    /// labels for accessibility while carrying no selection content.
    static func chrome(phase: Phase, toolbarLabel: String, clearLabel: String) -> BulkActionsResolved {
        BulkActionsResolved(
            phase: phase,
            count: 0,
            countLabel: "",
            nounText: nil,
            totalText: nil,
            toolbarLabel: toolbarLabel,
            selectionSummary: "",
            clearLabel: clearLabel,
            actions: []
        )
    }
}

// MARK: - Projection (web render branches + P4 leaf contract)

/// Pure projection from the input snapshot to the resolved view-state — the native port of the web
/// component's gate (`if (count === 0) return null`) plus the P4 leaf contract. Unit tested across
/// loading / empty / error / active and the per-action disabled-or-pending + confirm-required rules.
public enum BulkActionsProjection {
    public static func resolve(
        _ input: BulkActionsInput,
        inFlight: Set<String> = [],
        strings: BulkActionsResolve = BulkActionsToolbarStrings.string
    ) -> BulkActionsResolved {
        let toolbarLabel = strings("bulk.toolbarLabel", "Bulk actions for selected items")
        let clearLabel = strings("bulk.clear", "Clear selection")

        // P4 contract: a source feed failure surfaces at the leaf as `error`.
        if let message = input.errorMessage, !message.isEmpty {
            return .chrome(phase: .error(message), toolbarLabel: toolbarLabel, clearLabel: clearLabel)
        }
        // Initial fetch (web parent `isLoading`).
        if input.isLoading {
            return .chrome(phase: .loading, toolbarLabel: toolbarLabel, clearLabel: clearLabel)
        }
        // Web gate: an empty selection renders nothing → native friendly empty state.
        guard !input.selection.isEmpty else {
            return .chrome(phase: .empty, toolbarLabel: toolbarLabel, clearLabel: clearLabel)
        }

        let count = input.selection.count
        let countLabel = BulkActionsFormat.countLabel(count: count, strings: strings)
        let nounText = input.itemNoun.map { _ in
            BulkActionsFormat.noun(count: count, itemNoun: input.itemNoun, strings: strings)
        }
        let totalText = input.itemNoun != nil
            ? input.total.map { BulkActionsFormat.totalLabel(total: $0, strings: strings) }
            : nil
        let selectionSummary = BulkActionsAccessibility.selectionSummary(
            countLabel: countLabel,
            nounText: nounText,
            totalText: totalText
        )
        let actions = input.actions.map { descriptor in
            project(descriptor, isPending: inFlight.contains(descriptor.id), strings: strings)
        }
        return BulkActionsResolved(
            phase: .active,
            count: count,
            countLabel: countLabel,
            nounText: nounText,
            totalText: totalText,
            toolbarLabel: toolbarLabel,
            selectionSummary: selectionSummary,
            clearLabel: clearLabel,
            actions: actions
        )
    }

    /// Projects one descriptor into its display peer — the web `disabled || pending` rule plus the
    /// composed VoiceOver hint.
    private static func project(
        _ descriptor: BulkActionDescriptor,
        isPending: Bool,
        strings: BulkActionsResolve
    ) -> BulkActionViewState {
        let requiresConfirm = descriptor.confirm != nil
        return BulkActionViewState(
            id: descriptor.id,
            label: descriptor.label,
            systemImage: descriptor.systemImage,
            variant: descriptor.variant,
            isDisabled: descriptor.isDisabled || isPending,
            isPending: isPending,
            requiresConfirm: requiresConfirm,
            accessibilityLabel: descriptor.label,
            accessibilityHint: BulkActionsAccessibility.actionHint(
                isPending: isPending,
                requiresConfirm: requiresConfirm,
                strings: strings
            )
        )
    }
}
