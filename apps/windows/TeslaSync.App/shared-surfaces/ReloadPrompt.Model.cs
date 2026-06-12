using System.Globalization;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// Canonical metadata for the ReloadPrompt surface — the native analogue of the module-level literals and the
/// <c>t()</c> keys in web/src/components/feedback/ReloadPrompt.tsx. Carries the diagnostics slug, the prompt /
/// control automation ids, the Segoe Fluent glyph standing in for the web Lucide <c>RefreshCw</c> spinner, the
/// brand accent (neon-cyan) token keys + fallback the web <c>text-neon-cyan</c> / <c>bg-neon-cyan/10</c> /
/// <c>border-neon-cyan/30</c> chip tints from, the auto-reload countdown length (the web <c>COUNTDOWN_SECONDS</c>),
/// the background update-check cadence (the web <c>UPDATE_CHECK_INTERVAL_MS</c>), every i18n key (with the English
/// fallback the web renders verbatim — each already present in the P1/S10 catalogue under <c>translation.pwa.*</c>),
/// and the pure countdown-message interpolator (<see cref="FormatReloadingIn"/>). UI-free so it is asserted in tests.
/// </summary>
public static class ReloadPromptRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "ReloadPrompt";

    /// <summary>The automation id Narrator and UI-automation resolve the prompt card by.</summary>
    public const string PromptAutomationId = "reload-prompt";

    /// <summary>The automation id for the "Reload Now" call-to-action button.</summary>
    public const string ReloadAutomationId = "reload-prompt-reload";

    /// <summary>The automation id for the "Later" dismiss button.</summary>
    public const string LaterAutomationId = "reload-prompt-later";

    /// <summary>Segoe Fluent "Sync" glyph — the native stand-in for the web Lucide <c>RefreshCw</c> spinner icon.</summary>
    public const string RefreshGlyph = "\uE895";

    /// <summary>Token key for the accent colour — the brand neon-cyan (web <c>text-neon-cyan</c>).</summary>
    public const string AccentColorKey = "TsColorAccentColor";

    /// <summary>Token key for the accent brush the icon foreground + chip / border tints derive from.</summary>
    public const string AccentBrushKey = "TsColorAccentBrush";

    /// <summary>Fallback for the accent colour when the token is absent (web <c>#00f0ff</c>).</summary>
    public const string AccentColorFallback = "#00F0FF";

    /// <summary>Chip background tint opacity over the accent (web <c>bg-neon-cyan/10</c>).</summary>
    public const double ChipTintOpacity = 0.1;

    /// <summary>Card border tint opacity over the accent (web <c>border-neon-cyan/30</c>).</summary>
    public const double BorderTintOpacity = 0.3;

    /// <summary>The auto-reload countdown length in seconds (web <c>COUNTDOWN_SECONDS</c>).</summary>
    public const int CountdownSeconds = 3;

    /// <summary>The background update-check cadence (web <c>UPDATE_CHECK_INTERVAL_MS</c> = 5 minutes).</summary>
    public static TimeSpan UpdateCheckInterval => TimeSpan.FromMinutes(5);

    /// <summary>i18n key for the prompt title (web <c>t('pwa.newVersion', …)</c>).</summary>
    public const string TitleKey = "translation.pwa.newVersion";

    /// <summary>English fallback for <see cref="TitleKey"/> — the web literal, verbatim.</summary>
    public const string TitleFallback = "New version available";

    /// <summary>i18n key for the countdown subtitle (web <c>t('pwa.reloadingIn', …)</c>).</summary>
    public const string ReloadingInKey = "translation.pwa.reloadingIn";

    /// <summary>
    /// English fallback for <see cref="ReloadingInKey"/> — the web literal, verbatim (the <c>{{seconds}}</c> token
    /// is interpolated by <see cref="FormatReloadingIn"/>).
    /// </summary>
    public const string ReloadingInFallback = "Reloading in {{seconds}}s...";

    /// <summary>i18n key for the "Later" dismiss action (web <c>t('pwa.later', …)</c>).</summary>
    public const string LaterKey = "translation.pwa.later";

    /// <summary>English fallback for <see cref="LaterKey"/> — the web literal, verbatim.</summary>
    public const string LaterFallback = "Later";

    /// <summary>i18n key for the "Reload Now" action (web <c>t('pwa.reloadNow', …)</c>).</summary>
    public const string ReloadNowKey = "translation.pwa.reloadNow";

    /// <summary>English fallback for <see cref="ReloadNowKey"/> — the web literal, verbatim.</summary>
    public const string ReloadNowFallback = "Reload Now";

    /// <summary>
    /// Resolve and interpolate the countdown subtitle for <paramref name="seconds"/> remaining — the native port of
    /// the web <c>t('pwa.reloadingIn', { seconds })</c> (web/src/components/feedback/ReloadPrompt.tsx L101). Resolves
    /// the template through <paramref name="localizer"/> and substitutes both the web i18next token
    /// (<c>{{seconds}}</c>) and the native positional token (<c>{0}</c> — the form the P1/S10 catalogue stores) via a
    /// literal replace (never <see cref="string.Format(IFormatProvider, string, object?)"/>, so a localized value
    /// carrying a stray brace can never throw a <see cref="System.FormatException"/>).
    /// </summary>
    /// <param name="localizer">The i18n facade the template resolves through.</param>
    /// <param name="seconds">The remaining countdown value, rendered in the current culture.</param>
    public static string FormatReloadingIn(ILocalizer localizer, int seconds)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        string template = localizer.GetString(ReloadingInKey, ReloadingInFallback);
        return Interpolate(template, "seconds", seconds.ToString(CultureInfo.CurrentCulture));
    }

    private static string Interpolate(string template, string token, string value)
    {
        ArgumentNullException.ThrowIfNull(template);
        return template
            .Replace("{{" + token + "}}", value, StringComparison.Ordinal)
            .Replace("{0}", value, StringComparison.Ordinal);
    }
}

