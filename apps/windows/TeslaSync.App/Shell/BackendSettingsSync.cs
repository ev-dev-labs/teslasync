using System;
using System.Text.Json;
using System.Threading.Tasks;
using TeslaSync.App.Core.Data.Repositories;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Settings;
using TeslaSync.App.Settings;

namespace TeslaSync.App.Shell;

/// <summary>
/// Web-parity startup settings seed. The web app reads the persisted accent theme, colour mode and unit
/// preferences from the backend <c>/settings</c> document on first mount (see
/// <c>web/src/components/ui/ThemeProvider.tsx</c> for theme/mode and the <c>useUnits</c>/settings hooks for
/// units) and applies them over its local defaults. This mirrors that so the native app shows the SAME
/// theme AND the SAME units the web app shows for this account: the local <see cref="AppSettings"/> defaults
/// (dark / neon-cyan / metric) only stand in until this resolves, and an unreachable or erroring backend
/// keeps those defaults — the same fallback the web uses when its <c>GET /settings</c> fetch fails. The
/// result is persisted through <see cref="AppSettingsHost"/>, whose <c>Changed</c> event drives the shell's
/// live re-theme (the native <c>applyThemeCSS</c> analogue) and the per-page <c>ApplyUnits</c> refresh.
/// </summary>
internal static class BackendSettingsSync
{
    // The web ThemeProvider only accepts ids that exist in its theme/mode catalogs
    // (`saved in themes` / `saved in modes`); mirror that allow-list so an unexpected
    // backend value falls back to the local default instead of an unknown palette.
    private static readonly string[] AccentThemeIds =
        { "neon-cyan", "tesla-red", "matrix-green", "royal-purple", "solar-amber", "custom" };

    private static readonly string[] ColorModeIds =
        { "dark", "light", "oled", "midnight", "auto", "sunset", "nord" };

    /// <summary>
    /// Reads the backend settings document and, when it carries a recognised <c>theme</c>/<c>mode</c> or
    /// unit preference, commits them to <see cref="AppSettingsHost"/>. Best-effort and non-blocking.
    /// </summary>
    public static async Task ApplyAsync(ShellDataContext data)
    {
        try
        {
            var repo = new SettingsRepository(data.Api, data.Engine, data.Options);
            await foreach (var result in repo.GetSettingsAsync().ConfigureAwait(false))
            {
                if (result.Status != LoadStatus.Loaded)
                {
                    continue;
                }

                JsonElement document = result.Value;
                if (document.ValueKind != JsonValueKind.Object)
                {
                    continue;
                }

                string? theme = ReadId(document, "theme", AccentThemeIds);
                string? mode = ReadId(document, "mode", ColorModeIds);
                UnitSystemPreference? units = ReadUnits(document);
                if (theme is null && mode is null && units is null)
                {
                    return;
                }

                await AppSettingsHost.Service.UpdateAsync(s => s with
                {
                    AccentThemeId = theme ?? s.AccentThemeId,
                    ColorModeId = mode ?? s.ColorModeId,
                    Units = units ?? s.Units,
                }).ConfigureAwait(false);
                return;
            }
        }
        catch (Exception)
        {
            // Best-effort: an unreachable/erroring backend keeps the local defaults in place,
            // which is exactly what the web does when its GET /settings fetch fails.
        }
    }

    private static string? ReadId(JsonElement settings, string property, string[] allowed)
    {
        if (settings.TryGetProperty(property, out var value)
            && value.ValueKind == JsonValueKind.String)
        {
            string? id = value.GetString();
            if (!string.IsNullOrEmpty(id) && Array.IndexOf(allowed, id) >= 0)
            {
                return id;
            }
        }

        return null;
    }

    // The backend stores units granularly (unit_of_length / unit_of_temp / unit_of_pressure), while the
    // native app carries a single metric/imperial preference. Length is the dominant display axis, so it
    // drives the mapping (mi -> imperial, km -> metric); temperature is a tie-breaker when length is absent.
    private static UnitSystemPreference? ReadUnits(JsonElement settings)
    {
        string? length = ReadString(settings, "unit_of_length");
        if (string.Equals(length, "mi", StringComparison.OrdinalIgnoreCase))
        {
            return UnitSystemPreference.Imperial;
        }

        if (string.Equals(length, "km", StringComparison.OrdinalIgnoreCase))
        {
            return UnitSystemPreference.Metric;
        }

        string? temp = ReadString(settings, "unit_of_temp");
        if (string.Equals(temp, "F", StringComparison.OrdinalIgnoreCase))
        {
            return UnitSystemPreference.Imperial;
        }

        if (string.Equals(temp, "C", StringComparison.OrdinalIgnoreCase))
        {
            return UnitSystemPreference.Metric;
        }

        return null;
    }

    private static string? ReadString(JsonElement settings, string property) =>
        settings.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;
}
