using System.Globalization;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The outcome of presenting the platform install affordance — the native analogue of the web
/// <c>BeforeInstallPromptEvent.userChoice</c> resolution (web/src/components/feedback/InstallPrompt.tsx L9-10,
/// <c>{ outcome: 'accepted' | 'dismissed' }</c>). <see cref="Accepted"/> is the user installing the app (the web
/// branch that hides the prompt); <see cref="Dismissed"/> is the user declining the platform affordance. Either way
/// the one-shot prompt is consumed.
/// </summary>
public enum InstallChoiceOutcome
{
    /// <summary>The user accepted the install (web <c>outcome === 'accepted'</c>).</summary>
    Accepted,

    /// <summary>The user declined the platform install affordance (web <c>outcome === 'dismissed'</c>).</summary>
    Dismissed,
}

/// <summary>
/// Canonical metadata for the InstallPrompt surface — the native analogue of the module-level literals, the
/// dismissal storage contract and the <c>t()</c> keys in web/src/components/feedback/InstallPrompt.tsx. Carries the
/// diagnostics slug, the prompt / control automation ids, the Segoe Fluent glyphs standing in for the web Lucide
/// <c>Download</c> / <c>X</c> icons, the brand gradient token keys (the web <c>from-[#00f0ff] to-[#10b981]</c>
/// chip), the dismissal storage key + 14-day window (the web <c>DISMISS_KEY</c> / <c>DISMISS_DAYS</c>), the
/// cross-instance broadcast message type (the web <c>broadcast({ type: 'install.dismissed' })</c>), every i18n key
/// (with the English fallback the web renders verbatim — each already present in the P1/S10 catalogue under
/// <c>translation.installPrompt.*</c>), and the pure dismissal helpers (<see cref="ParseDismissedAt"/>,
/// <see cref="FormatDismissedAt"/>, <see cref="IsDismissedRecently(string?, DateTimeOffset)"/>). UI-free so it is
/// asserted in tests.
/// </summary>
public static class InstallPromptRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "InstallPrompt";

    /// <summary>The automation id Narrator and UI-automation resolve the prompt card by.</summary>
    public const string PromptAutomationId = "install-prompt";

    /// <summary>The automation id for the "Install" call-to-action button.</summary>
    public const string InstallAutomationId = "install-prompt-install";

    /// <summary>The automation id for the dismiss ("X") button.</summary>
    public const string DismissAutomationId = "install-prompt-dismiss";

    /// <summary>Segoe Fluent "Download" glyph — the native stand-in for the web Lucide <c>Download</c> icon.</summary>
    public const string DownloadGlyph = "\uE896";

    /// <summary>Segoe Fluent "ChromeClose" glyph — the native stand-in for the web Lucide <c>X</c> dismiss icon.</summary>
    public const string DismissGlyph = "\uE711";

    /// <summary>Token key for the gradient start colour — the brand cyan (web <c>from-[#00f0ff]</c>).</summary>
    public const string GradientStartColorKey = "TsColorAccentColor";

    /// <summary>Fallback for the gradient start colour when the token is absent (web <c>#00f0ff</c>).</summary>
    public const string GradientStartFallback = "#00F0FF";

    /// <summary>Token key for the gradient end brush — the brand green (web <c>to-[#10b981]</c>).</summary>
    public const string GradientEndBrushKey = "TsChartBatteryBrush";

    /// <summary>Fallback for the gradient end colour when the token is absent (web <c>#10b981</c>).</summary>
    public const string GradientEndFallback = "#10B981";

    /// <summary>The storage key the dismissal timestamp is persisted under (web <c>DISMISS_KEY</c>).</summary>
    public const string DismissStorageKey = "teslasync-pwa-install-dismissed";

    /// <summary>The dismissal suppression window in days (web <c>DISMISS_DAYS</c>).</summary>
    public const int DismissWindowDays = 14;

    /// <summary>The cross-instance dismiss broadcast message type (web <c>{ type: 'install.dismissed' }</c>).</summary>
    public const string BroadcastMessageType = "install.dismissed";

    /// <summary>i18n key for the prompt title (web <c>t('installPrompt.title', …)</c>).</summary>
    public const string TitleKey = "translation.installPrompt.title";

    /// <summary>English fallback for <see cref="TitleKey"/> — the web literal, verbatim.</summary>
    public const string TitleFallback = "Install TeslaSync";

    /// <summary>i18n key for the prompt subtitle (web <c>t('installPrompt.subtitle', …)</c>).</summary>
    public const string SubtitleKey = "translation.installPrompt.subtitle";

    /// <summary>English fallback for <see cref="SubtitleKey"/> — the web literal, verbatim.</summary>
    public const string SubtitleFallback = "Add to home screen for native experience";

    /// <summary>i18n key for the "Install" action (web <c>t('installPrompt.install', …)</c>).</summary>
    public const string InstallKey = "translation.installPrompt.install";

    /// <summary>English fallback for <see cref="InstallKey"/> — the web literal, verbatim.</summary>
    public const string InstallFallback = "Install";

    /// <summary>i18n key for the dismiss-control accessible name (web <c>t('installPrompt.dismiss', …)</c>).</summary>
    public const string DismissKey = "translation.installPrompt.dismiss";

    /// <summary>English fallback for <see cref="DismissKey"/> — the web literal, verbatim.</summary>
    public const string DismissFallback = "Dismiss install prompt";

    /// <summary>The dismissal suppression window — <see cref="DismissWindowDays"/> days (web <c>DISMISS_DAYS * 86_400_000</c>).</summary>
    public static TimeSpan DismissWindow => TimeSpan.FromDays(DismissWindowDays);

    /// <summary>
    /// Parse a raw persisted dismissal token into the instant it was recorded — the native port of the web
    /// <c>Number(raw)</c> read (web/src/components/feedback/InstallPrompt.tsx L22-25). A null / empty token (the
    /// web <c>if (!raw) return false</c> falsy guard), a non-numeric / non-finite value (the web
    /// <c>Number.isFinite</c> guard), or an out-of-range epoch all collapse to <see langword="null"/> so a fresh,
    /// cleared or corrupt store behaves as "never dismissed". The token is epoch milliseconds (the web
    /// <c>Date.now()</c> stamp).
    /// </summary>
    /// <param name="raw">The raw stored token, or null when no value is recorded.</param>
    public static DateTimeOffset? ParseDismissedAt(string? raw)
    {
        if (string.IsNullOrEmpty(raw))
        {
            return null;
        }

        if (!double.TryParse(raw, NumberStyles.Float, CultureInfo.InvariantCulture, out var milliseconds)
            || !double.IsFinite(milliseconds))
        {
            return null;
        }

        try
        {
            return DateTimeOffset.FromUnixTimeMilliseconds((long)milliseconds);
        }
        catch (ArgumentOutOfRangeException)
        {
            return null;
        }
    }

    /// <summary>
    /// The raw token a dismissal is persisted as — the native port of the web <c>String(Date.now())</c> write
    /// (web/src/components/feedback/InstallPrompt.tsx L78): the instant rendered as epoch milliseconds in the
    /// invariant culture.
    /// </summary>
    /// <param name="dismissedAt">The instant the prompt was dismissed.</param>
    public static string FormatDismissedAt(DateTimeOffset dismissedAt) =>
        dismissedAt.ToUnixTimeMilliseconds().ToString(CultureInfo.InvariantCulture);

    /// <summary>
    /// Whether a recorded dismissal is still within the suppression window — the native port of the web
    /// <c>Date.now() - ts &lt; DISMISS_DAYS * 86_400_000</c> comparison: a <see langword="null"/> instant is "not
    /// dismissed", otherwise the prompt stays suppressed until <see cref="DismissWindow"/> has elapsed since the
    /// dismissal.
    /// </summary>
    /// <param name="dismissedAt">When the prompt was last dismissed, or null if never.</param>
    /// <param name="now">The current instant.</param>
    public static bool IsDismissedRecently(DateTimeOffset? dismissedAt, DateTimeOffset now) =>
        dismissedAt.HasValue && now - dismissedAt.Value < DismissWindow;

    /// <summary>
    /// Whether a raw persisted dismissal token still suppresses the prompt — the native port of the web
    /// <c>wasDismissedRecently()</c> helper (web/src/components/feedback/InstallPrompt.tsx L20-29): parse the token
    /// then apply the suppression window, treating an absent / unreadable token as "not dismissed".
    /// </summary>
    /// <param name="raw">The raw stored token, or null when no value is recorded.</param>
    /// <param name="now">The current instant.</param>
    public static bool IsDismissedRecently(string? raw, DateTimeOffset now) =>
        IsDismissedRecently(ParseDismissedAt(raw), now);
}