/// <summary>
/// The fully projected, render-ready view of the reload prompt — everything the web <c>ReloadPrompt</c> derives
/// before returning JSX (web/src/components/feedback/ReloadPrompt.tsx L84-L122): whether the banner is shown
/// (<see cref="IsVisible"/> — the web <c>needRefresh</c> gate), the remaining countdown (<see cref="Seconds"/> — the
/// web <c>countdown</c>), the localized <see cref="Title"/>, the interpolated <see cref="CountdownMessage"/>
/// subtitle, and the two action labels (<see cref="LaterLabel"/> + <see cref="ReloadNowLabel"/>). Pure value type so
/// every field is asserted headlessly.
/// </summary>
public readonly record struct ReloadPromptProjection
{
    private ReloadPromptProjection(
        bool isVisible,
        int seconds,
        string title,
        string countdownMessage,
        string laterLabel,
        string reloadNowLabel)
    {
        IsVisible = isVisible;
        Seconds = seconds;
        Title = title;
        CountdownMessage = countdownMessage;
        LaterLabel = laterLabel;
        ReloadNowLabel = reloadNowLabel;
    }

    /// <summary>Whether the banner is shown — the web <c>needRefresh</c> gate (an update is pending).</summary>
    public bool IsVisible { get; }

    /// <summary>The remaining auto-reload countdown in seconds (web <c>countdown</c>).</summary>
    public int Seconds { get; }

    /// <summary>The localized prompt title (web <c>pwa.newVersion</c>); also the surface's accessible name.</summary>
    public string Title { get; }

    /// <summary>The interpolated "Reloading in {{seconds}}s..." subtitle (web <c>pwa.reloadingIn</c>).</summary>
    public string CountdownMessage { get; }

    /// <summary>The localized "Later" dismiss-action label (web <c>pwa.later</c>).</summary>
    public string LaterLabel { get; }

    /// <summary>The localized "Reload Now" action label (web <c>pwa.reloadNow</c>).</summary>
    public string ReloadNowLabel { get; }

    /// <summary>The accessible name a screen reader announces for the surface — the prompt title.</summary>
    public string AccessibleName => Title;

    /// <summary>The accessible description a screen reader announces for the surface — the countdown subtitle.</summary>
    public string Description => CountdownMessage;

    /// <summary>
    /// Project the update + countdown inputs into a render-ready banner value, reproducing the web component
    /// (web/src/components/feedback/ReloadPrompt.tsx L84-L122): the banner is visible only while an update is pending
    /// (<paramref name="needRefresh"/>), the subtitle counts <paramref name="seconds"/> down, and every label
    /// resolves through the i18n facade.
    /// </summary>
    /// <param name="needRefresh">An update is pending (web <c>needRefresh</c>).</param>
    /// <param name="seconds">The remaining auto-reload countdown (web <c>countdown</c>).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public static ReloadPromptProjection Project(bool needRefresh, int seconds, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        return new ReloadPromptProjection(
            isVisible: needRefresh,
            seconds: seconds,
            title: localizer.GetString(ReloadPromptRegistration.TitleKey, ReloadPromptRegistration.TitleFallback),
            countdownMessage: ReloadPromptRegistration.FormatReloadingIn(localizer, seconds),
            laterLabel: localizer.GetString(ReloadPromptRegistration.LaterKey, ReloadPromptRegistration.LaterFallback),
            reloadNowLabel: localizer.GetString(ReloadPromptRegistration.ReloadNowKey, ReloadPromptRegistration.ReloadNowFallback));
    }
}

/// <summary>
/// PII-safe diagnostics for the ReloadPrompt surface (P1/S11 diagnostics contract). The prompt carries no user
/// content (only a pending-update flag and an integer countdown), so the collector records ONLY the operational
/// <c>view.opened</c> event with the surface slug — never the reload outcome, mirroring the web component which emits
/// no telemetry. Thread-safe; mirrors the peer surfaces' diagnostics collectors.
/// </summary>
public sealed class ReloadPromptDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the <c>view.opened</c> line is written to, or null.</param>
    public ReloadPromptDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=ReloadPrompt</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke(
            string.Create(CultureInfo.InvariantCulture, $"view.opened slug={ReloadPromptRegistration.Slug}"));
    }
}
