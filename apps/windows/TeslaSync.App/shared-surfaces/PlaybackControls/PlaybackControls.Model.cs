using System.Collections.Generic;
using System.Globalization;
using System.Text.RegularExpressions;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.ModalsDialogs;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// Canonical metadata + i18n keys for the trip-replay playback bar — the native mirror of the web
/// <c>PlaybackControls</c> (web/src/components/data-display/PlaybackControls.tsx). The web component is the
/// transport bar for trip replay: a Reset / Play-Pause / Stop button trio, the <c>PlaybackSpeedMenu</c> speed
/// cycle, the <c>TimelineScrubber</c> with the elapsed/total time read-out, an optional keyboard-shortcut layer
/// (Space / ←→ / J K L / , . / Home End / 0-9 / + -) and an inline shortcut-feedback toast, plus a "?" help
/// affordance that lists the hotkeys. This metadata carries the diagnostics slug the surface registers under and
/// every i18n key/fallback the web source passes to <c>t()</c>, so the native surface reproduces the web copy
/// verbatim. Each key carries the <c>translation.</c> catalog prefix the WinUI resource bridge expects (the
/// convention every shipped surface uses) and resolves against the English fallback headlessly. UI-free so it is
/// asserted without a XAML host.
/// </summary>
public static class PlaybackControlsRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "PlaybackControls";

    /// <summary>How long the inline shortcut-feedback toast stays up, in ms (web <c>setTimeout(..., 900)</c>).</summary>
    public const int ToastDurationMs = 900;

    // ── Control button accessible names (web aria-label on the Reset / Play-Pause / Stop buttons) ───────────

    /// <summary>i18n key for the Reset button (web <c>replay.controls.reset</c>).</summary>
    public const string ResetKey = "translation.replay.controls.reset";

    /// <summary>English fallback for <see cref="ResetKey"/> (web second arg, verbatim).</summary>
    public const string ResetFallback = "Reset";

    /// <summary>i18n key for the Play button (web <c>replay.controls.play</c>).</summary>
    public const string PlayKey = "translation.replay.controls.play";

    /// <summary>English fallback for <see cref="PlayKey"/> (web second arg, verbatim).</summary>
    public const string PlayFallback = "Play";

    /// <summary>i18n key for the Pause button (web <c>replay.controls.pause</c>).</summary>
    public const string PauseKey = "translation.replay.controls.pause";

    /// <summary>English fallback for <see cref="PauseKey"/> (web second arg, verbatim).</summary>
    public const string PauseFallback = "Pause";

    /// <summary>i18n key for the Stop button (web <c>replay.controls.stop</c>).</summary>
    public const string StopKey = "translation.replay.controls.stop";

    /// <summary>English fallback for <see cref="StopKey"/> (web second arg, verbatim).</summary>
    public const string StopFallback = "Stop";

    // ── Help affordance + cheatsheet (web keyboard-help Tooltip body) ───────────────────────────────────────

    /// <summary>i18n key for the keyboard-help trigger's accessible name (web <c>replay.shortcuts.help</c>).</summary>
    public const string HelpKey = "translation.replay.shortcuts.help";

    /// <summary>English fallback for <see cref="HelpKey"/> (web second arg, verbatim).</summary>
    public const string HelpFallback = "Show keyboard shortcuts";

    /// <summary>i18n key for the help body title (web <c>replay.shortcuts.title</c>).</summary>
    public const string HelpTitleKey = "translation.replay.shortcuts.title";

    /// <summary>English fallback for <see cref="HelpTitleKey"/> (web second arg, verbatim).</summary>
    public const string HelpTitleFallback = "Trip replay shortcuts";

    /// <summary>i18n key for the Play / Pause cheatsheet row (web <c>replay.shortcuts.playPause</c>).</summary>
    public const string PlayPauseKey = "translation.replay.shortcuts.playPause";

    /// <summary>English fallback for <see cref="PlayPauseKey"/> (web second arg, verbatim).</summary>
    public const string PlayPauseFallback = "Play / Pause";

    /// <summary>i18n key for the ±5s cheatsheet row (web <c>replay.shortcuts.skip5</c>).</summary>
    public const string Skip5Key = "translation.replay.shortcuts.skip5";

    /// <summary>English fallback for <see cref="Skip5Key"/> (web second arg, verbatim).</summary>
    public const string Skip5Fallback = "Skip \u00B15s (Shift = \u00B130s)";

    /// <summary>i18n key for the ±10s cheatsheet row (web <c>replay.shortcuts.skip10</c>).</summary>
    public const string Skip10Key = "translation.replay.shortcuts.skip10";

    /// <summary>English fallback for <see cref="Skip10Key"/> (web second arg, verbatim).</summary>
    public const string Skip10Fallback = "Skip \u00B110s";

    /// <summary>i18n key for the frame-step cheatsheet row (web <c>replay.shortcuts.frame</c>).</summary>
    public const string FrameKey = "translation.replay.shortcuts.frame";

    /// <summary>English fallback for <see cref="FrameKey"/> (web second arg, verbatim).</summary>
    public const string FrameFallback = "Previous / next frame";

    /// <summary>i18n key for the start/end cheatsheet row (web <c>replay.shortcuts.startEnd</c>).</summary>
    public const string StartEndKey = "translation.replay.shortcuts.startEnd";

    /// <summary>English fallback for <see cref="StartEndKey"/> (web second arg, verbatim).</summary>
    public const string StartEndFallback = "Jump to start / end";

    /// <summary>i18n key for the percent-jump cheatsheet row (web <c>replay.shortcuts.percent</c>).</summary>
    public const string PercentKey = "translation.replay.shortcuts.percent";

    /// <summary>English fallback for <see cref="PercentKey"/> (web second arg, verbatim).</summary>
    public const string PercentFallback = "Jump to N\u00D710%";

    /// <summary>i18n key for the speed cheatsheet row (web <c>replay.shortcuts.speed</c>).</summary>
    public const string SpeedKey = "translation.replay.shortcuts.speed";

    /// <summary>English fallback for <see cref="SpeedKey"/> (web second arg, verbatim).</summary>
    public const string SpeedFallback = "Speed up / slow down";

    // ── Inline shortcut-feedback toast labels (web showShortcutToast) ───────────────────────────────────────

    /// <summary>i18n key for the "paused" toast (web <c>replay.shortcuts.pause</c>).</summary>
    public const string ToastPauseKey = "translation.replay.shortcuts.pause";

    /// <summary>English fallback for <see cref="ToastPauseKey"/> (web second arg, verbatim).</summary>
    public const string ToastPauseFallback = "Pause";

    /// <summary>i18n key for the "playing" toast (web <c>replay.shortcuts.play</c>).</summary>
    public const string ToastPlayKey = "translation.replay.shortcuts.play";

    /// <summary>English fallback for <see cref="ToastPlayKey"/> (web second arg, verbatim).</summary>
    public const string ToastPlayFallback = "Play";

    /// <summary>i18n key for the previous-frame toast (web <c>replay.shortcuts.prevFrame</c>).</summary>
    public const string ToastPrevFrameKey = "translation.replay.shortcuts.prevFrame";

    /// <summary>English fallback for <see cref="ToastPrevFrameKey"/> (web second arg, verbatim).</summary>
    public const string ToastPrevFrameFallback = "\u23EE frame";

    /// <summary>i18n key for the next-frame toast (web <c>replay.shortcuts.nextFrame</c>).</summary>
    public const string ToastNextFrameKey = "translation.replay.shortcuts.nextFrame";

    /// <summary>English fallback for <see cref="ToastNextFrameKey"/> (web second arg, verbatim).</summary>
    public const string ToastNextFrameFallback = "\u23ED frame";

    /// <summary>i18n key for the jump-to-start toast (web <c>replay.shortcuts.start</c>).</summary>
    public const string ToastStartKey = "translation.replay.shortcuts.start";

    /// <summary>English fallback for <see cref="ToastStartKey"/> (web second arg, verbatim).</summary>
    public const string ToastStartFallback = "\u23EE start";

    /// <summary>i18n key for the jump-to-end toast (web <c>replay.shortcuts.end</c>).</summary>
    public const string ToastEndKey = "translation.replay.shortcuts.end";

    /// <summary>English fallback for <see cref="ToastEndKey"/> (web second arg, verbatim).</summary>
    public const string ToastEndFallback = "\u23ED end";

    /// <summary>i18n key for the speed-up toast (web <c>replay.shortcuts.speedUp</c>).</summary>
    public const string ToastSpeedUpKey = "translation.replay.shortcuts.speedUp";

    /// <summary>English fallback for <see cref="ToastSpeedUpKey"/> (web second arg, verbatim).</summary>
    public const string ToastSpeedUpFallback = "Faster";

    /// <summary>i18n key for the slow-down toast (web <c>replay.shortcuts.speedDown</c>).</summary>
    public const string ToastSpeedDownKey = "translation.replay.shortcuts.speedDown";

    /// <summary>English fallback for <see cref="ToastSpeedDownKey"/> (web second arg, verbatim).</summary>
    public const string ToastSpeedDownFallback = "Slower";

    // ── Cheatsheet group + registry ids (web replayShortcutDefs) ────────────────────────────────────────────

    /// <summary>i18n key for the cheatsheet group label (web <c>shortcuts.groups.replay</c>).</summary>
    public const string GroupKey = "translation.shortcuts.groups.replay";

    /// <summary>English fallback for <see cref="GroupKey"/> (web second arg, verbatim).</summary>
    public const string GroupFallback = "Trip replay";

    /// <summary>
    /// Route the cheatsheet entries are scoped to (web <c>replayRoute = /\/drives\/[^/]+\/replay/</c>): they are
    /// only listed while the replay route is active.
    /// </summary>
    public static Regex ReplayRoute { get; } =
        new(@"/drives/[^/]+/replay", RegexOptions.Compiled | RegexOptions.CultureInvariant);
}

