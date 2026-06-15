using TeslaSync.App.Core.Units;

namespace TeslaSync.App.Core.Settings;

/// <summary>The app-wide colour theme preference (resolved to a WinUI <c>ElementTheme</c> at the render boundary).</summary>
public enum AppThemePreference
{
    /// <summary>Follow the Windows system theme.</summary>
    System = 0,

    /// <summary>Always render the light theme.</summary>
    Light,

    /// <summary>Always render the dark theme.</summary>
    Dark,
}

/// <summary>The interface density (spacing/compactness) preference.</summary>
public enum InterfaceDensity
{
    /// <summary>Roomy spacing — the default.</summary>
    Comfortable = 0,

    /// <summary>Condensed spacing for information-dense displays.</summary>
    Compact,
}

/// <summary>The measurement system the display boundary converts SI values into.</summary>
public enum UnitSystemPreference
{
    /// <summary>Metric units (km, km/h, °C, kPa, Wh, W).</summary>
    Metric = 0,

    /// <summary>Imperial units (mi, mph, °F, psi, kWh, kW).</summary>
    Imperial,
}

/// <summary>Which surface the app opens on launch.</summary>
public enum AppStartupPage
{
    /// <summary>Always open the dashboard (index) route.</summary>
    Dashboard = 0,

    /// <summary>Re-open the route that was active when the app last closed.</summary>
    LastVisited,
}

/// <summary>
/// The user's non-secret application preferences (P2/W8-0002). This record deliberately holds
/// <b>only</b> non-sensitive display/behaviour settings: it is persisted to the packaged app's
/// <c>ApplicationData.LocalSettings</c> via <see cref="IAppSettingsStore"/>. Token / credential
/// material is the exclusive responsibility of the W4 <c>ISecureTokenStore</c> (Credential Locker)
/// and must never be added here, and the durable response cache is the W5 <c>ICacheStore</c> (SQLite).
///
/// <para>The record is immutable; callers evolve it with <c>with</c> expressions through
/// <see cref="AppSettingsService"/> so every change funnels through validation + persistence.</para>
/// </summary>
public sealed record AppSettings
{
    /// <summary>The smallest cache bound a user may select.</summary>
    public const int MinCacheEntries = 50;

    /// <summary>The largest cache bound a user may select.</summary>
    public const int MaxCacheEntriesLimit = 100_000;

    /// <summary>The default response-cache bound (mirrors <c>CacheOptions.MaxEntries</c>).</summary>
    public const int DefaultMaxCacheEntries = 500;

    /// <summary>The fallback API origin used when none has been configured.</summary>
    public const string DefaultApiBaseUrl = "https://teslasync.local";

    /// <summary>The default accent colour theme id (web <c>ThemeProvider</c> theme id).</summary>
    public const string DefaultAccentThemeId = "neon-cyan";

    /// <summary>The default colour mode id (web <c>ThemeProvider</c> mode id).</summary>
    public const string DefaultColorModeId = "dark";

    /// <summary>The colour theme preference.</summary>
    public AppThemePreference Theme { get; init; } = AppThemePreference.System;

    /// <summary>
    /// The accent colour theme id (web <c>ThemeProvider</c> theme id: <c>neon-cyan</c>, <c>tesla-red</c>,
    /// <c>matrix-green</c>, <c>royal-purple</c>, <c>solar-amber</c>, <c>custom</c>). Drives the app-wide accent.
    /// </summary>
    public string AccentThemeId { get; init; } = DefaultAccentThemeId;

    /// <summary>
    /// The colour mode id (web <c>ThemeProvider</c> mode id: <c>dark</c>, <c>light</c>, <c>oled</c>,
    /// <c>midnight</c>, <c>auto</c>, <c>sunset</c>, <c>nord</c>). Drives the background/surface/text palette
    /// and the effective light/dark <c>ElementTheme</c>.
    /// </summary>
    public string ColorModeId { get; init; } = DefaultColorModeId;

