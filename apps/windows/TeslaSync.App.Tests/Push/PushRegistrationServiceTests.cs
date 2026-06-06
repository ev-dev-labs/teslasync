using TeslaSync.App.Core.Push;
using Xunit;

namespace TeslaSync.App.Tests.Push;

/// <summary>
/// Verifies the headless <see cref="PushRegistrationService"/> with a fake WNS channel provider and a
/// fake <c>/api/v1/devices</c> client: registration, the device-registration payload mapping, channel
/// renewal (skip vs re-register), sign-out cleanup, revoke-failure handling, auth-driven transitions,
/// and that no channel URI is ever persisted locally.
/// </summary>
public sealed class PushRegistrationServiceTests
{
    private const string ChannelA = "https://db5.notify.windows.com/?token=AAA";
    private const string ChannelB = "https://db5.notify.windows.com/?token=BBB";

    private sealed class MutableClock
    {
        public DateTimeOffset Now = new(2026, 6, 1, 0, 0, 0, TimeSpan.Zero);

        public DateTimeOffset Get() => Now;
    }

    private static (PushRegistrationService Service, FakePushChannelProvider Provider, FakeDeviceRegistrationClient Client, InMemoryPushRegistrationStore Store, MutableClock Clock) Build(
        TimeSpan? renewBefore = null)
    {
        var provider = new FakePushChannelProvider();
        var client = new FakeDeviceRegistrationClient();
        var store = new InMemoryPushRegistrationStore();
        var environment = new StaticPushEnvironment("1.2.3.0", "en-US", "device-xyz");
        var diagnostics = new PushDiagnostics();
        var clock = new MutableClock();
        var options = new PushRegistrationOptions { RenewBeforeExpiry = renewBefore ?? TimeSpan.FromDays(3) };
        var service = new PushRegistrationService(provider, client, store, environment, diagnostics, options, clock.Get);
        return (service, provider, client, store, clock);
    }

    [Fact]
    public async Task RegisterAsync_registers_and_maps_the_device_payload()
    {
        var (service, provider, client, store, clock) = Build();
        var expiry = clock.Now.AddDays(30);
        provider.EnqueueChannel(ChannelA, expiry);

        var state = await service.RegisterAsync();

        var registered = Assert.IsType<PushRegistrationState.Registered>(state);
        Assert.Equal("reg-1", registered.RegistrationId);

        var request = Assert.Single(client.Registrations);
        Assert.Equal(PushCapabilities.WindowsPlatform, request.Platform);
        Assert.Equal(PushCapabilities.WnsProvider, request.PushProvider);
        Assert.Equal(ChannelA, request.ChannelUri);
        Assert.Equal("1.2.3.0", request.AppVersion);
        Assert.Equal("en-US", request.Locale);
        Assert.Equal("device-xyz", request.DeviceId);
        Assert.Equal(expiry, request.ChannelExpiresAt);
        Assert.Contains(PushCapabilities.Toast, request.Capabilities);

        var record = await store.LoadAsync();
        Assert.NotNull(record);
        Assert.Equal("reg-1", record!.RegistrationId);
    }

