namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// Canonical metadata for the VisuallyHidden announcer surface — the native analogue of the
/// module-level constants in web/src/components/a11y/VisuallyHidden.tsx and its companion
/// useAnnouncer hook (web/src/hooks/useAnnouncer.ts). The web component is anonymous (it renders no
/// titles or labels of its own), so this carries only the diagnostics slug the surface registers under.
/// </summary>
public static class VisuallyHiddenRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "VisuallyHidden";
}

/// <summary>
/// Live-region urgency — the native analogue of the web <c>AnnouncerPriority</c> and the
/// <c>VisuallyHidden</c> <c>priority</c> prop. <see cref="Polite"/> waits for the screen reader to finish
/// its current activity; <see cref="Assertive"/> interrupts (reserved for genuine errors and
/// security-sensitive messages, exactly as the web doc-comment instructs).
/// </summary>
public enum AnnouncerPriority
{
    /// <summary>web <c>'polite'</c> — the default; waits for the assistive technology to finish.</summary>
    Polite,

    /// <summary>web <c>'assertive'</c> — interrupts the assistive technology immediately.</summary>
    Assertive,
}

/// <summary>
/// Pure message formatting for announcements — the native port of the web <c>announce</c> de-duplication
/// trick (web/src/hooks/useAnnouncer.ts): a rotating zero-width-space suffix
/// (<c>'\u200B'.repeat(counter % 4)</c>) is appended so a screen reader re-voices identical consecutive
/// messages instead of skipping them. Kept static and side-effect-free so the rotation is unit-testable
/// without an <see cref="Announcer"/> instance.
/// </summary>
public static class AnnouncerMessage
{
    /// <summary>The zero-width space (U+200B) appended to force re-announcement of duplicates.</summary>
    public const char ZeroWidthSpace = '\u200B';

    /// <summary>
    /// Append the rotating zero-width-space suffix for <paramref name="counter"/> (web
    /// <c>message + '\u200B'.repeat(counter % 4)</c>). The mod-4 keeps the suffix bounded so the message
    /// length never grows without limit; a zero remainder leaves the message unchanged. Negative counters
    /// are normalised so the remainder is always in the range 0..3.
    /// </summary>
    public static string Pad(string message, int counter)
    {
        ArgumentNullException.ThrowIfNull(message);
        int repeat = ((counter % 4) + 4) % 4;
        return repeat == 0 ? message : message + new string(ZeroWidthSpace, repeat);
    }
}

/// <summary>
/// The ARIA live-region attribute triplet a <c>liveRegion</c> VisuallyHidden wires — the native port of
/// the web component's <c>liveProps</c> object (web/src/components/a11y/VisuallyHidden.tsx). When the
/// element is a live region it pairs <see cref="Role"/> (<c>'status'</c> for polite, <c>'alert'</c> for
/// assertive) with <see cref="Live"/> (the priority value) and <see cref="Atomic"/> (<c>aria-atomic</c>);
/// when it is not a live region every member is the inert default (web <c>liveProps === undefined</c>).
/// The string members mirror the web ARIA values exactly; the WinUI view maps <see cref="Live"/> to an
/// <c>AutomationLiveSetting</c> at the platform boundary.
/// </summary>
public readonly record struct LiveRegionSemantics(string? Role, string? Live, bool Atomic)
{
    /// <summary>Compute the triplet for a region (web <c>liveProps</c>).</summary>
    public static LiveRegionSemantics For(bool liveRegion, AnnouncerPriority priority)
    {
        if (!liveRegion)
        {
            return new LiveRegionSemantics(null, null, false);
        }

        // web: role = priority === 'assertive' ? 'alert' : 'status'; aria-live = priority; aria-atomic true.
        return priority == AnnouncerPriority.Assertive
            ? new LiveRegionSemantics("alert", "assertive", true)
            : new LiveRegionSemantics("status", "polite", true);
    }
}

/// <summary>
/// PII-safe diagnostics for the VisuallyHidden surface (P1/S11 diagnostics contract). Announcements can
/// carry user-facing content, so the collector records only the operational <c>view.opened</c> event with
/// the surface slug — never the announced text. Thread-safe.
/// </summary>
public sealed class VisuallyHiddenDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public VisuallyHiddenDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=VisuallyHidden</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={VisuallyHiddenRegistration.Slug}");
    }
}
