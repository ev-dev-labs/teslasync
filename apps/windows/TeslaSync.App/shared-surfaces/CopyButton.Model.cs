using System.Globalization;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// Canonical metadata + i18n keys for the <c>CopyButton</c> shared surface — the native mirror of the web
/// component (web/src/components/ui/CopyButton.tsx). The web component is a one-click clipboard primitive: a
/// ghost button that writes a caller-supplied string to the clipboard, swaps its icon + label from "Copy"
/// (copy glyph) to "Copied" (check glyph) for two seconds, optionally raises a toast on success/failure, and
/// always logs a failed write. This metadata carries the diagnostics slug the surface registers under, the
/// two-second confirmation lifetime (web <c>setTimeout(() =&gt; setCopied(false), 2000)</c>) and every
/// render-contract i18n key/fallback the web source passes to <c>t()</c>, so the native surface reproduces the
/// web copy verbatim. Every key carries the <c>translation.</c> catalog prefix the WinUI resource bridge expects
/// (the convention every shipped surface uses) and resolves against the English fallback headlessly. UI-free so
/// it is asserted without a XAML host.
/// </summary>
public static class CopyButtonRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "CopyButton";

    /// <summary>
    /// The confirmation lifetime in milliseconds — how long the button shows the "Copied" state before reverting
    /// to "Copy" (web <c>setTimeout(() =&gt; setCopied(false), 2000)</c>). The revert timing itself is a view
    /// concern (a one-shot timer in the WinUI host), but the value is pinned here so it stays web-verbatim and is
    /// asserted headlessly.
    /// </summary>
    public const int RevertDelayMs = 2000;

    /// <summary>i18n key for the idle button label (web <c>common.copyButton.copy</c>).</summary>
    public const string CopyKey = "translation.common.copyButton.copy";

    /// <summary>English fallback for <see cref="CopyKey"/> (web second arg, verbatim).</summary>
    public const string CopyFallback = "Copy";

    /// <summary>i18n key for the confirmation label shown after a copy (web <c>common.copyButton.copied</c>).</summary>
    public const string CopiedKey = "translation.common.copyButton.copied";

    /// <summary>English fallback for <see cref="CopiedKey"/> (web second arg, verbatim).</summary>
    public const string CopiedFallback = "Copied";

    /// <summary>i18n key for the copy-succeeded toast (web <c>common.copyButton.successToast</c>).</summary>
    public const string SuccessToastKey = "translation.common.copyButton.successToast";

    /// <summary>English fallback for <see cref="SuccessToastKey"/> (web second arg, verbatim).</summary>
    public const string SuccessToastFallback = "Copied to clipboard";

    /// <summary>i18n key for the copy-failed toast (web <c>common.copyButton.errorToast</c>).</summary>
    public const string ErrorToastKey = "translation.common.copyButton.errorToast";

    /// <summary>English fallback for <see cref="ErrorToastKey"/> (web second arg, verbatim).</summary>
    public const string ErrorToastFallback = "Failed to copy";

    /// <summary>The confirmation lifetime as a <see cref="TimeSpan"/> (web 2000 ms), for the view's revert timer.</summary>
    public static TimeSpan RevertDelay => TimeSpan.FromMilliseconds(RevertDelayMs);
}

/// <summary>
/// The outcome of a copy attempt — the native port of the web <c>handleCopy</c> try / catch result
/// (web/src/components/ui/CopyButton.tsx L71-86): the clipboard write either succeeds (the web <c>try</c> body:
/// <c>setCopied(true)</c> + <c>onCopy?.()</c> + optional success toast) or fails (the web <c>catch</c>: optional
/// error toast + <c>console.error</c>). The view-model maps each value to the matching toast message and the
/// confirmation state, exactly as the web source does. Pure data so the outcome → toast mapping is unit-tested
/// without a clipboard or toast host.
/// </summary>
public enum CopyButtonOutcome
{
    /// <summary>web <c>try</c> path — the text reached the clipboard; confirm and (optionally) announce success.</summary>
    Copied,

    /// <summary>web <c>catch</c> path — the clipboard write failed; (optionally) announce the error and stay idle.</summary>
    Failed,
}

/// <summary>
/// Toast urgency for the copy outcome — the two tones the web source uses
/// (web/src/components/ui/CopyButton.tsx: <c>toast?.success(...)</c> on success, <c>toast?.error(...)</c> on
/// failure). Mapped by the view-model onto the shared toast queue's <c>Success</c> / <c>Error</c> verbs, and only
/// raised when the caller opted in via <c>withToast</c>.
/// </summary>
public enum CopyButtonToastSeverity
{
    /// <summary>web <c>toast.success</c> — polite confirmation that the text was copied.</summary>
    Success,

    /// <summary>web <c>toast.error</c> — assertive alert that the copy failed.</summary>
    Error,
}

/// <summary>
/// A toast the surface would raise — the native projection of the web <c>handleCopy</c> branch
/// (web/src/components/ui/CopyButton.tsx L76-83) that picks <c>toast.success</c> / <c>toast.error</c> and its
/// localized message from a <see cref="CopyButtonOutcome"/>. This mapping is unconditional (pure data); whether
/// it is actually shown is gated separately by the caller's <c>withToast</c> opt-in and the presence of a toast
/// overlay (the web <c>useOptionalToast</c> nullable result). Unit-tested without a toast host.
/// </summary>
public readonly record struct CopyButtonToastIntent(CopyButtonToastSeverity Severity, string Message);

/// <summary>
/// PII-safe diagnostics for the copy surface (P1/S11 diagnostics contract). The copied value is caller-supplied
/// content (API keys, ids, links, …) and is NEVER recorded; the collector emits ONLY operational signals — the
/// <see cref="RecordViewOpened"/> open event (with the surface slug) and the <see cref="RecordCopyFailed"/>
/// failed-write event (the native analogue of the web <c>console.error('CopyButton: clipboard write failed', …)</c>
/// on the <c>catch</c> path, recorded without the text or the underlying error payload). Thread-safe; mirrors the
/// shipped surfaces' collectors.
/// </summary>
public sealed class CopyButtonDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;
    private long _copyFailures;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public CopyButtonDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Number of failed clipboard writes observed (web <c>catch</c> path count).</summary>
    public long CopyFailures => Interlocked.Read(ref _copyFailures);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=CopyButton</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke(
            string.Create(CultureInfo.InvariantCulture, $"view.opened slug={CopyButtonRegistration.Slug}"));
    }

    /// <summary>
    /// Record a failed clipboard write, emitting <c>copy.failed slug=CopyButton</c> — the native analogue of the
    /// web <c>console.error</c> on the <c>catch</c> path, fired regardless of the <c>withToast</c> opt-in and
    /// without ever including the copied text or the platform error.
    /// </summary>
    public void RecordCopyFailed()
    {
        Interlocked.Increment(ref _copyFailures);
        _sink?.Invoke(
            string.Create(CultureInfo.InvariantCulture, $"copy.failed slug={CopyButtonRegistration.Slug}"));
    }
}
