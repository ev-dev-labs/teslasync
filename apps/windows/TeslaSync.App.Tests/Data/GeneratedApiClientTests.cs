using System.Net;
using TeslaSync.App.Core.Data.Net;
using Xunit;
using GeneratedApi = TeslaSync.Windows.Generated.Api;

namespace TeslaSync.App.Tests.Data;

/// <summary>
/// Verifies the generated-contract client: it deserializes typed DTOs, applies the
/// <c>/api/v1</c> version segment exactly once, fills path parameters, appends
/// snake_case query parameters, rejects undeclared query keys, and surfaces server
/// errors (with the structured code) as <see cref="ApiException"/>.
/// </summary>
public sealed class GeneratedApiClientTests
{
    private static (GeneratedApiClient Client, FakeHttpMessageHandler Handler) Build()
    {
        var handler = new FakeHttpMessageHandler();
        var http = new HttpClient(handler) { BaseAddress = new Uri("https://teslasync.local") };
        var options = new ApiClientOptions { BaseAddress = http.BaseAddress };
        return (new GeneratedApiClient(http, options), handler);
    }

    [Fact]
    public async Task Deserializes_typed_list_and_applies_version_prefix_once()
    {
        var (client, handler) = Build();
        handler.EnqueueJson(HttpStatusCode.OK,
            """[{"created_at":"2024-01-01T00:00:00Z","display_name":"Car","enrolled_at":"2024-01-01T00:00:00Z","id":7,"tesla_id":99,"timezone":"UTC","updated_at":"2024-01-01T00:00:00Z","vin":"VIN7"}]""");

        var vehicles = await client.SendAsync<List<GeneratedApi.Vehicle>>(new ApiRequest("get_api_v1_vehicles"));

        Assert.Single(vehicles);
        Assert.Equal(7, vehicles[0].Id);
        var path = handler.Requests[0].AbsolutePath;
        Assert.Equal("/api/v1/vehicles/", path);
        Assert.DoesNotContain("/api/v1/api/v1", path, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Fills_path_parameters()
    {
        var (client, handler) = Build();
        handler.EnqueueJson(HttpStatusCode.OK, "{}");

        await client.SendAsync<System.Text.Json.JsonElement>(
            ApiRequest.WithPath("get_api_v1_vehicles_vehicleID_state", "vehicleID", "42"));

        Assert.Equal("/api/v1/vehicles/42/state", handler.Requests[0].AbsolutePath);
    }

    [Fact]
    public async Task Appends_snake_case_query_parameters()
    {
        var (client, handler) = Build();
        handler.EnqueueJson(HttpStatusCode.OK, "[]");

        await client.SendAsync<List<GeneratedApi.Drive>>(
            ApiRequest.WithQuery("get_api_v1_drives", "vehicle_id", 5));

        Assert.Contains("vehicle_id=5", handler.Requests[0].Query, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Rejects_undeclared_query_key()
    {
        var (client, _) = Build();

        await Assert.ThrowsAsync<ApiException>(async () =>
            await client.SendAsync<List<GeneratedApi.Drive>>(
                ApiRequest.WithQuery("get_api_v1_drives", "vehicleId", 5)));
    }

    [Fact]
    public async Task Maps_error_body_to_api_exception_with_code()
    {
        var (client, handler) = Build();
        handler.EnqueueJson(HttpStatusCode.NotFound, """{"error":"missing","code":"NOT_FOUND"}""");

        var ex = await Assert.ThrowsAsync<ApiException>(async () =>
            await client.SendAsync<GeneratedApi.VehicleState>(
                ApiRequest.WithPath("get_api_v1_vehicles_vehicleID_state", "vehicleID", "1")));

        Assert.Equal(404, ex.StatusCode);
        Assert.Equal("NOT_FOUND", ex.ErrorCode);
    }

    [Fact]
    public async Task Unknown_operation_throws()
    {
        var (client, _) = Build();
        await Assert.ThrowsAsync<ApiException>(async () =>
            await client.SendAsync<System.Text.Json.JsonElement>(new ApiRequest("get_api_v1_not_a_real_operation")));
    }
}
