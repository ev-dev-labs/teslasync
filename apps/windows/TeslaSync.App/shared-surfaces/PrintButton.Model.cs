using System.Globalization;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// Canonical metadata + i18n keys for the <c>PrintButton</c> shared surface — the native mirror of the web
/// component (web/src/components/ui/PrintButton.tsx). The web component is a single ghost button that opens the
/// browser print dialog (<c>window.print()</c>) for the current page, optionally running a caller-supplied
/// <c>beforePrint</c> hook first (expand panels, switch tabs) and guarding against re-entrant clicks with a
/// <c>printing</c> flag. This metadata carries the diagnostics slug the surface registers under and the single
/// render-contract i18n key/fallback the web source passes to <c>t()</c> (<c>common.printButton.print</c>), so the
/// native surface reproduces the web copy verbatim. The key carries the <c>translation.</c> catalog prefix the
/// WinUI resource bridge expects (the convention every shipped surface uses) and resolves against the English
/// fallback headlessly. UI-free so it is asserted without a XAML host.
/// </summary>
public static class PrintButtonRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "PrintButton";

    /// <summary>i18n key for the default button label (web <c>common.printButton.print</c>).</summary>
    public const string PrintKey = "translation.common.printButton.print";

    /// <summary>English fallback for <see cref="PrintKey"/> (web second arg, verbatim).</summary>
    public const string PrintFallback = "Print";
}

/// <summary>
/// The outcome of a print attempt — the native projection of the web <c>handleClick</c> control flow
/// (web/src/components/ui/PrintButton.tsx L58-79): a re-entrant click while already printing is ignored
/// (web <c>if (printing) return</c>); otherwise the optional <c>beforePrint</c> hook runs and, if it throws, the
/// button logs the failure and returns to idle without opening the dialog (web <c>catch</c> path); otherwise the
/// print experience is opened (web <c>window.print()</c>), which either shows or — like a thrown
/// <c>window.print()</c> — fails. Pure data so the click → outcome mapping is unit-tested without a print host.
/// </summary>
public enum PrintButtonOutcome
{
    /// <summary>web happy path — <c>beforePrint</c> resolved (or was absent) and the print experience opened.</summary>
    Printed,

    /// <summary>
    /// The print experience itself failed to open (the native analogue of a thrown <c>window.print()</c>); the web
    /// <c>finally</c> still clears the busy flag, and the native surface additionally records the failed open.
    /// </summary>
    PrintFailed,

    /// <summary>web <c>catch</c> path — the <c>beforePrint</c> hook threw; the dialog is NOT opened and the surface stays idle.</summary>
    BeforePrintFailed,

    /// <summary>web early return — a click arrived while a print was already in flight (<c>if (printing) return</c>); ignored.</summary>
    AlreadyPrinting,
}

/// <summary>
/// PII-safe diagnostics for the print surface (P1/S11 diagnostics contract). The surface carries no user content —
/// only the boolean busy flag — so the collector emits ONLY operational signals: the <see cref="RecordViewOpened"/>
/// open event (with the surface slug) and the <see cref="RecordPrintFailed"/> failed-print event. The latter is the
/// native analogue of the web <c>console.error('PrintButton: beforePrint failed', err)</c> on the
/// <c>beforePrint</c> catch path (recorded without the error payload), and is additionally raised when the print
/// experience fails to open (a condition the web leaves unlogged). Thread-safe; mirrors the shipped surfaces'
/// collectors.
/// </summary>
public sealed class PrintButtonDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;
    private long _printFailures;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">An optional sink the operational event line is written to.</param>
    public PrintButtonDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Number of failed prints observed (web <c>catch</c> path + failed dialog opens).</summary>
    public long PrintFailures => Interlocked.Read(ref _printFailures);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=PrintButton</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke(
            string.Create(CultureInfo.InvariantCulture, $"view.opened slug={PrintButtonRegistration.Slug}"));
    }

    /// <summary>
    /// Record a failed print, emitting <c>print.failed slug=PrintButton</c> — the native analogue of the web
    /// <c>console.error</c> on the <c>beforePrint</c> catch path (and the failed dialog-open path), recorded
    /// without the underlying error payload.
    /// </summary>
    public void RecordPrintFailed()
    {
        Interlocked.Increment(ref _printFailures);
        _sink?.Invoke(
            string.Create(CultureInfo.InvariantCulture, $"print.failed slug={PrintButtonRegistration.Slug}"));
    }
}
