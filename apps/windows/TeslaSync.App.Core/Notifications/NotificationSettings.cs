namespace TeslaSync.App.Core.Notifications;

/// <summary>
/// The user's notification preferences (P2/W8-0001). These gate the user-facing surfaces (OS toast +
/// in-app banner) without ever silencing the durable inbox: a disabled kind, the master toggle, quiet
/// hours and Focus Assist all affect whether the user is interrupted, not whether the notification is
/// recorded. <see cref="AllowCriticalBreakthrough"/> lets genuinely urgent notifications (re-auth,
/// security, incidents) surface even through quiet hours / Focus Assist.
/// </summary>
public sealed record NotificationSettings
{
    /// <summary>Master switch for user-facing notifications (toasts and banners).</summary>
    public bool Enabled { get; init; } = true;

    /// <summary>The set of kinds the user wants to be notified about.</summary>
    public IReadOnlySet<NotificationKind> EnabledKinds { get; init; } = AllKinds;

    /// <summary>The local-time quiet-hours window that silences ordinary OS toasts.</summary>
    public QuietHours QuietHours { get; init; } = QuietHours.Disabled;

    /// <summary>Whether the Windows Focus Assist state suppresses ordinary OS toasts.</summary>
    public bool RespectFocusAssist { get; init; } = true;

    /// <summary>Whether PII (VIN, location, email) is masked in toast bodies (ADR-016).</summary>
    public bool RedactSensitiveContent { get; init; }

    /// <summary>Whether critical notifications may break through quiet hours / Focus Assist.</summary>
    public bool AllowCriticalBreakthrough { get; init; } = true;

    /// <summary>Every notification kind (the default enabled set).</summary>
    public static IReadOnlySet<NotificationKind> AllKinds { get; } =
        new HashSet<NotificationKind>(Enum.GetValues<NotificationKind>());

    /// <summary>The default preferences: everything on, no quiet hours, respect Focus Assist.</summary>
    public static NotificationSettings Default { get; } = new();

    /// <summary>True when <paramref name="kind"/> is in the enabled set.</summary>
    public bool IsKindEnabled(NotificationKind kind) => EnabledKinds.Contains(kind);
}

/// <summary>
/// Persists <see cref="NotificationSettings"/> (P2/W8-0001). The Windows implementation stores them in
/// <c>ApplicationData.LocalSettings</c>; the in-memory default backs tests and headless hosts.
/// </summary>
public interface INotificationSettingsStore
{
    /// <summary>Loads the persisted settings, or <see cref="NotificationSettings.Default"/> when none exist.</summary>
    Task<NotificationSettings> LoadAsync(CancellationToken cancellationToken = default);

    /// <summary>Persists <paramref name="settings"/>.</summary>
    Task SaveAsync(NotificationSettings settings, CancellationToken cancellationToken = default);
}

/// <summary>The default in-memory <see cref="INotificationSettingsStore"/> (tests and headless hosts).</summary>
public sealed class InMemoryNotificationSettingsStore : INotificationSettingsStore
{
    private readonly object _gate = new();
    private NotificationSettings _settings;

    /// <summary>Creates the store seeded with <paramref name="initial"/> (defaults when omitted).</summary>
    public InMemoryNotificationSettingsStore(NotificationSettings? initial = null) =>
        _settings = initial ?? NotificationSettings.Default;

    /// <inheritdoc />
    public Task<NotificationSettings> LoadAsync(CancellationToken cancellationToken = default)
    {
        lock (_gate)
        {
            return Task.FromResult(_settings);
        }
    }

    /// <inheritdoc />
    public Task SaveAsync(NotificationSettings settings, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(settings);
        lock (_gate)
        {
            _settings = settings;
        }

        return Task.CompletedTask;
    }
}
