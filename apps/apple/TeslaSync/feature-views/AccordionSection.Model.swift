//
//  AccordionSection.Model.swift
//  TeslaSync — P4 feature view · 0236 · AccordionSection (Apple)
//
//  Host-free state holder + seams for the accordion section, mirroring
//  web/src/features/system/components/status/AccordionSection.tsx:
//
//    • local open/closed state : the web `useState(defaultOpen)` flipped by the header
//                                (click + Enter/Space) — here a host-free, unit-testable
//                                `@Observable` model so the toggle contract is verified
//                                without a rendering host.
//    • P1/S11 telemetry seam    : emits `view.opened` with the surface slug once.
//    • P1/S10 i18n facade        : resolves the accessibility value/hint copy by key.
//
//  PARITY NOTE — the web source is a *pure presentational container*: it binds no data
//  hook, fetches nothing, and renders no text of its own (icon / title / description /
//  badges / body are ALL caller-supplied). It therefore has NO loading / empty / error /
//  stale / offline data envelope — its only render states are `collapsed` and `expanded`.
//  This model reproduces exactly that surface contract and nothing more (no fabricated
//  data states), which is itself the faithful parity.
//
//  Deliberately SwiftUI-free (Foundation + Observation + OSLog only) so the whole state
//  machine is host-free unit-testable.
//

import Foundation
import Observation
import OSLog

// MARK: - Surface identity (P1/S11 `view.opened`)

/// Stable, non-identifying identity for the surface. The slug is the value emitted with
/// the diagnostics contract and is shared by the view and its tests so the two never drift.
public enum AccordionSectionSurface {
    /// The diagnostics slug emitted with the `view.opened` event.
    public static let slug = "AccordionSection"

    /// Reports the surface becoming visible — factored out so it is unit-testable without
    /// a rendering host.
    public static func reportOpen(to telemetry: any AccordionSectionTelemetry) {
        telemetry.viewOpened(surface: slug)
    }
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Diagnostics seam for the `view.opened` contract. `Sendable` so the view can emit from
/// `onAppear` and so a default sink can be an `init` default argument.
public protocol AccordionSectionTelemetry: Sendable {
    /// A surface became visible. `surface` is a stable, non-identifying slug.
    func viewOpened(surface: String)
}

/// Default sink: emits a redaction-safe `view.opened` `os_log` event. The slug is a
/// static, non-identifying constant; no payload, VIN, or location is recorded.
public struct OSLogAccordionSectionTelemetry: AccordionSectionTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Localization facade (P1/S10)

/// Resolves the surface's strings by key with an English fallback so the Swift holds no
/// hardcoded literals. Keys live in the "AccordionSection" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time.
///
/// The web source renders no text of its own (it is an anonymous container — every label
/// is a caller-supplied prop), so NONE of these keys are web-extracted. They back the
/// native accessibility value/hint that the platform requires but the web gets implicitly
/// from `role="button"` + `aria-expanded` on the DOM node.
public enum AccordionSectionStrings {
    public static let table = "AccordionSection"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// The spoken expansion state of the header (web `aria-expanded`).
    public static func accessibilityValue(isOpen: Bool) -> String {
        isOpen
            ? string("accordionSection.a11y.expanded", "Expanded")
            : string("accordionSection.a11y.collapsed", "Collapsed")
    }

    /// The spoken action hint — what activating the header will do next.
    public static func accessibilityHint(isOpen: Bool) -> String {
        isOpen
            ? string("accordionSection.a11y.hint.collapse", "Collapses this section")
            : string("accordionSection.a11y.hint.expand", "Expands this section")
    }
}

// MARK: - State holder (P1/S8) — web `useState(defaultOpen)`

/// The surface's observable view-model. Holds the open/closed state (web `open`), flips it
/// on header activation (web click + Enter/Space), emits `view.opened` once, and projects
/// the chevron rotation + accessibility copy so those are host-free unit-testable.
@MainActor
@Observable
public final class AccordionSectionModel {
    /// Whether the section body is revealed (web `open`).
    public private(set) var isOpen: Bool

    @ObservationIgnored private let telemetry: any AccordionSectionTelemetry
    @ObservationIgnored private var didReportOpen = false

    public init(
        defaultOpen: Bool = false,
        telemetry: any AccordionSectionTelemetry = OSLogAccordionSectionTelemetry()
    ) {
        isOpen = defaultOpen
        self.telemetry = telemetry
    }

    /// Emits the `view.opened` diagnostics event once for this surface instance. Idempotent
    /// so repeated `onAppear` (re-layout, tab switches) does not double-count.
    public func start() {
        guard !didReportOpen else { return }
        didReportOpen = true
        telemetry.viewOpened(surface: AccordionSectionSurface.slug)
    }

    /// Flips the section open/closed (web header `onClick` / Enter / Space).
    public func toggle() {
        isOpen.toggle()
    }

    /// Sets the open state explicitly (e.g. an external collapse-all control).
    public func setOpen(_ open: Bool) {
        isOpen = open
    }

    /// The chevron's rotation in degrees (web `open && 'rotate-180'`).
    public var chevronRotationDegrees: Double {
        isOpen ? 180 : 0
    }

    /// The spoken expansion state for the header control (web `aria-expanded`).
    public var accessibilityValue: String {
        AccordionSectionStrings.accessibilityValue(isOpen: isOpen)
    }

    /// The spoken action hint for the header control.
    public var accessibilityHint: String {
        AccordionSectionStrings.accessibilityHint(isOpen: isOpen)
    }
}

// MARK: - Surface slug accessor

public extension AccordionSectionModel {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    static var surfaceSlug: String {
        AccordionSectionSurface.slug
    }
}
