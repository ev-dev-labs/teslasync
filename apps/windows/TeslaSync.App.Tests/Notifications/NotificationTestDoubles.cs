using TeslaSync.App.Core.Live;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Push;

namespace TeslaSync.App.Tests.Notifications;

/// <summary>Shared in-memory doubles for the notification-polish (P2/W8-0001) unit tests.</summary>
internal sealed class RecordingToastPresenter : IToastPresenter
{
    public List<ToastContent> Shown { get; } = new();

    public Task PresentAsync(ToastContent content, CancellationToken cancellationToken = default)
    {
        Shown.Add(content);
        return Task.CompletedTask;
    }
}

/// <summary>An <see cref="IPushBannerSink"/> that records the banners it was asked to publish.</summary>
internal sealed class RecordingNotificationBanner : IPushBannerSink
{
    public List<PushBanner> Published { get; } = new();

    public void Publish(PushBanner banner) => Published.Add(banner);
}

/// <summary>A controllable <see cref="IForegroundLifecycle"/> for delivery-policy tests.</summary>
internal sealed class FakeForeground : IForegroundLifecycle
{
    public FakeForeground(bool isForeground) => IsForeground = isForeground;

    public bool IsForeground { get; private set; }

    public event Action<bool>? ForegroundChanged;

    public void Set(bool isForeground)
    {
        IsForeground = isForeground;
        ForegroundChanged?.Invoke(isForeground);
    }
}

/// <summary>A controllable <see cref="IFocusAssistProvider"/> for delivery-policy tests.</summary>
internal sealed class FakeFocusAssist : IFocusAssistProvider
{
    public FakeFocusAssist(FocusAssistState state = FocusAssistState.Off) => Current = state;

    public FocusAssistState Current { get; set; }
}

/// <summary>An <see cref="ILocalizer"/> that records the keys it was asked for and can map a few of them.</summary>
internal sealed class RecordingLocalizer : ILocalizer
{
    private readonly IReadOnlyDictionary<string, string> _map;

    public RecordingLocalizer(IReadOnlyDictionary<string, string>? map = null) =>
        _map = map ?? new Dictionary<string, string>(StringComparer.Ordinal);

    public List<string> RequestedKeys { get; } = new();

    public string GetString(string key, string fallback)
    {
        RequestedKeys.Add(key);
        return _map.TryGetValue(key, out var value) ? value : fallback;
    }
}
