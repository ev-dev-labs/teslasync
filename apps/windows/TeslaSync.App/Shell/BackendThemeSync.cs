using System;
using System.Text.Json;
using System.Threading.Tasks;
using TeslaSync.App.Core.Data.Repositories;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Settings;

namespace TeslaSync.App.Shell;

/// <summary>
/// Web-parity startup theme seed. The web <c>ThemeProvider</c> reads the persisted accent theme +
/// colour mode from the backend <c>/settings</c> document on first mount (see
/// <c>web/src/components/ui/ThemeProvider.tsx</c>) and applies them over its local default. This mirrors
/// that exactly so the native app shows the SAME theme the web app shows for this account: the local
/// <see cref="AppSettings"/> default (dark / neon-cyan) only stands in until this resolves, and an
/// unreachable or erroring backend keeps that default — the same fallback the web provider uses when its
/// <c>GET /settings</c> fetch fails. The result is persisted through <see cref="AppSettingsHost"/>, whose
/// <c>Changed</c> event drives the shell's live re-theme (the native <c>applyThemeCSS</c> analogue).
/// </summary>
internal static class BackendThemeSync
{
    // The web ThemeProvider only accepts ids that exist in its theme/mode catalogs
    // (`saved in themes` / `saved in modes`); mirror that allow-list so an unexpected
    // backend value falls back to the local default instead of an unknown palette.
    private static readonly string[] AccentThemeIds =
        { "neon-cyan", "tesla-red", "matrix-green", "royal-purple", "solar-amber", "custom" };

    private static readonly string[] ColorModeIds =
        { "dark", "light", "oled", "midnight", "auto", "sunset", "nord" };

    /// <summary>
    /// Reads the backend settings document and, when it carries a recognised <c>theme</c>/<c>mode</c>,
    /// commits them to <see cref="AppSettingsHost"/>. Best-effort and non-blocking.
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
                if (theme is null && mode is null)
                {
                    return;
                }

                await AppSettingsHost.Service.UpdateAsync(s => s with
                {
                    AccentThemeId = theme ?? s.AccentThemeId,
                    ColorModeId = mode ?? s.ColorModeId,
                }).ConfigureAwait(false);
                return;
            }
        }
        catch (Exception)
        {
            // Best-effort: an unreachable/erroring backend keeps the local default theme in place,
            // which is exactly what the web ThemeProvider does when its GET /settings fetch fails.
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
}