/// <summary>
/// The static kbd key-chip tokens shown in the help cheatsheet — the native mirror of the web <c>&lt;kbd&gt;</c>
/// literals (web/src/components/data-display/PlaybackControls.tsx L279-L292). They are presentational symbols
/// (key glyphs joined with " / "), not translatable copy, so — exactly like the web source — they live as
/// constants rather than i18n keys.
/// </summary>
public static class PlaybackHelpKeyChips
{
    /// <summary>Play / Pause keys (web <c>Space / K</c>).</summary>
    public const string PlayPause = "Space / K";

    /// <summary>Skip ±5/±30s keys (web <c>\u2190 / \u2192</c>).</summary>
    public const string Skip = "\u2190 / \u2192";

    /// <summary>Skip ±10s keys (web <c>J / L</c>).</summary>
    public const string Skip10 = "J / L";

    /// <summary>Frame-step keys (web <c>, / .</c>).</summary>
    public const string Frame = ", / .";

    /// <summary>Jump to start / end keys (web <c>Home / End</c>).</summary>
    public const string StartEnd = "Home / End";

    /// <summary>Percent-jump keys (web <c>0 \u2013 9</c>).</summary>
    public const string Percent = "0 \u2013 9";

    /// <summary>Speed up / slow down keys (web <c>+ / \u2212</c>).</summary>
    public const string Speed = "+ / \u2212";
}