/// <summary>
/// The fully projected, render-ready view of the install prompt — everything the web <c>InstallPrompt</c> derives
/// before returning JSX (web/src/components/feedback/InstallPrompt.tsx L96-141): whether the prompt is shown
/// (<see cref="IsVisible"/> — the web <c>visible</c> gate: a deferred install is available, the app is not already
/// running standalone, and the prompt was not dismissed within the suppression window), the localized
/// <see cref="Title"/> / <see cref="Subtitle"/>, and the two action labels (<see cref="InstallLabel"/> +
/// <see cref="DismissLabel"/>). Pure value type so every field is asserted headlessly.
/// </summary>
public readonly record struct InstallPromptProjection
{
    private InstallPromptProjection(
        bool isVisible,
        string title,
        string subtitle,
        string installLabel,
        string dismissLabel)
    {
        IsVisible = isVisible;
        Title = title;
        Subtitle = subtitle;
        InstallLabel = installLabel;
        DismissLabel = dismissLabel;
    }

    /// <summary>Whether the prompt is shown — the web <c>visible</c> gate (installable, not standalone, not dismissed).</summary>
    public bool IsVisible { get; }

    /// <summary>The localized prompt title (web <c>installPrompt.title</c>); also the surface's accessible name.</summary>
    public string Title { get; }

    /// <summary>The localized prompt subtitle (web <c>installPrompt.subtitle</c>); also the surface's description.</summary>
    public string Subtitle { get; }

    /// <summary>The localized "Install" action label (web <c>installPrompt.install</c>).</summary>
    public string InstallLabel { get; }

    /// <summary>The localized dismiss-control accessible name (web <c>installPrompt.dismiss</c>).</summary>
    public string DismissLabel { get; }

    /// <summary>The accessible name a screen reader announces for the surface — the prompt title.</summary>
    public string AccessibleName => Title;

    /// <summary>The accessible description a screen reader announces for the surface — the subtitle.</summary>
    public string Description => Subtitle;

    /// <summary>
    /// Project the install inputs into a render-ready prompt value, reproducing the web component
    /// (web/src/components/feedback/InstallPrompt.tsx L42-141): the prompt is visible only when a deferred install
    /// is available, the app is not already running standalone, and it was not dismissed within the suppression
    /// window; every label resolves through the i18n facade.
    /// </summary>
    /// <param name="canInstall">A deferred install affordance is available (web <c>deferredPrompt != null</c>).</param>
    /// <param name="isInstalled">The app is already installed / running standalone (web <c>isStandaloneMode()</c>).</param>
    /// <param name="dismissedRecently">The prompt was dismissed within the window (web <c>wasDismissedRecently()</c>).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public static InstallPromptProjection Project(
        bool canInstall,
        bool isInstalled,
        bool dismissedRecently,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        return new InstallPromptProjection(
            isVisible: canInstall && !isInstalled && !dismissedRecently,
            title: localizer.GetString(InstallPromptRegistration.TitleKey, InstallPromptRegistration.TitleFallback),
            subtitle: localizer.GetString(InstallPromptRegistration.SubtitleKey, InstallPromptRegistration.SubtitleFallback),
            installLabel: localizer.GetString(InstallPromptRegistration.InstallKey, InstallPromptRegistration.InstallFallback),
            dismissLabel: localizer.GetString(InstallPromptRegistration.DismissKey, InstallPromptRegistration.DismissFallback));
    }
}

/// <summary>
/// PII-safe diagnostics for the InstallPrompt surface (P1/S11 diagnostics contract). The prompt carries no user
/// content (only platform installability flags and an opaque dismissal timestamp), so the collector records ONLY
/// the operational <c>view.opened</c> event with the surface slug — never the install outcome or the dismissal
/// instant, mirroring the web component which persists the dismissal locally and emits no telemetry. Thread-safe;
/// mirrors the peer surfaces' diagnostics collectors.
/// </summary>
public sealed class InstallPromptDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the <c>view.opened</c> line is written to, or null.</param>
    public InstallPromptDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=InstallPrompt</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={InstallPromptRegistration.Slug}");
    }
}
