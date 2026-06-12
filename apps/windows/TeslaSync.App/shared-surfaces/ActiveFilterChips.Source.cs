namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The polite live-region announcer the chips route removals through (P1/S8 state-holder layer) — the native
/// port of the web component's local <c>&lt;VisuallyHidden liveRegion&gt;</c> (web/src/components/forms/
/// ActiveFilterChips.tsx L235, backed by web/src/components/a11y/VisuallyHidden.tsx). Where the web source keeps
/// the announcement in a <c>useState</c> string rendered into an <c>aria-live="polite"</c> node, the native
/// view-model writes each composed message (web <c>removalAnnouncement</c>) to this seam, and the WinUI view
/// supplies the real implementation backing it with a hidden <c>TsAnnouncerRegion</c>. Modelling it as a seam
/// keeps the view-model UI-thread-free and lets the announcement contract be verified headlessly with a
/// recording double.
/// </summary>
public interface IFilterChipAnnouncer
{
    /// <summary>
    /// Announce <paramref name="message"/> to assistive technology politely, without moving focus (web setting
    /// the controlled <c>aria-live</c> region text). The message already carries the rotating zero-width-space
    /// suffix the view-model appends so screen readers re-read an otherwise-identical announcement.
    /// </summary>
    void Announce(string message);
}

/// <summary>
/// The inert announcer used when no live region is mounted (galleries / design hosts / headless construction) —
/// every announcement is dropped. The WinUI view always supplies the real
/// <c>TsAnnouncerRegion</c>-backed announcer in production, so this default never silences a mounted surface; it
/// only keeps a host-free view-model safe to construct.
/// </summary>
public sealed class NullFilterChipAnnouncer : IFilterChipAnnouncer
{
    /// <summary>The shared inert instance.</summary>
    public static NullFilterChipAnnouncer Instance { get; } = new();

    private NullFilterChipAnnouncer()
    {
    }

    /// <inheritdoc />
    public void Announce(string message)
    {
        // Intentionally inert: with no live region mounted there is nothing for assistive technology to read.
    }
}