    /// <summary>The interface density preference.</summary>
    public InterfaceDensity Density { get; init; } = InterfaceDensity.Comfortable;

    /// <summary>The measurement system applied at the display boundary.</summary>
    public UnitSystemPreference Units { get; init; } = UnitSystemPreference.Metric;

    /// <summary>The API origin (scheme + host[:port]) the data layer targets.</summary>
    public string ApiBaseUrl { get; init; } = DefaultApiBaseUrl;

    /// <summary>The named server/connection profile (e.g. <c>default</c>, <c>staging</c>).</summary>
    public string ApiProfile { get; init; } = "default";

    /// <summary>
    /// Whether the user has opted in to anonymous usage telemetry. Defaults to <see langword="false"/>
    /// (privacy-first / opt-in, per ADR-010).
    /// </summary>
    public bool TelemetryOptIn { get; init; }

    /// <summary>Whether the user has opted in to automatic crash report submission. Opt-in, defaults off.</summary>
    public bool CrashReportingOptIn { get; init; }

    /// <summary>Which surface the app opens on launch.</summary>
    public AppStartupPage StartupPage { get; init; } = AppStartupPage.Dashboard;

    /// <summary>Whether the app should be launched automatically when the user signs in to Windows.</summary>
    public bool LaunchAtStartup { get; init; }

    /// <summary>The maximum number of rows retained in the W5 SQLite response cache.</summary>
    public int MaxCacheEntries { get; init; } = DefaultMaxCacheEntries;

    /// <summary>Whether developer diagnostics surfaces (live SSE counters, route inspector) are shown.</summary>
    public bool DeveloperDiagnostics { get; init; }

    /// <summary>Whether verbose (debug-level) diagnostic logging is enabled.</summary>
    public bool VerboseLogging { get; init; }

    /// <summary>The default, privacy-first settings used on first run or after a reset.</summary>
    public static AppSettings Default { get; } = new();

    /// <summary>The <see cref="UnitPref"/> the formatters consume for <see cref="Units"/>.</summary>
    public UnitPref ToUnitPref() =>
        Units == UnitSystemPreference.Imperial ? UnitPref.Imperial : UnitPref.Metric;

    /// <summary>
    /// Returns a sanitized copy: undefined enum values fall back to their defaults, the cache bound is
    /// clamped to <see cref="MinCacheEntries"/>..<see cref="MaxCacheEntriesLimit"/>, and a blank or
    /// malformed <see cref="ApiBaseUrl"/> reverts to <see cref="DefaultApiBaseUrl"/>. Persisted values
    /// are always normalized before use so a hand-edited or stale store can never feed an invalid
    /// setting into the app.
    /// </summary>
    public AppSettings Normalized() => this with
    {
        Theme = Enum.IsDefined(Theme) ? Theme : AppThemePreference.System,
        Density = Enum.IsDefined(Density) ? Density : InterfaceDensity.Comfortable,
        Units = Enum.IsDefined(Units) ? Units : UnitSystemPreference.Metric,
        StartupPage = Enum.IsDefined(StartupPage) ? StartupPage : AppStartupPage.Dashboard,
        ApiBaseUrl = NormalizeBaseUrl(ApiBaseUrl),
        ApiProfile = string.IsNullOrWhiteSpace(ApiProfile) ? "default" : ApiProfile.Trim(),
        MaxCacheEntries = Math.Clamp(MaxCacheEntries, MinCacheEntries, MaxCacheEntriesLimit),
    };

    private static string NormalizeBaseUrl(string? value)
    {
        if (!string.IsNullOrWhiteSpace(value)
            && Uri.TryCreate(value.Trim(), UriKind.Absolute, out var uri)
            && (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps))
        {
            return uri.GetLeftPart(UriPartial.Authority);
        }

        return DefaultApiBaseUrl;
    }
}
