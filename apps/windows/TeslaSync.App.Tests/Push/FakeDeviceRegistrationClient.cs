using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Push;

namespace TeslaSync.App.Tests.Push;

/// <summary>
/// A fake <see cref="IDeviceRegistrationClient"/> that records register/unregister calls and can be
/// scripted to fail, standing in for the (not-yet-generated) <c>/api/v1/devices</c> contract.
/// </summary>
internal sealed class FakeDeviceRegistrationClient : IDeviceRegistrationClient
{
    public List<DeviceRegistrationRequest> Registrations { get; } = new();

    public List<string> Unregistrations { get; } = new();

    public string RegistrationId { get; set; } = "reg-1";

    public bool FailRegister { get; set; }

    public bool FailUnregister { get; set; }

    public Task<DeviceRegistrationResponse> RegisterAsync(
        DeviceRegistrationRequest request,
        CancellationToken cancellationToken = default)
    {
        Registrations.Add(request);
        if (FailRegister)
        {
            throw new ApiException("register rejected", 500);
        }

        return Task.FromResult(new DeviceRegistrationResponse(
            RegistrationId,
            request.Platform,
            DateTimeOffset.UnixEpoch,
            request.ChannelExpiresAt));
    }

    public Task UnregisterAsync(string registrationId, CancellationToken cancellationToken = default)
    {
        Unregistrations.Add(registrationId);
        if (FailUnregister)
        {
            throw new ApiException("unregister rejected", 500);
        }

        return Task.CompletedTask;
    }
}

/// <summary>An <see cref="IToastService"/> that records the toasts it was asked to present.</summary>
internal sealed class RecordingToastService : IToastService
{
    public List<PushToast> Shown { get; } = new();

    public Task ShowAsync(PushToast toast, CancellationToken cancellationToken = default)
    {
        Shown.Add(toast);
        return Task.CompletedTask;
    }
}

/// <summary>An <see cref="IPushBannerSink"/> that records the banners it was asked to publish.</summary>
internal sealed class RecordingBannerSink : IPushBannerSink
{
    public List<PushBanner> Published { get; } = new();

    public void Publish(PushBanner banner) => Published.Add(banner);
}
