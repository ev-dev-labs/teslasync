package io.teslasync.shared.core.presentation.systemdiagnostic

/**
 * Serialises a [DiagnosticReport] to the plain-text "paste-into-a-support-ticket" format — the
 * cross-platform port of the web `formatDiagnosticReportText` helper
 * (web/src/api/hooks/useSystemDiagnostic.ts). It is exported as a pure, top-level function (not a
 * method on the store) so it stays testable, re-usable from a CLI, and byte-identical across the KMP
 * core and the Windows C# port — the golden vectors in `SystemDiagnosticGoldenTest` lock the exact
 * output so the two ports cannot drift (ADR-004).
 *
 * The layout mirrors the web helper line-for-line:
 *  - a fixed three-line header (`TeslaSync diagnostic report`, `Generated:`, `Overall:`),
 *  - a blank line, then `Checks:`,
 *  - one `  [STATUS] name (id) — Nms` line per check (status upper-cased, em-dash separator),
 *  - an indented `detail:` line ONLY when the detail is non-empty (the web `if (c.detail)` truthy
 *    test), and an indented `remediation:` line ONLY when a remediation is present (the web
 *    `if (c.remediation)` test; the field is `omitempty` upstream),
 *  - a trailing blank line so the joined output ends with a newline.
 *
 * The `detail:` / `remediation:` labels are space-padded to the same column exactly as the web
 * helper. No field is unit-bearing, so the value text is emitted verbatim with no SI conversion (S5).
 */
public fun formatDiagnosticReportText(report: DiagnosticReport): String {
    val lines = mutableListOf<String>()
    lines += "TeslaSync diagnostic report"
    lines += "Generated: ${report.generatedAt}"
    lines += "Overall:   ${report.overallStatus}"
    lines += ""
    lines += "Checks:"
    for (c in report.checks) {
        lines += "  [${c.status.uppercase()}] ${c.name} (${c.id}) — ${c.durationMs}ms"
        if (c.detail.isNotEmpty()) lines += "    detail:      ${c.detail}"
        if (!c.remediation.isNullOrEmpty()) lines += "    remediation: ${c.remediation}"
    }
    lines += ""
    return lines.joinToString("\n")
}
