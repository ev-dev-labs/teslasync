using System.Text.Json;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// Canonical metadata for the NewVersionBanner surface — the native analogue of the module-level literals and
/// <c>t()</c> keys in web/src/components/feedback/NewVersionBanner.tsx and the version derivation in
/// web/src/hooks/useVersionWatcher.ts. Carries the diagnostics slug, the banner / action automation ids (the web
/// <c>data-testid</c> value plus stable ids for the two buttons), the ARIA role + live contract (web
/// <c>role="status"</c> / <c>aria-live="polite"</c>), the per-version <c>sessionStorage</c> key reused verbatim,
/// the emerald design-token keys + Segoe Fluent sparkle glyph standing in for the web Lucide <c>Sparkles</c>, the
/// banner tint alphas, the i18n keys (each with the English fallback the web renders verbatim — all three already
/// present in the P1/S10 catalogue under <c>translation.app.newVersion.*</c>), and the pure version helpers
/// (<see cref="ReadAppVersion"/>, <see cref="NormalizeVersion"/>, <see cref="IsNewVersionAvailable"/>). UI-free so
/// it is asserted in tests.
/// </summary>
public static class NewVersionBannerRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "NewVersionBanner";

    /// <summary>The automation id Narrator and UI-automation resolve the banner by (web <c>data-testid</c>).</summary>
    public const string BannerAutomationId = "new-version-banner";

    /// <summary>The automation id for the "Later" (defer) button.</summary>
    public const string LaterAutomationId = "new-version-banner-later";

    /// <summary>The automation id for the "Reload" (apply) button.</summary>
    public const string ReloadAutomationId = "new-version-banner-reload";

    /// <summary>ARIA role the surface exposes — a read-only status region (web <c>role="status"</c>).</summary>
    public const string StatusRole = "status";

    /// <summary>ARIA live urgency the surface declares (web <c>aria-live="polite"</c>).</summary>
    public const string LiveSetting = "polite";

    /// <summary>The per-version dismissal key — the web <c>sessionStorage</c> key, reused verbatim (NewVersionBanner.tsx L25).</summary>
    public const string SessionDismissStorageKey = "teslasync:new-version-dismissed-for";

    /// <summary>The JSON field the backend reports the running version under (web <c>app_version</c>, snake_case wire).</summary>
    public const string AppVersionField = "app_version";

    /// <summary>The camelCase alias the web <c>camelCaseKeys</c> transform also exposes the version under.</summary>
    public const string AppVersionFieldCamel = "appVersion";

    /// <summary>Segoe Fluent "Sparkle" glyph — the native stand-in for the web Lucide <c>Sparkles</c> mark.</summary>
    public const string SparkleGlyph = "\uE734";

    /// <summary>Generated design-token colour key the emerald accent / chip tint is derived from (web emerald-500).</summary>
    public const string AccentColorKey = "TsColorSuccessColor";

    /// <summary>Generated design-token brush key for the emerald accent (web text-emerald-300 / border-emerald-500).</summary>
    public const string AccentBrushKey = "TsColorSuccessBrush";

    /// <summary>Generated design-token brush key for the overlay card surface (web <c>bg-[var(--surface-overlay)]</c>).</summary>
    public const string OverlayBrushKey = "TsMaterialOverlayBrush";

    /// <summary>Icon-chip background alpha over the emerald colour (web <c>bg-emerald-500/10</c>).</summary>
    public const double ChipBackgroundOpacity = 0.10;

    /// <summary>Card border alpha over the emerald colour (web <c>border-emerald-500/30</c>).</summary>
    public const double CardBorderOpacity = 0.30;

    /// <summary>i18n key for the banner message (web <c>t('app.newVersion.message', …)</c> at NewVersionBanner.tsx L79).</summary>
    public const string MessageKey = "translation.app.newVersion.message";

    /// <summary>English fallback for <see cref="MessageKey"/> — the web default value, verbatim.</summary>
    public const string MessageFallback = "A new version of TeslaSync is available.";

    /// <summary>i18n key for the "Later" defer action (web <c>t('app.newVersion.later', …)</c> at NewVersionBanner.tsx L83).</summary>
    public const string LaterKey = "translation.app.newVersion.later";

    /// <summary>English fallback for <see cref="LaterKey"/> — the web default value, verbatim.</summary>
    public const string LaterFallback = "Later";

    /// <summary>i18n key for the "Reload" apply action (web <c>t('app.newVersion.reload', …)</c> at NewVersionBanner.tsx L86).</summary>
    public const string ReloadKey = "translation.app.newVersion.reload";

    /// <summary>English fallback for <see cref="ReloadKey"/> — the web default value, verbatim.</summary>
    public const string ReloadFallback = "Reload";

    /// <summary>
    /// Normalize a reported version into a usable value or null — the native port of the web length check
    /// (<c>typeof app_version === 'string' &amp;&amp; app_version.length &gt; 0</c>, useVersionWatcher.ts L60): a
    /// null or empty string is treated as "no version" so it never overwrites the captured boot / latest version.
    /// </summary>
    /// <param name="version">The raw reported version.</param>
    public static string? NormalizeVersion(string? version) =>
        string.IsNullOrEmpty(version) ? null : version;

    /// <summary>
    /// Read the <c>app_version</c> out of a <c>/system/version</c> payload — tolerant of the <c>camelCaseKeys</c>
    /// duality (both <c>app_version</c> and <c>appVersion</c> may be present after the web transform), returning
    /// the version string when present and non-empty, or null otherwise (the web <c>fetchVersion</c> guard,
    /// useVersionWatcher.ts L59-62).
    /// </summary>
    /// <param name="version">The decoded version payload.</param>
    public static string? ReadAppVersion(JsonElement version)
    {
        if (version.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        if (version.TryGetProperty(AppVersionField, out var snake) && AsVersion(snake) is { } snakeValue)
        {
            return snakeValue;
        }

        return version.TryGetProperty(AppVersionFieldCamel, out var camel) ? AsVersion(camel) : null;
    }

    /// <summary>
    /// The native port of the web <c>newVersionAvailable</c> derivation (useVersionWatcher.ts L151-155): true iff a
    /// boot version and a later version are both known and they differ.
    /// </summary>
    /// <param name="bootVersion">The version captured on boot (web <c>bootVersion</c>).</param>
    /// <param name="latestVersion">The most recent version seen (web <c>latestVersion</c>).</param>
    public static bool IsNewVersionAvailable(string? bootVersion, string? latestVersion) =>
        !string.IsNullOrEmpty(bootVersion)
        && !string.IsNullOrEmpty(latestVersion)
        && !string.Equals(bootVersion, latestVersion, StringComparison.Ordinal);

    /// <summary>Resolve the localized banner message (web <c>t('app.newVersion.message')</c>).</summary>
    /// <param name="localizer">The i18n facade.</param>
    public static string ResolveMessage(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(MessageKey, MessageFallback);
    }

    /// <summary>Resolve the localized "Later" action label (web <c>t('app.newVersion.later')</c>).</summary>
    /// <param name="localizer">The i18n facade.</param>
    public static string ResolveLaterLabel(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(LaterKey, LaterFallback);
    }

    /// <summary>Resolve the localized "Reload" action label (web <c>t('app.newVersion.reload')</c>).</summary>
    /// <param name="localizer">The i18n facade.</param>
    public static string ResolveReloadLabel(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(ReloadKey, ReloadFallback);
    }

    private static string? AsVersion(JsonElement value) =>
        value.ValueKind == JsonValueKind.String ? NormalizeVersion(value.GetString()) : null;
}

