using System.Globalization;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// Canonical metadata + i18n keys for the <c>CopyLinkButton</c> shared surface — the native mirror of the web
/// component (web/src/components/layout/CopyLinkButton.tsx). The web component is a single ghost button that
/// copies the current view's URL (path + query string) to the clipboard so a user can share a filtered /
/// deep-linked view, swapping its icon + label to a "Copied" confirmation for two seconds and announcing the
/// outcome on a toast. This metadata carries the diagnostics slug the surface registers under, the two-second
/// confirmation lifetime (web <c>window.setTimeout(() =&gt; setCopied(false), 2000)</c>) and every render-contract
/// i18n key/fallback the web source passes to <c>t()</c>, so the native surface reproduces the web copy verbatim.
/// Every key carries the <c>translation.</c> catalog prefix the WinUI resource bridge expects (the convention
/// every shipped surface uses) and resolves against the English fallback headlessly. UI-free so it is asserted
/// without a XAML host.
/// </summary>
public static class CopyLinkButtonRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "CopyLinkButton";

    /// <summary>
    /// The confirmation lifetime in milliseconds — how long the button shows the "Copied" state before reverting
    /// to "Copy link" (web <c>window.setTimeout(() =&gt; setCopied(false), 2000)</c>). The revert timing itself is a
    /// view concern (a one-shot timer in the WinUI host), but the value is pinned here so it stays web-verbatim and
    /// is asserted headlessly.
    /// </summary>
    public const int RevertDelayMs = 2000;

    /// <summary>i18n key for the idle button label (web <c>common.copyLink.action</c>).</summary>
    public const string ActionKey = "translation.common.copyLink.action";

    /// <summary>English fallback for <see cref="ActionKey"/> (web second arg, verbatim).</summary>
    public const string ActionFallback = "Copy link";

    /// <summary>i18n key for the confirmation label shown after a copy (web <c>common.copyLink.copied</c>).</summary>
    public const string CopiedKey = "translation.common.copyLink.copied";

    /// <summary>English fallback for <see cref="CopiedKey"/> (web second arg, verbatim).</summary>
    public const string CopiedFallback = "Copied";

    /// <summary>i18n key for the button's accessible name (web <c>common.copyLink.label</c> / <c>aria-label</c>).</summary>
    public const string LabelKey = "translation.common.copyLink.label";

    /// <summary>English fallback for <see cref="LabelKey"/> (web second arg, verbatim).</summary>
    public const string LabelFallback = "Copy link to this view";

    /// <summary>i18n key for the copy-succeeded toast (web <c>common.copyLink.success</c>).</summary>
    public const string SuccessKey = "translation.common.copyLink.success";

    /// <summary>English fallback for <see cref="SuccessKey"/> (web second arg, verbatim).</summary>
    public const string SuccessFallback = "Link copied to clipboard";

    /// <summary>i18n key for the copy-failed toast (web <c>common.copyLink.error</c>).</summary>
    public const string ErrorKey = "translation.common.copyLink.error";

    /// <summary>English fallback for <see cref="ErrorKey"/> (web second arg, verbatim).</summary>
    public const string ErrorFallback = "Could not copy link";

    /// <summary>The confirmation lifetime as a <see cref="TimeSpan"/> (web 2000 ms), for the view's revert timer.</summary>
    public static TimeSpan RevertDelay => TimeSpan.FromMilliseconds(RevertDelayMs);
}

/// <summary>
/// The outcome of a copy-link attempt — the native port of the web <c>handleClick</c> try / catch result
/// (web/src/components/layout/CopyLinkButton.tsx L25-44): the clipboard write either succeeds (the web
/// <c>try</c> body: <c>setCopied(true)</c> + success toast) or fails (the web <c>catch</c>: error toast). The
/// view-model maps each value to the matching toast intent and the confirmation state, exactly as the web source
/// does. Pure data so the outcome → toast mapping is unit-tested without a clipboard or toast host.
/// </summary>
public enum CopyLinkOutcome
{
    /// <summary>web <c>try</c> path — the link reached the clipboard; confirm and announce success.</summary>
    Copied,

    /// <summary>web <c>catch</c> path — the clipboard write failed; announce the error and stay idle.</summary>
    Failed,
}

/// <summary>
/// Toast urgency for the copy-link outcome — the two tones the web source uses
/// (web/src/components/layout/CopyLinkButton.tsx: <c>toast.success(...)</c> on success, <c>toast.error(...)</c>
/// on failure). Mapped by the view-model onto the shared toast queue's <c>Success</c> / <c>Error</c> verbs.
/// </summary>
public enum CopyLinkToastSeverity
{
    /// <summary>web <c>toast.success</c> — polite confirmation that the link was copied.</summary>
    Success,

    /// <summary>web <c>toast.error</c> — assertive alert that the copy failed.</summary>
    Error,
}

/// <summary>
/// A toast the surface wants to raise — the native projection of the web <c>handleClick</c> branch
/// (web/src/components/layout/CopyLinkButton.tsx L39-44) that picks <c>toast.success</c> / <c>toast.error</c> and
/// its localized message from a <see cref="CopyLinkOutcome"/>. Pure data, so the outcome → toast mapping is
/// unit-tested without a toast host.
/// </summary>
public readonly record struct CopyLinkToastIntent(CopyLinkToastSeverity Severity, string Message);

/// <summary>
/// PII-safe diagnostics for the copy-link surface (P1/S11 diagnostics contract). The copied value is a user
/// deep-link (path + query) and is never recorded; the collector emits ONLY the operational
/// <see cref="RecordViewOpened"/> signal with the surface slug — never the link, the clipboard payload, or any
/// query parameters. Thread-safe; mirrors the shipped surfaces' collectors.
/// </summary>
public sealed class CopyLinkButtonDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public CopyLinkButtonDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=CopyLinkButton</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke(
            string.Create(
                CultureInfo.InvariantCulture,
                $"view.opened slug={CopyLinkButtonRegistration.Slug}"));
    }
}
