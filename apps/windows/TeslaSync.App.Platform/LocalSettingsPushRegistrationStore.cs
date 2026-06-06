using System.Text.Json;
using TeslaSync.App.Core.Push;
using Windows.Storage;

namespace TeslaSync.App.Platform;

/// <summary>
/// The Windows <see cref="IPushRegistrationStore"/> (P2/W6-0002): it persists the non-secret
/// <see cref="PushRegistrationRecord"/> as a JSON value in <c>ApplicationData.LocalSettings</c>. The
/// record carries no channel URI or token — only the backend registration id, platform, app version,
/// the channel <em>fingerprint</em> and timestamps — so nothing credential-grade is written to disk.
/// All access is guarded so an unpackaged dev run degrades to an empty store rather than throwing.
/// </summary>
public sealed class LocalSettingsPushRegistrationStore : IPushRegistrationStore
{
    private const string SettingsContainer = "teslasync.push";
    private const string RecordKey = "registration";

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    /// <inheritdoc />
    public Task<PushRegistrationRecord?> LoadAsync(CancellationToken cancellationToken = default)
    {
        try
        {
            var container = Container();
            if (container.Values.TryGetValue(RecordKey, out var value) && value is string json && !string.IsNullOrEmpty(json))
            {
                return Task.FromResult(JsonSerializer.Deserialize<PushRegistrationRecord>(json, JsonOptions));
            }
        }
        catch (Exception)
        {
            // Absent / unreadable / no identity — treat as "nothing registered".
        }

        return Task.FromResult<PushRegistrationRecord?>(null);
    }

    /// <inheritdoc />
    public Task SaveAsync(PushRegistrationRecord record, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(record);
        try
        {
            Container().Values[RecordKey] = JsonSerializer.Serialize(record, JsonOptions);
        }
        catch (Exception)
        {
            // No package identity — persistence is best-effort; the in-memory service state still holds.
        }

        return Task.CompletedTask;
    }

    /// <inheritdoc />
    public Task ClearAsync(CancellationToken cancellationToken = default)
    {
        try
        {
            Container().Values.Remove(RecordKey);
        }
        catch (Exception)
        {
            // Idempotent: nothing stored (or no identity) is a successful clear.
        }

        return Task.CompletedTask;
    }

    private static ApplicationDataContainer Container() =>
        ApplicationData.Current.LocalSettings.CreateContainer(SettingsContainer, ApplicationDataCreateDisposition.Always);
}
