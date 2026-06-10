using System.Text.Json;
using TeslaSync.App.Core.Data.Net;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The mutation port the <see cref="ResetSectionViewModel"/> binds to (P1/S8 state-holder seam) — the native
/// analogue of the web <c>useResetSection</c> / <c>useResetAllSettings</c> hooks
/// (web/src/api/hooks/useSettingsReset.ts). Both drive the same <c>POST /settings/reset</c> endpoint: a
/// single-section reset sends <c>{ section }</c>, the danger-zone reset sends <c>{}</c>. The view never
/// performs HTTP itself; the concrete <see cref="SettingsResetSource"/> (or a test fake) drives this.
/// </summary>
public interface ISettingsResetSource
{
    /// <summary>
    /// Reset one whitelisted section (web <c>useResetSection(section).mutate()</c>): <c>POST /settings/reset</c>
    /// with <c>{ section }</c>. Throws on a transport / HTTP failure so the caller can surface the error.
    /// </summary>
    Task<SettingsResetResult> ResetSectionAsync(string section, CancellationToken cancellationToken = default);

    /// <summary>
    /// Reset every whitelisted section (web <c>useResetAllSettings().mutate()</c>): <c>POST /settings/reset</c>
    /// with an empty body. Throws on a transport / HTTP failure so the caller can surface the error.
    /// </summary>
    Task<SettingsResetResult> ResetAllAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The contract-client-backed <see cref="ISettingsResetSource"/> — the native data adapter for the reset
/// surface. Both operations POST the generated <c>post_api_v1_settings_reset</c> endpoint through the shared
/// <see cref="IApiClient"/> (the same auth + resilience pipeline the rest of the app shares; the web's
/// transparent SUDO step-up is handled by the shared auth handler) and parse the JSON receipt via
/// <see cref="SettingsResetResultParser"/>. The body is a plain string map so the wire shape matches the web
/// exactly — <c>{"section":"…"}</c> for a section reset and <c>{}</c> for the global reset — regardless of the
/// shared serializer's naming policy. No HTTP touches the view.
/// </summary>
public sealed class SettingsResetSource : ISettingsResetSource
{
    /// <summary>The generated OpenAPI operation id for <c>POST /api/v1/settings/reset</c>.</summary>
    private const string ResetOperation = "post_api_v1_settings_reset";

    private readonly IApiClient _api;

    /// <summary>Creates the source over the shared contract client.</summary>
    /// <param name="api">The generated contract client used for the reset POST.</param>
    public SettingsResetSource(IApiClient api)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
    }

    /// <inheritdoc />
    public Task<SettingsResetResult> ResetSectionAsync(string section, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrEmpty(section);
        var body = new Dictionary<string, string>(StringComparer.Ordinal) { ["section"] = section };
        return SendAsync(body, cancellationToken);
    }

    /// <inheritdoc />
    public Task<SettingsResetResult> ResetAllAsync(CancellationToken cancellationToken = default) =>
        SendAsync(new Dictionary<string, string>(StringComparer.Ordinal), cancellationToken);

    private async Task<SettingsResetResult> SendAsync(
        IReadOnlyDictionary<string, string> body,
        CancellationToken cancellationToken)
    {
        var request = new ApiRequest(ResetOperation, Body: body);
        var response = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return SettingsResetResultParser.Parse(response);
    }
}