/// <summary>
/// A single cheatsheet row — a kbd key-chip paired with its already-localized description (web help grid row).
/// Headless so the help body is asserted without a XAML host.
/// </summary>
/// <param name="Keys">The key-chip token (e.g. <c>Space / K</c>) — a presentational symbol, not localized.</param>
/// <param name="Description">The already-localized row description.</param>
public sealed record PlaybackHelpEntry(string Keys, string Description);

/// <summary>
/// The keys the playback bar reacts to when keyboard shortcuts are enabled — the native model of the web
/// <c>keydown</c> switch (web/src/components/data-display/PlaybackControls.tsx L148-L238). The WinUI view maps a
/// platform <c>VirtualKey</c> (plus the Shift modifier) onto one of these and forwards it to
/// <see cref="PlaybackControlsViewModel.HandleShortcut"/>, so the key interpretation is unit-tested without a
/// dispatcher. <see cref="Digit0"/>..<see cref="Digit9"/> are contiguous so the 0-9 "jump to N\u00D710%" handler can
/// recover the digit by offset.
/// </summary>
public enum PlaybackShortcutKey
{
    /// <summary>Not a recognized shortcut key (the view forwards nothing).</summary>
    None = 0,

    /// <summary>Space — toggle play/pause (web <c>' '</c>).</summary>
    Space,

