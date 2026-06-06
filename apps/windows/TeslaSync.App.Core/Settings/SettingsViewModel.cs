using TeslaSync.App.Core.Data.Cache;

namespace TeslaSync.App.Core.Settings;

/// <summary>
/// The headless view-model backing the Windows Settings surface (P2/W8-0002). It adapts the
/// <see cref="AppSettingsService"/> into the typed commands a settings page (W7) or the shell binds to
/// — theme/density/units, API profile, privacy &amp; telemetry opt-in, startup behaviour and developer
/// diagnostics — and owns the "cache size / clear" affordance over the W5 <see cref="ICacheStore"/>.
///
/// <para>It is UI-framework agnostic (no WinUI dependency) so the behaviour is unit-tested headlessly;
/// the WinUI page only data-binds to <see cref="Current"/> and invokes these commands. Secret material
/// is never exposed here — sign-out clears tokens through the W4 secure store, not this view-model.</para>
/// </summary>
public sealed class SettingsViewModel
{
    private readonly AppSettingsService _settings;
    private readonly ICacheStore? _cache;

    /// <summary>Creates the view-model over the settings service and (optionally) the response cache.</summary>
    public SettingsViewModel(AppSettingsService settings, ICacheStore? cache = null)
    {
        ArgumentNullException.ThrowIfNull(settings);
        _settings = settings;
        _cache = cache;
        _settings.Changed += (_, s) => Changed?.Invoke(this, s);
    }

    /// <summary>Raised whenever the underlying settings change.</summary>
    public event EventHandler<AppSettings>? Changed;

    /// <summary>The current settings snapshot.</summary>
    public AppSettings Current => _settings.Current;

    /// <summary>Whether a clearable response cache is wired (false in headless/test contexts).</summary>
    public bool SupportsCacheManagement => _cache is not null;

    /// <summary>Sets the colour theme preference.</summary>
    public Task SetThemeAsync(AppThemePreference theme, CancellationToken cancellationToken = default) =>
        _settings.UpdateAsync(s => s with { Theme = theme }, cancellationToken);

    /// <summary>Sets the interface density preference.</summary>
    public Task SetDensityAsync(InterfaceDensity density, CancellationToken cancellationToken = default) =>
        _settings.UpdateAsync(s => s with { Density = density }, cancellationToken);

    /// <summary>Sets the measurement system applied at the display boundary.</summary>
    public Task SetUnitsAsync(UnitSystemPreference units, CancellationToken cancellationToken = default) =>
        _settings.UpdateAsync(s => s with { Units = units }, cancellationToken);

    /// <summary>Sets the API origin the data layer targets (validated/normalized by the service).</summary>
    public Task SetApiBaseUrlAsync(string baseUrl, CancellationToken cancellationToken = default) =>
        _settings.UpdateAsync(s => s with { ApiBaseUrl = baseUrl }, cancellationToken);

    /// <summary>Selects the named server/connection profile.</summary>
    public Task SetApiProfileAsync(string profile, CancellationToken cancellationToken = default) =>
        _settings.UpdateAsync(s => s with { ApiProfile = profile }, cancellationToken);

    /// <summary>Sets the anonymous-usage-telemetry opt-in.</summary>
    public Task SetTelemetryOptInAsync(bool optIn, CancellationToken cancellationToken = default) =>
        _settings.UpdateAsync(s => s with { TelemetryOptIn = optIn }, cancellationToken);

    /// <summary>Sets the crash-report-submission opt-in.</summary>
    public Task SetCrashReportingOptInAsync(bool optIn, CancellationToken cancellationToken = default) =>
        _settings.UpdateAsync(s => s with { CrashReportingOptIn = optIn }, cancellationToken);

    /// <summary>Sets which surface the app opens on launch.</summary>
    public Task SetStartupPageAsync(AppStartupPage page, CancellationToken cancellationToken = default) =>
        _settings.UpdateAsync(s => s with { StartupPage = page }, cancellationToken);

    /// <summary>Sets whether the app launches automatically at Windows sign-in.</summary>
    public Task SetLaunchAtStartupAsync(bool enabled, CancellationToken cancellationToken = default) =>
        _settings.UpdateAsync(s => s with { LaunchAtStartup = enabled }, cancellationToken);

    /// <summary>Sets the response-cache row bound (clamped by the service).</summary>
    public Task SetMaxCacheEntriesAsync(int maxEntries, CancellationToken cancellationToken = default) =>
        _settings.UpdateAsync(s => s with { MaxCacheEntries = maxEntries }, cancellationToken);

    /// <summary>Toggles the developer-diagnostics surfaces.</summary>
    public Task SetDeveloperDiagnosticsAsync(bool enabled, CancellationToken cancellationToken = default) =>
        _settings.UpdateAsync(s => s with { DeveloperDiagnostics = enabled }, cancellationToken);

    /// <summary>Toggles verbose diagnostic logging.</summary>
    public Task SetVerboseLoggingAsync(bool enabled, CancellationToken cancellationToken = default) =>
        _settings.UpdateAsync(s => s with { VerboseLogging = enabled }, cancellationToken);

    /// <summary>Resets every preference to its default.</summary>
    public Task ResetAsync(CancellationToken cancellationToken = default) =>
        _settings.ResetAsync(cancellationToken);

    /// <summary>The current number of cached response rows (0 when no cache is wired).</summary>
    public async Task<int> GetCacheEntryCountAsync(CancellationToken cancellationToken = default)
    {
        if (_cache is null)
        {
            return 0;
        }

        return await _cache.CountAsync(cancellationToken).ConfigureAwait(false);
    }

    /// <summary>
    /// Clears the W5 response cache. The settings store is untouched (cache and preferences are
    /// independent tiers), and no-ops when no cache is wired.
    /// </summary>
    public async Task ClearCacheAsync(CancellationToken cancellationToken = default)
    {
        if (_cache is null)
        {
            return;
        }

        await _cache.ClearAsync(cancellationToken).ConfigureAwait(false);
    }
}
