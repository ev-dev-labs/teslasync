using TeslaSync.App.Core.Lifecycle;
using TeslaSync.App.Core.Live;
using Xunit;

namespace TeslaSync.App.Tests.Lifecycle;

/// <summary>
/// Verifies the headless <see cref="LifecycleCoordinator"/>: launch, the windowed suspend/resume
/// sequence, crash-safe persist, network propagation, and the "no duplicate streams / no stale-as-live"
/// guarantees acceptance criterion #2 depends on.
/// </summary>
public sealed class LifecycleCoordinatorTests
{
    [Fact]
    public void MarkLaunched_moves_launching_to_running_once()
    {
        var foreground = new FakeForeground();
        using var coordinator = new LifecycleCoordinator(foreground);
        var listener = new RecordingListener();
        coordinator.AddListener(listener);

        Assert.Equal(AppLifecycleState.Launching, coordinator.State);

        coordinator.MarkLaunched();
        coordinator.MarkLaunched();

        Assert.Equal(AppLifecycleState.Running, coordinator.State);
        Assert.Equal(new[] { "state:Launching->Running" }, listener.Events);
    }

    [Fact]
    public void Backgrounding_suspends_and_persists_before_suspended()
    {
        var foreground = new FakeForeground();
        using var coordinator = new LifecycleCoordinator(foreground);
        var listener = new RecordingListener();
        coordinator.AddListener(listener);
        coordinator.MarkLaunched();
        listener.Events.Clear();

        foreground.Set(false);

        Assert.Equal(AppLifecycleState.Suspended, coordinator.State);
        Assert.Equal(
            new[]
            {
                "state:Running->Suspending",
                "persist:Suspend",
                "state:Suspending->Suspended",
            },
            listener.Events);
    }

    [Fact]
    public void Foregrounding_resumes_through_resuming_without_showing_stale_as_live()
    {
        var now = DateTimeOffset.UtcNow;
        var foreground = new FakeForeground();
        using var coordinator = new LifecycleCoordinator(foreground, clock: () => now);
        var listener = new RecordingListener();
        coordinator.AddListener(listener);
        coordinator.MarkLaunched();
        foreground.Set(false);
        listener.Events.Clear();

        foreground.Set(true);

        Assert.Equal(AppLifecycleState.Running, coordinator.State);

        // Resuming must precede Running so listeners re-validate freshness before going live again.
        Assert.Equal(
            new[]
            {
                "state:Suspended->Resuming",
                "state:Resuming->Running",
            },
            listener.Events);
        Assert.Equal(now, coordinator.LastResumedAt);
    }

    [Fact]
    public void Redundant_foreground_signals_do_not_duplicate_resumes()
    {
        var foreground = new FakeForeground();
        using var coordinator = new LifecycleCoordinator(foreground);
        var live = new ResumeCountingListener();
        coordinator.AddListener(live);
        coordinator.MarkLaunched();

        // One suspend/resume cycle, then extra spurious foreground signals.
        foreground.Set(false);
        foreground.Set(true);
        foreground.Set(true);
        foreground.Set(true);

        Assert.Equal(1, live.ResumeCount);
        Assert.Equal(AppLifecycleState.Running, coordinator.State);
    }

    [Fact]
    public void Network_changes_propagate_and_dedupe()
    {
        var foreground = new FakeForeground();
        var network = new FakeNetwork(online: true);
        using var coordinator = new LifecycleCoordinator(foreground, network);
        var listener = new RecordingListener();
        coordinator.AddListener(listener);

        network.Set(false);
        network.Set(false); // duplicate — ignored
        network.Set(true);

        Assert.True(coordinator.IsOnline);
        Assert.Equal(new[] { false, true }, listener.NetworkChanges);
    }

    [Fact]
    public void NotifyFatalError_persists_listeners()
    {
        var foreground = new FakeForeground();
        using var coordinator = new LifecycleCoordinator(foreground);
        var listener = new RecordingListener();
        coordinator.AddListener(listener);
        coordinator.MarkLaunched();

        coordinator.NotifyFatalError();

        Assert.Contains("persist:FatalError", listener.Events);
    }

    [Fact]
    public void A_throwing_listener_does_not_break_the_coordinator()
    {
        var foreground = new FakeForeground();
        using var coordinator = new LifecycleCoordinator(foreground);
        coordinator.AddListener(new ThrowingListener());
        var good = new RecordingListener();
        coordinator.AddListener(good);

        coordinator.MarkLaunched();
        foreground.Set(false);

        Assert.Equal(AppLifecycleState.Suspended, coordinator.State);
        Assert.Contains("persist:Suspend", good.Events);
    }

    private sealed class FakeForeground : IForegroundLifecycle
    {
        public bool IsForeground { get; private set; } = true;

        public event Action<bool>? ForegroundChanged;

        public void Set(bool foreground)
        {
            IsForeground = foreground;
            ForegroundChanged?.Invoke(foreground);
        }
    }

    private sealed class FakeNetwork : INetworkAvailability
    {
        public FakeNetwork(bool online) => IsOnline = online;

        public bool IsOnline { get; private set; }

        public event Action<bool>? AvailabilityChanged;

        public void Set(bool online)
        {
            IsOnline = online;
            AvailabilityChanged?.Invoke(online);
        }
    }

    private sealed class RecordingListener : ILifecycleListener
    {
        public List<string> Events { get; } = new();

        public List<bool> NetworkChanges { get; } = new();

        public void OnLifecycleStateChanged(AppLifecycleState previous, AppLifecycleState current) =>
            Events.Add($"state:{previous}->{current}");

        public void OnNetworkChanged(bool isOnline)
        {
            NetworkChanges.Add(isOnline);
            Events.Add($"network:{isOnline}");
        }

        public void PersistForShutdown(LifecycleShutdownReason reason) =>
            Events.Add($"persist:{reason}");
    }

    private sealed class ResumeCountingListener : ILifecycleListener
    {
        public int ResumeCount { get; private set; }

        public void OnLifecycleStateChanged(AppLifecycleState previous, AppLifecycleState current)
        {
            if (current == AppLifecycleState.Resuming)
            {
                ResumeCount++;
            }
        }

        public void OnNetworkChanged(bool isOnline)
        {
        }

        public void PersistForShutdown(LifecycleShutdownReason reason)
        {
        }
    }

    private sealed class ThrowingListener : ILifecycleListener
    {
        public void OnLifecycleStateChanged(AppLifecycleState previous, AppLifecycleState current) =>
            throw new InvalidOperationException("listener boom");

        public void OnNetworkChanged(bool isOnline) =>
            throw new InvalidOperationException("listener boom");

        public void PersistForShutdown(LifecycleShutdownReason reason) =>
            throw new InvalidOperationException("listener boom");
    }
}
