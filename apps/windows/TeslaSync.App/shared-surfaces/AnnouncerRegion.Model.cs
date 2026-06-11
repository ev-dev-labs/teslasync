using System.Globalization;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// Live-region urgency — the native analogue of the web announcer's
/// <c>AnnouncerPriority = 'polite' | 'assertive'</c> (web/src/hooks/useAnnouncer.ts).
/// <see cref="Polite"/> (the default, ordinal 0, matching the web <c>priority = 'polite'</c>
/// default) waits for assistive technology to finish its current activity; <see cref="Assertive"/>
/// interrupts and is reserved for genuine errors / security-sensitive messages.
/// </summary>
public enum AnnouncerPriority
{
    /// <summary>Wait for the screen reader to finish (web <c>'polite'</c>, role <c>status</c>).</summary>
    Polite = 0,

    /// <summary>Interrupt the screen reader (web <c>'assertive'</c>, role <c>alert</c>).</summary>
    Assertive = 1,
}

/// <summary>
/// Canonical metadata for the announcer surface — the native analogue of the module-level identity in the
/// web <c>AnnouncerRegion</c> / <c>useAnnouncer</c> (web/src/components/a11y/AnnouncerRegion.tsx). The web
/// surface is anonymous (it renders only the two visually-hidden live regions and carries no title or label),
/// so the only registered identity is the diagnostics slug emitted with the <c>view.opened</c> event.
/// </summary>
public static class AnnouncerRegionRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "AnnouncerRegion";
}

/// <summary>
/// The duplicate-message de-duplication used by the announcer — the native port of the web
/// <c>announce()</c> padding logic (web/src/hooks/useAnnouncer.ts L75-L80). Screen readers skip an
/// announcement whose text is identical to the previous one, so each announcement appends a rotating run of
/// zero-width spaces (count = <c>counter % 4</c>) to force a fresh string the assistive technology will
/// re-read. The suffix is bounded to 0-3 characters so the message length never grows unbounded.
/// </summary>
public static class AnnouncerText
{
    /// <summary>The zero-width space (U+200B) appended to defeat the screen-reader duplicate-skip (web <c>'\u200B'</c>).</summary>
    public const char ZeroWidthSpace = '\u200B';

    /// <summary>The number of distinct padding states the suffix rotates through (web <c>% 4</c>).</summary>
    public const int PaddingModulo = 4;

    /// <summary>
    /// Append the rotating zero-width-space suffix for the given monotonic announcement
    /// <paramref name="counter"/> — the native port of the web
    /// <c>'\u200B'.repeat(announceCounter % 4)</c>. The counter is the post-increment announcement ordinal
    /// (1 for the first announcement); the suffix length is <c>counter % 4</c>, so successive announcements
    /// of the same message yield distinct strings and the screen reader re-reads each.
    /// </summary>
    public static string Pad(string message, int counter)
    {
        ArgumentNullException.ThrowIfNull(message);

        // Mirror the web `counter % 4`; the extra `+ PaddingModulo) % PaddingModulo` keeps the run
        // non-negative if a caller ever supplies a negative ordinal (the bus only ever increments from 0).
        var run = ((counter % PaddingModulo) + PaddingModulo) % PaddingModulo;
        return run == 0 ? message : message + new string(ZeroWidthSpace, run);
    }
}

/// <summary>
/// The payload for a single announcer fan-out — the new live-region text and its urgency. It is the native
/// analogue of the two arguments the web <c>AnnouncerListener</c> receives
/// (<c>(message, priority)</c>, web/src/hooks/useAnnouncer.ts L42-L45): <see cref="Message"/> is the padded
/// text (see <see cref="AnnouncerText.Pad"/>) and <see cref="Priority"/> selects which live region speaks it.
/// </summary>
public sealed class AnnouncerMessageEventArgs(string message, AnnouncerPriority priority) : EventArgs
{
    /// <summary>The padded announcement text to voice (web listener's <c>message</c>).</summary>
    public string Message { get; } = message;

    /// <summary>Which live region voices the message (web listener's <c>priority</c>).</summary>
    public AnnouncerPriority Priority { get; } = priority;
}

/// <summary>
/// PII-safe diagnostics for the announcer surface (P1/S11 diagnostics contract). Announcement text can carry
/// arbitrary user-facing content (vehicle names, counts, filter labels), so the collector records ONLY the
/// operational <see cref="RecordViewOpened"/> signal with the surface slug — never the announced message
/// itself. Thread-safe; mirrors the selected-vehicle surface's diagnostics collector.
/// </summary>
public sealed class AnnouncerDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public AnnouncerDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the announcer mount point has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=AnnouncerRegion</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke(
            string.Create(
                CultureInfo.InvariantCulture,
                $"view.opened slug={AnnouncerRegionRegistration.Slug}"));
    }
}