    /// <summary>K — toggle play/pause (web <c>'k'</c>).</summary>
    K,

    /// <summary>Left arrow — skip back 5s (30s with Shift) (web <c>'ArrowLeft'</c>).</summary>
    ArrowLeft,

    /// <summary>Right arrow — skip forward 5s (30s with Shift) (web <c>'ArrowRight'</c>).</summary>
    ArrowRight,

    /// <summary>J — skip back 10s (web <c>'j'</c>).</summary>
    J,

    /// <summary>L — skip forward 10s (web <c>'l'</c>).</summary>
    L,

    /// <summary>Comma — step to the previous frame (web <c>','</c>).</summary>
    Comma,

    /// <summary>Period — step to the next frame (web <c>'.'</c>).</summary>
    Period,

    /// <summary>Home — jump to the start (web <c>'Home'</c>).</summary>
    Home,

    /// <summary>End — jump to the end (web <c>'End'</c>).</summary>
    End,

    /// <summary>Plus / equals — speed up (web <c>'+' / '='</c>).</summary>
    Plus,

    /// <summary>Minus / underscore — slow down (web <c>'-' / '_'</c>).</summary>
    Minus,

    /// <summary>Digit 0 — jump to 0% (web <c>'0'</c>). Keep <see cref="Digit0"/>..<see cref="Digit9"/> contiguous.</summary>
    Digit0,

    /// <summary>Digit 1 — jump to 10% (web <c>'1'</c>).</summary>
    Digit1,

    /// <summary>Digit 2 — jump to 20% (web <c>'2'</c>).</summary>
    Digit2,

    /// <summary>Digit 3 — jump to 30% (web <c>'3'</c>).</summary>
    Digit3,

    /// <summary>Digit 4 — jump to 40% (web <c>'4'</c>).</summary>
    Digit4,

    /// <summary>Digit 5 — jump to 50% (web <c>'5'</c>).</summary>
    Digit5,

    /// <summary>Digit 6 — jump to 60% (web <c>'6'</c>).</summary>
    Digit6,

    /// <summary>Digit 7 — jump to 70% (web <c>'7'</c>).</summary>
    Digit7,

    /// <summary>Digit 8 — jump to 80% (web <c>'8'</c>).</summary>
    Digit8,

    /// <summary>Digit 9 — jump to 90% (web <c>'9'</c>).</summary>
    Digit9,
}

/// <summary>
/// The computed inline-toast labels the web source builds at the keydown call sites that are NOT routed through
/// <c>t()</c> — the seek-by-seconds glyph labels (web literals <c>\u23EA \u22125s</c> / <c>\u23E9 +30s</c> / …) and the
/// digit-jump percent label (web <c>${Math.round(pct * 100)}%</c>). They are symbolic transport feedback, so —
/// like the web source — they are formatted from the numbers rather than translated. Static + side-effect-free so
/// the formatting is unit-tested without a view-model.
/// </summary>
public static class PlaybackToastLabels
{
    /// <summary>
    /// The seek-by-seconds toast for a signed <paramref name="deltaSeconds"/> (web <c>'\u23EA \u22125s'</c> for a
    /// rewind, <c>'\u23E9 +5s'</c> for a fast-forward): a rewind glyph + a Unicode minus for negative deltas, a
    /// fast-forward glyph + an ASCII plus for positive deltas.
    /// </summary>
    public static string SeekSeconds(int deltaSeconds)
    {
        int magnitude = Math.Abs(deltaSeconds);
        return deltaSeconds < 0
            ? string.Create(CultureInfo.InvariantCulture, $"\u23EA \u2212{magnitude}s")
            : string.Create(CultureInfo.InvariantCulture, $"\u23E9 +{magnitude}s");
    }

    /// <summary>
    /// The digit-jump percent toast for a normalized 0..1 position (web <c>`${Math.round(pct * 100)}%`</c>),
    /// rounded to a whole percent and formatted invariantly.
    /// </summary>
    public static string Percent(double normalized)
    {
        long percent = (long)Math.Round(normalized * 100, MidpointRounding.AwayFromZero);
        return string.Create(CultureInfo.InvariantCulture, $"{percent}%");
    }
}

