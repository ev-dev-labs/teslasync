using System.Text.Json;
using System.Text.Json.Serialization;
using TeslaSync.App.Core.Notifications;
using Windows.Storage;

namespace TeslaSync.App.Platform;

/// <summary>
/// The Windows <see cref="INotificationSettingsStore"/> (P2/W8-0001): it persists the user's
/// notification preferences as a JSON value in <c>ApplicationData.LocalSettings</c>. The stored shape
/// is a small DTO (enabled kinds are written as stable name tokens, quiet hours as flat
/// <c>HH:mm:ss</c> fields) so an enum reorder cannot corrupt a saved preference. Every access is
/// guarded so an unpackaged dev run degrades to <see cref="NotificationSettings.Default"/> rather than
/// throwing.
/// </summary>
public sealed class LocalSettingsNotificationSettingsStore : INotificationSettingsStore
{
    private const string SettingsContainer = "teslasync.notifications";
    private const string RecordKey = "settings";

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter() },
    };

    /// <inheritdoc />
    public Task<NotificationSettings> LoadAsync(CancellationToken cancellationToken = default)
    {
        try
        {
            var container = Container();
            if (container.Values.TryGetValue(RecordKey, out var value) && value is string json && !string.IsNullOrEmpty(json))
            {
                var dto = JsonSerializer.Deserialize<SettingsDto>(json, JsonOptions);
                if (dto is not null)
                {
                    return Task.FromResult(dto.ToSettings());
                }
            }
        }
        catch (Exception)
        {
            // Absent / unreadable / no identity — fall back to defaults.
        }

        return Task.FromResult(NotificationSettings.Default);
    }

    /// <inheritdoc />
    public Task SaveAsync(NotificationSettings settings, CancellationToken cancellationToken = default)
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
        public bool Enabled { get; init; } = true;

        public NotificationKind[] EnabledKinds { get; init; } = Array.Empty<NotificationKind>();

        public bool QuietHoursEnabled { get; init; }

        public TimeOnly QuietHoursStart { get; init; }

        public TimeOnly QuietHoursEnd { get; init; }

        public bool RespectFocusAssist { get; init; } = true;

        public bool RedactSensitiveContent { get; init; }

        public bool AllowCriticalBreakthrough { get; init; } = true;

        public NotificationSettings ToSettings() => new()
        {
            Enabled = Enabled,
            EnabledKinds = new HashSet<NotificationKind>(EnabledKinds),
            QuietHours = new QuietHours(QuietHoursEnabled, QuietHoursStart, QuietHoursEnd),
            RespectFocusAssist = RespectFocusAssist,
            RedactSensitiveContent = RedactSensitiveContent,
            AllowCriticalBreakthrough = AllowCriticalBreakthrough,
        };

        public static SettingsDto From(NotificationSettings settings) => new()
        {
            Enabled = settings.Enabled,
            EnabledKinds = settings.EnabledKinds.ToArray(),
            QuietHoursEnabled = settings.QuietHours.Enabled,
            QuietHoursStart = settings.QuietHours.Start,
            QuietHoursEnd = settings.QuietHours.End,
            RespectFocusAssist = settings.RespectFocusAssist,
            RedactSensitiveContent = settings.RedactSensitiveContent,
            AllowCriticalBreakthrough = settings.AllowCriticalBreakthrough,
        };
    }
}