/// <summary>
/// The fully projected, render-ready view of the version-watcher state + the persisted per-version dismissal —
/// everything the web <c>NewVersionBanner</c> derives before returning JSX
/// (web/src/components/feedback/NewVersionBanner.tsx L50-89): whether the banner is shown (<see cref="IsVisible"/> —
/// the web <c>!newVersionAvailable</c> and <c>dismissedVersion === latestVersion</c> early-returns, inverted), the
/// localized <see cref="Message"/>, the localized <see cref="LaterLabel"/> / <see cref="ReloadLabel"/>, the
/// <see cref="LatestVersion"/> a "Later" click defers (web <c>latestVersion</c>), the ARIA <see cref="LiveSetting"/>,
/// and the <see cref="AccessibleName"/> the polite status region announces. Pure value type so every field is
/// asserted headlessly.
/// </summary>
public readonly record struct NewVersionBannerProjection
{
    private NewVersionBannerProjection(
        bool isVisible,
        string message,
        string laterLabel,
        string reloadLabel,
        string? latestVersion,
        string liveSetting,
        string accessibleName)
    {
        IsVisible = isVisible;
        Message = message;
        LaterLabel = laterLabel;
        ReloadLabel = reloadLabel;
        LatestVersion = latestVersion;
        LiveSetting = liveSetting;
        AccessibleName = accessibleName;
    }

    /// <summary>Whether the banner is shown — new version available AND not already deferred for that version.</summary>
    public bool IsVisible { get; }

    /// <summary>The localized banner message (web <c>app.newVersion.message</c>); also the status region's accessible name.</summary>
    public string Message { get; }

    /// <summary>The localized "Later" defer action label (web <c>app.newVersion.later</c>).</summary>
    public string LaterLabel { get; }

    /// <summary>The localized "Reload" apply action label (web <c>app.newVersion.reload</c>).</summary>
    public string ReloadLabel { get; }

    /// <summary>The version a "Later" click defers (web <c>latestVersion</c>), or null when none is known.</summary>
    public string? LatestVersion { get; }

    /// <summary>The ARIA live urgency the banner declares (polite).</summary>
    public string LiveSetting { get; }

    /// <summary>The accessible name a screen reader announces for the polite status region — the message.</summary>
    public string AccessibleName { get; }

    /// <summary>
    /// Project the watcher state + dismissal flag into a render-ready banner value, reproducing the web component
    /// (web/src/components/feedback/NewVersionBanner.tsx L50-89): the banner is visible only when a new version is
    /// available AND the user has not deferred that exact version; deferring an older version does not suppress the
    /// banner for a newer one (the web per-version <c>sessionStorage</c> key compared against <c>latestVersion</c>).
    /// The message and action labels are always resolved so they are ready the instant the banner shows.
    /// </summary>
    /// <param name="bootVersion">The version captured on boot (web <c>bootVersion</c>).</param>
    /// <param name="latestVersion">The most recent version seen (web <c>latestVersion</c>).</param>
    /// <param name="dismissedVersion">The version the user last deferred (web <c>sessionStorage</c> value), or null.</param>
    /// <param name="localizer">The i18n facade the strings resolve through.</param>
    public static NewVersionBannerProjection Project(
        string? bootVersion,
        string? latestVersion,
        string? dismissedVersion,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        var newVersionAvailable = NewVersionBannerRegistration.IsNewVersionAvailable(bootVersion, latestVersion);
        var deferredForCurrent =
            !string.IsNullOrEmpty(latestVersion)
            && string.Equals(dismissedVersion, latestVersion, StringComparison.Ordinal);

        var message = NewVersionBannerRegistration.ResolveMessage(localizer);

        return new NewVersionBannerProjection(
            isVisible: newVersionAvailable && !deferredForCurrent,
            message: message,
            laterLabel: NewVersionBannerRegistration.ResolveLaterLabel(localizer),
            reloadLabel: NewVersionBannerRegistration.ResolveReloadLabel(localizer),
            latestVersion: latestVersion,
            liveSetting: NewVersionBannerRegistration.LiveSetting,
            accessibleName: message);
    }
}

/// <summary>
/// PII-safe diagnostics for the NewVersionBanner surface (P1/S11 diagnostics contract). The banner carries only an
/// opaque build-version string and two static action labels (no user content), so the collector records ONLY the
/// operational <c>view.opened</c> event with the surface slug — never the version string itself, mirroring the web
/// component which emits no telemetry. Thread-safe; mirrors the peer surfaces' diagnostics collectors.
/// </summary>
public sealed class NewVersionBannerDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the <c>view.opened</c> line is written to, or null.</param>
    public NewVersionBannerDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=NewVersionBanner</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={NewVersionBannerRegistration.Slug}");
    }
}
