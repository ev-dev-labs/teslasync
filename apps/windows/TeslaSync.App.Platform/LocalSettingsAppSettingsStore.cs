using System.Text.Json;
using System.Text.Json.Serialization;
using TeslaSync.App.Core.Settings;
using Windows.Storage;

namespace TeslaSync.App.Platform;

/// <summary>
/// The Windows <see cref="IAppSettingsStore"/> (P2/W8-0002): it persists the user's non-secret
/// <see cref="AppSettings"/> as a JSON value in <c>ApplicationData.LocalSettings</c>. Enums are written
/// as stable name tokens (via <see cref="JsonStringEnumConverter"/>) so a future reorder cannot corrupt
/// a saved preference, and every access is guarded so an unpackaged/identity-less dev run degrades to
/// <see cref="AppSettings.Default"/> rather than throwing.
///
/// <para>This store holds only display/behaviour preferences. Tokens live in the W4 Credential-Locker
/// store (<c>PasswordVaultTokenStore</c>) and cached payloads in the W5 SQLite cache; the three tiers
/// never share storage.</para>
/// </summary>
public sealed class LocalSettingsAppSettingsStore : IAppSettingsStore
{
    private const string SettingsContainer = "teslasync.app";
    private const string RecordKey = "settings";

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter() },
    };

    /// <inheritdoc />
    public Task<AppSettings> LoadAsync(CancellationToken cancellationToken = default)
    {
        try
        {
            var container = Container();
            if (container.Values.TryGetValue(RecordKey, out var value) && value is string json && !string.IsNullOrEmpty(json))
            {
                var dto = JsonSerializer.Deserialize<SettingsDto>(json, JsonOptions);
                if (dto is not null)
                {
                    return Task.FromResult(dto.ToSettings().Normalized());
                }
            }
        }
        catch (Exception)
        {
            // Absent / unreadable / no identity — fall back to defaults.
        }

        return Task.FromResult(AppSettings.Default);
    }

    /// <inheritdoc />
    public Task SaveAsync(AppSettings settings, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(settings);
        try
        {
            Container().Values[RecordKey] = JsonSerializer.Serialize(SettingsDto.From(settings), JsonOptions);
        }
        catch (Exception)
        {
            // No package identity — persistence is best-effort; the in-memory state still holds.
        }

        return Task.CompletedTask;
    }

    private static ApplicationDataContainer Container() =>
        ApplicationData.Current.LocalSettings.CreateContainer(SettingsContainer, ApplicationDataCreateDisposition.Always);

    private sealed record SettingsDto
    {
        public AppThemePreference Theme { get; init; } = AppThemePreference.System;

        public string AccentThemeId { get; init; } = AppSettings.DefaultAccentThemeId;

        public string ColorModeId { get; init; } = AppSettings.DefaultColorModeId;

        public InterfaceDensity Density { get; init; } = InterfaceDensity.Comfortable;

        public UnitSystemPreference Units { get; init; } = UnitSystemPreference.Metric;

        public string ApiBaseUrl { get; init; } = AppSettings.DefaultApiBaseUrl;

        public string ApiProfile { get; init; } = "default";

        public bool TelemetryOptIn { get; init; }

        public bool CrashReportingOptIn { get; init; }

        public AppStartupPage StartupPage { get; init; } = AppStartupPage.Dashboard;

        public bool LaunchAtStartup { get; init; }

        public int MaxCacheEntries { get; init; } = AppSettings.DefaultMaxCacheEntries;

        public bool DeveloperDiagnostics { get; init; }

        public bool VerboseLogging { get; init; }

        public AppSettings ToSettings() => new()
        {
            Theme = Theme,
            AccentThemeId = string.IsNullOrWhiteSpace(AccentThemeId) ? AppSettings.DefaultAccentThemeId : AccentThemeId,
            ColorModeId = string.IsNullOrWhiteSpace(ColorModeId) ? AppSettings.DefaultColorModeId : ColorModeId,
            Density = Density,
            Units = Units,
            ApiBaseUrl = ApiBaseUrl,
            ApiProfile = ApiProfile,
            TelemetryOptIn = TelemetryOptIn,
            CrashReportingOptIn = CrashReportingOptIn,
            StartupPage = StartupPage,
            LaunchAtStartup = LaunchAtStartup,
            MaxCacheEntries = MaxCacheEntries,
            DeveloperDiagnostics = DeveloperDiagnostics,
            VerboseLogging = VerboseLogging,
        };

        public static SettingsDto From(AppSettings settings) => new()
        {
            Theme = settings.Theme,
            AccentThemeId = settings.AccentThemeId,
            ColorModeId = settings.ColorModeId,
            Density = settings.Density,
            Units = settings.Units,
            ApiBaseUrl = settings.ApiBaseUrl,
            ApiProfile = settings.ApiProfile,
            TelemetryOptIn = settings.TelemetryOptIn,
            CrashReportingOptIn = settings.CrashReportingOptIn,
            StartupPage = settings.StartupPage,
            LaunchAtStartup = settings.LaunchAtStartup,
            MaxCacheEntries = settings.MaxCacheEntries,
            DeveloperDiagnostics = settings.DeveloperDiagnostics,
            VerboseLogging = settings.VerboseLogging,
        };
    }
}
