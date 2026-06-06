using System.Net;
using TeslaSync.App.Core.Auth;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using Xunit;
using GeneratedApi = TeslaSync.Windows.Generated.Api;

namespace TeslaSync.App.Tests.Data;

/// <summary>
/// Verifies the full request pipeline (resilience → auth → socket): a 401 triggers a
/// single token refresh in the W4 auth handler, the request is replayed with the new
/// bearer, and the refreshed value propagates back through the generated client. Also
/// confirms the bearer token is attached and never leaks into the URL.
/// </summary>
public sealed class AuthRetryPropagationTests
{
    private static GeneratedApiClient Build(FakeHttpMessageHandler inner, ITokenProvider tokens)
    {
        var auth = new AuthHttpHandler(tokens, inner);
        var resilience = new ResilienceHandler(RetryPolicy.Default, new CircuitBreaker(), (_, _) => Task.CompletedTask)
        {
            InnerHandler = auth,
        };
        var http = new HttpClient(resilience) { BaseAddress = new Uri("https://teslasync.local") };
        return new GeneratedApiClient(http, new ApiClientOptions { BaseAddress = http.BaseAddress });
    }

    [Fact]
    public async Task Refreshes_once_on_401_and_replays_with_new_token()
    {
        var inner = new FakeHttpMessageHandler();
        inner.EnqueueStatus(HttpStatusCode.Unauthorized);
        inner.EnqueueJson(HttpStatusCode.OK,
            """{"created_at":"2024-01-01T00:00:00Z","drive_id":1,"id":2,"include_map":true,"include_speed":true,"include_telemetry":false,"token":"abc","views":0}""");
        var tokens = new FakeTokenProvider("stale-token", refreshedToken: "fresh-token");

        var client = Build(inner, tokens);
        var share = await client.SendAsync<GeneratedApi.ShareToken>(
            ApiRequest.WithPath("get_api_v1_share_token", "token", "abc"));

        Assert.Equal("abc", share.Token);
        Assert.Equal(1, tokens.RefreshCount);
        Assert.Equal(2, inner.SendCount);
        Assert.Equal("Bearer stale-token", inner.AuthorizationHeaders[0]);
        Assert.Equal("Bearer fresh-token", inner.AuthorizationHeaders[1]);
        Assert.DoesNotContain("token", inner.Requests[0].Query, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Failed_refresh_surfaces_the_401_as_unauthorized()
    {
        var inner = new FakeHttpMessageHandler();
        inner.EnqueueStatus(HttpStatusCode.Unauthorized);
        var tokens = new FakeTokenProvider("stale-token");

        var client = Build(inner, tokens);
        var ex = await Assert.ThrowsAsync<ApiException>(async () =>
            await client.SendAsync<GeneratedApi.ShareToken>(
                ApiRequest.WithPath("get_api_v1_share_token", "token", "abc")));

        Assert.Equal(401, ex.StatusCode);
        Assert.Equal(RepositoryErrorKind.Unauthorized, ApiErrorMapper.Map(ex).Kind);
    }
}
