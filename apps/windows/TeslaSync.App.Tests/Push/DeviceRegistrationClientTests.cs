using System.Net;
using System.Text.Json;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Push;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.Push;

/// <summary>
/// Verifies the <see cref="DeviceRegistrationClient"/> against a fake transport: it POSTs the
/// snake_case device payload to <c>/api/v1/devices</c> with the version segment applied exactly once,
/// DELETEs by registration id, treats a <c>404</c> unregister as success, and surfaces error statuses
/// as <see cref="ApiException"/>.
/// </summary>
public sealed class DeviceRegistrationClientTests
{
    private static DeviceRegistrationRequest SampleRequest() => new(
        PushCapabilities.WindowsPlatform,
        PushCapabilities.WnsProvider,
        "https://db5.notify.windows.com/?token=AAA",
        "1.2.3.0",
        "en-US",
        "device-xyz",
        PushCapabilities.WindowsDefault,
        new DateTimeOffset(2026, 7, 1, 0, 0, 0, TimeSpan.Zero));

    private static (DeviceRegistrationClient Client, FakeHttpMessageHandler Handler) Build()
    {
        var handler = new FakeHttpMessageHandler();
        var http = new HttpClient(handler) { BaseAddress = new Uri("https://teslasync.local") };
        var options = new ApiClientOptions { BaseAddress = http.BaseAddress };
        return (new DeviceRegistrationClient(http, options), handler);
    }

    [Fact]
    public async Task RegisterAsync_posts_snake_case_payload_to_versioned_devices_route()
    {
        var (client, handler) = Build();
        string? body = null;
        HttpMethod? method = null;
        handler.Enqueue(request =>
        {
            method = request.Method;
            body = request.Content!.ReadAsStringAsync().GetAwaiter().GetResult();
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent("""{"id":"reg-99"}""", System.Text.Encoding.UTF8, "application/json"),
            };
        });

        var response = await client.RegisterAsync(SampleRequest());

        Assert.Equal("reg-99", response.RegistrationId);
        Assert.Equal(HttpMethod.Post, method);
        Assert.Equal("/api/v1/devices", handler.Requests[0].AbsolutePath);
        Assert.DoesNotContain("/api/v1/api/v1", handler.Requests[0].AbsolutePath, StringComparison.Ordinal);

        Assert.NotNull(body);
        using var doc = JsonDocument.Parse(body!);
        var root = doc.RootElement;
        Assert.Equal("windows", root.GetProperty("platform").GetString());
        Assert.Equal("wns", root.GetProperty("push_provider").GetString());
        Assert.Equal("https://db5.notify.windows.com/?token=AAA", root.GetProperty("channel_uri").GetString());
        Assert.Equal("1.2.3.0", root.GetProperty("app_version").GetString());
        Assert.Equal("device-xyz", root.GetProperty("device_id").GetString());
        Assert.True(root.TryGetProperty("channel_expires_at", out _));
    }

    [Fact]
    public async Task UnregisterAsync_deletes_by_registration_id()
    {
        var (client, handler) = Build();
        handler.EnqueueStatus(HttpStatusCode.NoContent);

        await client.UnregisterAsync("reg-99");

        Assert.Equal("/api/v1/devices/reg-99", handler.Requests[0].AbsolutePath);
    }

    [Fact]
    public async Task UnregisterAsync_treats_404_as_success()
    {
        var (client, handler) = Build();
        handler.EnqueueStatus(HttpStatusCode.NotFound);

        var ex = await Record.ExceptionAsync(() => client.UnregisterAsync("missing"));

        Assert.Null(ex);
    }

    [Fact]
    public async Task RegisterAsync_surfaces_error_status_as_ApiException()
    {
        var (client, handler) = Build();
        handler.EnqueueJson(HttpStatusCode.InternalServerError, """{"code":"boom","message":"nope"}""");

        var ex = await Assert.ThrowsAsync<ApiException>(() => client.RegisterAsync(SampleRequest()));

        Assert.Equal(500, ex.StatusCode);
        Assert.Equal("boom", ex.ErrorCode);
    }
}