/// <summary>
/// Builds the trip-replay keyboard cheatsheet definitions the surface declares through the registry — the native
/// port of the web <c>replayShortcutDefs</c> + <c>useShortcut(replayShortcutDefs)</c>
/// (web/src/components/data-display/PlaybackControls.tsx L300-L326). Each entry is route-scoped to the replay
/// route (web <c>scope: 'route', routeMatch: /\/drives\/[^/]+\/replay/</c>) and carries an
/// <c>replay.scrubber.{id}</c> registry id, the localized description and the localized group label, so they
/// appear automatically in the global <c>KeyboardShortcutsModal</c> cheatsheet. Pure (localizer in, list out) so
/// it is asserted headlessly.
/// </summary>
public static class ReplayShortcutCheatsheet
{
    /// <summary>The stable registry-id prefix every entry shares (web <c>replay.scrubber.{id}</c>).</summary>
    public const string IdPrefix = "replay.scrubber.";

    // Key-chip token arrays hoisted to static readonly fields (the descriptions are localized per call).
    private static readonly string[] PlayPauseKeys = { "Space" };
    private static readonly string[] Skip5Keys = { "\u2190", "\u2192" };
    private static readonly string[] Skip10Keys = { "J", "L" };
    private static readonly string[] FrameKeys = { ",", "." };
    private static readonly string[] StartEndKeys = { "Home", "End" };
    private static readonly string[] PercentKeys = { "0", "\u2013", "9" };
    private static readonly string[] SpeedKeys = { "+", "\u2212" };

    /// <summary>
    /// The seven route-scoped cheatsheet definitions in web order, resolved through <paramref name="localizer"/>.
    /// </summary>
    /// <param name="localizer">The i18n facade the descriptions + group label resolve through.</param>
    public static IReadOnlyList<ShortcutDefinition> Build(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        string group = localizer.GetString(
            PlaybackControlsRegistration.GroupKey,
            PlaybackControlsRegistration.GroupFallback);

        ShortcutDefinition Make(string id, IReadOnlyList<string> keys, string descriptionKey, string descriptionFallback) =>
            new()
            {
                Id = IdPrefix + id,
                Keys = keys,
                Description = localizer.GetString(descriptionKey, descriptionFallback),
                Group = group,
                Scope = ShortcutScope.Route,
                RoutePattern = PlaybackControlsRegistration.ReplayRoute,
            };

        return new[]
        {
            Make("playPause", PlayPauseKeys, PlaybackControlsRegistration.PlayPauseKey, PlaybackControlsRegistration.PlayPauseFallback),
            Make("skip5", Skip5Keys, PlaybackControlsRegistration.Skip5Key, PlaybackControlsRegistration.Skip5Fallback),
            Make("skip10", Skip10Keys, PlaybackControlsRegistration.Skip10Key, PlaybackControlsRegistration.Skip10Fallback),
            Make("frame", FrameKeys, PlaybackControlsRegistration.FrameKey, PlaybackControlsRegistration.FrameFallback),
            Make("startEnd", StartEndKeys, PlaybackControlsRegistration.StartEndKey, PlaybackControlsRegistration.StartEndFallback),
            Make("percent", PercentKeys, PlaybackControlsRegistration.PercentKey, PlaybackControlsRegistration.PercentFallback),
            Make("speed", SpeedKeys, PlaybackControlsRegistration.SpeedKey, PlaybackControlsRegistration.SpeedFallback),
        };
    }
}

/// <summary>
/// PII-safe diagnostics for the playback bar (P1/S11 diagnostics contract). The bar carries only transient
/// transport UI, so the collector records nothing but the operational <c>view.opened</c> event with the surface
/// slug — never the position, speed or any interaction. Thread-safe; mirrors the shipped surfaces' collectors.
/// </summary>
public sealed class PlaybackControlsDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the <c>view.opened</c> line is written to, or null.</param>
    public PlaybackControlsDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=PlaybackControls</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={PlaybackControlsRegistration.Slug}");
    }
}