    [Fact]
    public async Task RegisterAsync_persists_a_fingerprint_never_the_channel_uri()
    {
        var (service, provider, _, store, clock) = Build();
        provider.EnqueueChannel(ChannelA, clock.Now.AddDays(30));

        await service.RegisterAsync();
        var record = await store.LoadAsync();

        Assert.NotNull(record);
        Assert.Equal(PushRedaction.Fingerprint(ChannelA), record!.ChannelFingerprint);
        Assert.DoesNotContain("token", record.ChannelFingerprint, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(ChannelA, record.ChannelFingerprint, StringComparison.Ordinal);
    }

    [Fact]
    public async Task RegisterAsync_channel_unavailable_parks_in_failed()
    {
        var (service, provider, client, store, _) = Build();
        provider.EnqueueUnavailable();

        var state = await service.RegisterAsync();

        var failed = Assert.IsType<PushRegistrationState.Failed>(state);
        Assert.Equal("channel_unavailable", failed.Reason);
        Assert.Empty(client.Registrations);
        Assert.Null(await store.LoadAsync());
    }

    [Fact]
    public async Task RegisterAsync_backend_rejection_parks_in_failed_without_persisting()
    {
        var (service, provider, client, store, clock) = Build();
        provider.EnqueueChannel(ChannelA, clock.Now.AddDays(30));
        client.FailRegister = true;

        var state = await service.RegisterAsync();

        var failed = Assert.IsType<PushRegistrationState.Failed>(state);
        Assert.Equal("register_rejected", failed.Reason);
        Assert.Null(await store.LoadAsync());
    }

    [Fact]
    public async Task RenewAsync_with_unchanged_channel_skips_the_backend()
    {
        var (service, provider, client, _, clock) = Build();
        provider.EnqueueChannel(ChannelA, clock.Now.AddDays(30));
        provider.EnqueueChannel(ChannelA, clock.Now.AddDays(30));
        await service.RegisterAsync();

        var state = await service.RenewAsync();

        Assert.IsType<PushRegistrationState.Registered>(state);
        Assert.Single(client.Registrations); // no second registration round-trip
    }

    [Fact]
    public async Task RenewAsync_with_changed_channel_reregisters()
    {
        var (service, provider, client, store, clock) = Build();
        provider.EnqueueChannel(ChannelA, clock.Now.AddDays(30));
        provider.EnqueueChannel(ChannelB, clock.Now.AddDays(30));
        await service.RegisterAsync();

        await service.RenewAsync();

        Assert.Equal(2, client.Registrations.Count);
        Assert.Equal(ChannelB, client.Registrations[1].ChannelUri);
        var record = await store.LoadAsync();
        Assert.Equal(PushRedaction.Fingerprint(ChannelB), record!.ChannelFingerprint);
    }

    [Fact]
    public async Task RenewAsync_reregisters_when_channel_is_near_expiry()
    {
        var (service, provider, client, _, clock) = Build(renewBefore: TimeSpan.FromDays(3));
        provider.EnqueueChannel(ChannelA, clock.Now.AddDays(2)); // already inside the renewal window
        provider.EnqueueChannel(ChannelA, clock.Now.AddDays(2));
        await service.RegisterAsync();

        await service.RenewAsync();

        Assert.Equal(2, client.Registrations.Count);
    }

    [Fact]
    public async Task UnregisterAsync_revokes_closes_and_clears()
    {
        var (service, provider, client, store, clock) = Build();
        provider.EnqueueChannel(ChannelA, clock.Now.AddDays(30));
        await service.RegisterAsync();

        await service.UnregisterAsync();

        Assert.Equal("reg-1", Assert.Single(client.Unregistrations));
        Assert.Equal(1, provider.CloseCount);
        Assert.Null(await store.LoadAsync());
        Assert.IsType<PushRegistrationState.Unregistered>(service.State);
    }

    [Fact]
    public async Task UnregisterAsync_still_clears_locally_when_revoke_fails()
    {
        var (service, provider, client, store, clock) = Build();
        provider.EnqueueChannel(ChannelA, clock.Now.AddDays(30));
        await service.RegisterAsync();
        client.FailUnregister = true;

        await service.UnregisterAsync();

        Assert.Equal(1, provider.CloseCount);
        Assert.Null(await store.LoadAsync());
        Assert.IsType<PushRegistrationState.Unregistered>(service.State);
    }

    [Fact]
    public async Task OnAuthChangedAsync_registers_on_sign_in_and_unregisters_on_sign_out()
    {
        var (service, provider, client, store, clock) = Build();
        provider.EnqueueChannel(ChannelA, clock.Now.AddDays(30)); // sign-in renew
        provider.EnqueueChannel(ChannelA, clock.Now.AddDays(30)); // unused safety

        await service.OnAuthChangedAsync(signedIn: true);
        Assert.IsType<PushRegistrationState.Registered>(service.State);
        Assert.Single(client.Registrations);

        await service.OnAuthChangedAsync(signedIn: false);
        Assert.IsType<PushRegistrationState.Unregistered>(service.State);
        Assert.Single(client.Unregistrations);
        Assert.Null(await store.LoadAsync());
    }

    [Fact]
    public async Task StateChanged_is_raised_through_the_registration_lifecycle()
    {
        var (service, provider, _, _, clock) = Build();
        provider.EnqueueChannel(ChannelA, clock.Now.AddDays(30));
        var states = new List<PushRegistrationState>();
        service.StateChanged += (_, s) => states.Add(s);

        await service.RegisterAsync();

        Assert.Contains(states, s => s is PushRegistrationState.Registering);
        Assert.Contains(states, s => s is PushRegistrationState.Registered);
    }
}
