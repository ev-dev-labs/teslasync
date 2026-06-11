using System.Collections.Generic;
using System.Globalization;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// Canonical metadata + i18n keys for the playback-speed control — the native mirror of the web
/// <c>PlaybackSpeedMenu</c> (web/src/components/data-display/PlaybackSpeedMenu.tsx). The web component is a
/// compact, fully-controlled <c>Button</c>: it shows the current <c>{speed}x</c> with a trailing chevron,
/// cycles to the next-fastest speed on click and steps one slot slower on right-click, announcing every change
/// through its <c>onChange</c> prop and carrying a single <c>aria-label</c>. This metadata carries the
/// diagnostics slug the surface registers under and the one render-contract i18n key/fallback the web source
/// passes to <c>t()</c>, so the native surface reproduces the web copy verbatim. The key carries the
/// <c>translation.</c> catalog prefix the WinUI resource bridge expects (the convention every shipped surface
/// uses) and resolves against the English fallback headlessly. UI-free so it is asserted without a XAML host.
/// </summary>
public static class PlaybackSpeedMenuRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "PlaybackSpeedMenu";

    /// <summary>i18n key for the control's accessible name (web <c>replay.controls.speed</c>).</summary>
    public const string SpeedKey = "translation.replay.controls.speed";

    /// <summary>English fallback for <see cref="SpeedKey"/> (web second arg, verbatim).</summary>
    public const string SpeedFallback = "Playback speed";
}

/// <summary>
/// The replay-speed scale and the two pure step functions — the native port of the web module-level constants
/// and helpers (web/src/components/data-display/PlaybackSpeedMenu.tsx L10-L24, themselves driven by
/// <c>useTripReplay</c>'s <c>ReplaySpeed = 1 | 10 | 25 | 50 | 100</c>). <see cref="Ordered"/> is the canonical
/// ordered slot list (web <c>REPLAY_SPEEDS</c>); <see cref="Next"/> cycles to the next-fastest slot and wraps
/// (web <c>nextSpeed</c>); <see cref="Shift"/> steps a signed number of slots and clamps to the ends
/// (web <c>shiftSpeed</c>); and <see cref="Format"/> renders the <c>{speed}x</c> badge text. An unknown current
/// speed is treated exactly as the web helpers treat <c>indexOf === -1</c> — the cycle resumes from the first
/// slot and the shift anchors at slot 0 — so the control never throws on an out-of-scale prop. Static and
/// side-effect-free so the scale logic is unit-tested without a view-model or a UI thread.
/// </summary>
public static class PlaybackSpeeds
{
    private static readonly int[] OrderedSpeeds = { 1, 10, 25, 50, 100 };

    /// <summary>The ordered replay-speed slots (web <c>REPLAY_SPEEDS = [1, 10, 25, 50, 100]</c>).</summary>
    public static IReadOnlyList<int> Ordered => OrderedSpeeds;

    /// <summary>
    /// The next-fastest speed, wrapping past the top back to the slowest (web <c>nextSpeed</c>:
    /// <c>REPLAY_SPEEDS[(idx + 1) % length]</c>). An unknown <paramref name="current"/> (web <c>indexOf === -1</c>)
    /// resumes the cycle from the first slot.
    /// </summary>
    public static int Next(int current)
    {
        int index = Array.IndexOf(OrderedSpeeds, current);
        int length = OrderedSpeeds.Length;
        int nextIndex = (((index + 1) % length) + length) % length;
        return OrderedSpeeds[nextIndex];
    }

    /// <summary>
    /// The speed <paramref name="delta"/> slots away (signed), clamped to the ends of the scale (web
    /// <c>shiftSpeed</c>: <c>safeIdx = idx === -1 ? 0 : idx</c>, then
    /// <c>clamp(0, length - 1, safeIdx + delta)</c>). +1 = next-fastest, -1 = next-slowest.
    /// </summary>
    public static int Shift(int current, int delta)
    {
        int index = Array.IndexOf(OrderedSpeeds, current);
        int safeIndex = index == -1 ? 0 : index;
        int target = safeIndex + delta;
        int clamped = Math.Max(0, Math.Min(OrderedSpeeds.Length - 1, target));
        return OrderedSpeeds[clamped];
    }

    /// <summary>The badge text for a speed (web <c>{speed}x</c>, e.g. <c>10x</c>), formatted invariantly.</summary>
    public static string Format(int speed) => string.Create(CultureInfo.InvariantCulture, $"{speed}x");
}

/// <summary>
/// PII-safe diagnostics for the playback-speed control (P1/S11 diagnostics contract). The control carries only
/// a transient UI speed, so the collector records nothing but the operational <c>view.opened</c> event with the
/// surface slug — never the chosen speed or any interaction. Thread-safe; mirrors the shipped surfaces'
/// collectors.
/// </summary>
public sealed class PlaybackSpeedMenuDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the <c>view.opened</c> line is written to, or null.</param>
    public PlaybackSpeedMenuDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=PlaybackSpeedMenu</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={PlaybackSpeedMenuRegistration.Slug}");
    }
}
