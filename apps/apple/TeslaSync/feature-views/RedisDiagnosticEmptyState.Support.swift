//
//  RedisDiagnosticEmptyState.Support.swift
//  TeslaSync — P4 feature view · 0039 · RedisDiagnosticEmptyState (Apple)
//
//  Pure support utilities split off the projection core: the locale-aware timestamp
//  formatter (web `useDateFormat().formatDateTime`), the docs-URL resolver (web
//  app-relative `ctaHref` → absolute `Link` destination), and the VoiceOver summary
//  builders. All dependency-free + unit tested in isolation.
//

import Foundation

// MARK: - Timestamp formatting (web `useDateFormat().formatDateTime`)

/// Locale-aware timestamp formatter for the meta list + the stale-telemetry body (web
/// `formatDateTime`): a medium date + short time, or the em-dash sentinel when absent.
public enum RedisDiagnosticFormat {
    public static let dash = "—"

    public static func dateTime(
        _ date: Date?,
        locale: Locale = .current,
        timeZone: TimeZone = .current
    ) -> String {
        guard let date else { return dash }
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.timeZone = timeZone
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }
}

// MARK: - Docs URL (web app-relative `ctaHref` → absolute Link destination)

/// Resolves the web app-relative docs href (e.g. `/docs/caching#configuration`) into an
/// absolute `URL` for a native `Link`, against the app's base URL (the same default the
/// app uses, `https://teslasync.local`; the production app injects its configured base).
public enum RedisDiagnosticDocs {
    public static let defaultBase = URL(string: "https://teslasync.local")

    public static func url(forPath path: String, base: URL? = defaultBase) -> URL? {
        URL(string: path, relativeTo: base)?.absoluteURL
    }
}

// MARK: - Accessibility summaries (testable seam)

/// Builds the VoiceOver strings for the banner + the meta list + the chips. Pure + public
/// so the spoken content is asserted without rendering the view.
public enum RedisDiagnosticAccessibility {
    /// The combined banner label (web reads the heading then the paragraph).
    public static func bannerSummary(title: String, body: String) -> String {
        "\(title). \(body)"
    }

    /// One chip's label: the vehicle name plus its cached field count.
    public static func chipSummary(name: String, fieldCount: Int, localize: (String, String) -> String) -> String {
        let fields = localize("redis.diagnostic.fieldsA11y", "{{count}} cached fields")
        return "\(name), \(RDInterpolate.apply(fields, ["count": String(fieldCount)]))"
    }
}
