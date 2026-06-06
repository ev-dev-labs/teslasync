using System.Net;
using TeslaSync.App.Core.Auth;
using Xunit;

namespace TeslaSync.App.Tests.Auth;

public sealed class AuthHttpHandlerTests
{
    [Fact]
    public async Task AttachesTheBearerTokenToOutgoingRequests()
    {
        var provider = new StubTokenProvider("token-1");
        var inner = new SequenceHandler(HttpStatusCode.OK);
        using var client = new HttpClient(new AuthHttpHandler(provider, inner));

        using var response = await client.GetAsync(new Uri("https://api.test/api/v1/vehicles"));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("Bearer token-1", inner.Requests[0].Headers.Authorization?.ToString());
    }

    [Fact]
    public async Task RefreshesAndRetriesOnceAfter401()
    {
        var provider = new StubTokenProvider("token-1") { RefreshedToken = "token-2", RefreshSucceeds = true };
        var inner = new SequenceHandler(HttpStatusCode.Unauthorized, HttpStatusCode.OK);
        using var client = new HttpClient(new AuthHttpHandler(provider, inner));

        using var response = await client.GetAsync(new Uri("https://api.test/api/v1/vehicles"));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(2, inner.Requests.Count);
        Assert.Equal("Bearer token-1", inner.Requests[0].Headers.Authorization?.ToString());
        Assert.Equal("Bearer token-2", inner.Requests[1].Headers.Authorization?.ToString());
        Assert.Equal(1, provider.UnauthorizedCalls);
    }

    [Fact]
    public async Task DoesNotRetryWhenRefreshFails()
    {
        var provider = new StubTokenProvider("token-1") { RefreshSucceeds = false };
        var inner = new SequenceHandler(HttpStatusCode.Unauthorized, HttpStatusCode.OK);
        using var client = new HttpClient(new AuthHttpHandler(provider, inner));

        using var response = await client.GetAsync(new Uri("https://api.test/api/v1/vehicles"));

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Single(inner.Requests);
    }

    [Fact]
    public async Task RetriesOnlyOnceWhenStillUnauthorized()
    {
        var provider = new StubTokenProvider("token-1") { RefreshedToken = "token-2", RefreshSucceeds = true };
        var inner = new SequenceHandler(HttpStatusCode.Unauthorized, HttpStatusCode.Unauthorized);
        using var client = new HttpClient(new AuthHttpHandler(provider, inner));

        using var response = await client.GetAsync(new Uri("https://api.test/api/v1/vehicles"));

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Equal(2, inner.Requests.Count);
    }

    private sealed class StubTokenProvider : ITokenProvider
    {
        private string _token;

        public StubTokenProvider(string token) => _token = token;

        public string? RefreshedToken { get; set; }

        public bool RefreshSucceeds { get; set; }

        public int UnauthorizedCalls { get; private set; }

        public Task<string?> GetTokenAsync(CancellationToken cancellationToken = default) =>
            Task.FromResult<string?>(_token);

        public Task<bool> OnUnauthorizedAsync(string? failedToken, CancellationToken cancellationToken = default)
        {
            UnauthorizedCalls++;
            if (RefreshSucceeds && RefreshedToken is not null)
            {
                _token = RefreshedToken;
                return Task.FromResult(true);
            }

            return Task.FromResult(false);
        }
    }

    private sealed class SequenceHandler : HttpMessageHandler
    {
        private readonly Queue<HttpStatusCode> _statuses;

        public SequenceHandler(params HttpStatusCode[] statuses) => _statuses = new Queue<HttpStatusCode>(statuses);

        public List<HttpRequestMessage> Requests { get; } = [];

        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            Requests.Add(request);
            var status = _statuses.Count > 0 ? _statuses.Dequeue() : HttpStatusCode.OK;
            return Task.FromResult(new HttpResponseMessage(status));
        }
    }
}
