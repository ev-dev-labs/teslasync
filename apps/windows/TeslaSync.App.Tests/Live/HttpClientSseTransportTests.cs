using System.Net;
using System.Text;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Live;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.Live;

/// <summary>
/// Verifies the production <see cref="HttpClientSseTransport"/>: it requests
/// <c>text/event-stream</c> at the versioned path, attaches the bearer token, forwards
/// <c>Last-Event-ID</c> for resume, streams the response body as chunks, and maps a <c>401</c> to
/// <see cref="SseUnauthorizedException"/> (and other failures to a thrown error).
/// </summary>
public sealed class HttpClientSseTransportTests
{
    private static readonly ApiClientOptions Options = new()
    {
        BaseAddress = new Uri("https://teslasync.test", UriKind.Absolute),
        VersionBasePath = "/api/v1",
    };

    [Fact]
    public async Task Requests_event_stream_at_the_versioned_path_with_bearer_and_resume_header()
    {
        HttpRequestMessage? captured = null;
        var handler = new RecordingHandler(
            request =>
            {
                captured = request;
                return EventStream("event: heartbeat\ndata: {}\n\n");
            });
        var transport = new HttpClientSseTransport(new HttpClient(handler), Options, new FakeTokenProvider("tok-123"));

        await DrainAsync(transport, new SseRequest("/events", "evt-42"));

        Assert.NotNull(captured);
        Assert.Equal("https://teslasync.test/api/v1/events", captured!.RequestUri!.ToString());
        Assert.Contains(captured.Headers.Accept, h => h.MediaType == "text/event-stream");
        Assert.Equal("Bearer", captured.Headers.Authorization!.Scheme);
        Assert.Equal("tok-123", captured.Headers.Authorization.Parameter);
        Assert.True(captured.Headers.TryGetValues("Last-Event-ID", out var ids));
        Assert.Equal("evt-42", Assert.Single(ids));
    }

    [Fact]
    public async Task Omits_authorization_when_no_token_is_available()
    {
        HttpRequestMessage? captured = null;
        var handler = new RecordingHandler(
            request =>
            {
                captured = request;
                return EventStream(": keep-alive\n");
            });
        var transport = new HttpClientSseTransport(new HttpClient(handler), Options, new FakeTokenProvider(null));

        await DrainAsync(transport, new SseRequest("/events", null));

        Assert.Null(captured!.Headers.Authorization);
        Assert.False(captured.Headers.Contains("Last-Event-ID"));
    }

    [Fact]
    public async Task Streams_the_response_body_as_line_chunks()
    {
        var handler = new RecordingHandler(_ => EventStream("event: connected\ndata: {\"client_id\":\"c1\"}\n\n"));
        var transport = new HttpClientSseTransport(new HttpClient(handler), Options, new FakeTokenProvider("tok"));

        var chunks = await DrainAsync(transport, new SseRequest("/events", null));

        var joined = string.Concat(chunks);
        Assert.Contains("event: connected", joined, StringComparison.Ordinal);
        Assert.Contains("\"client_id\":\"c1\"", joined, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Maps_401_to_unauthorized_exception()
    {
        var handler = new RecordingHandler(_ => new HttpResponseMessage(HttpStatusCode.Unauthorized));
        var transport = new HttpClientSseTransport(new HttpClient(handler), Options, new FakeTokenProvider("tok"));

        await Assert.ThrowsAsync<SseUnauthorizedException>(() => DrainAsync(transport, new SseRequest("/events", null)));
    }

    [Fact]
    public async Task Non_success_status_throws()
    {
        var handler = new RecordingHandler(_ => new HttpResponseMessage(HttpStatusCode.ServiceUnavailable));
        var transport = new HttpClientSseTransport(new HttpClient(handler), Options, new FakeTokenProvider("tok"));

        await Assert.ThrowsAsync<HttpRequestException>(() => DrainAsync(transport, new SseRequest("/events", null)));
    }

    private static HttpResponseMessage EventStream(string body) => new(HttpStatusCode.OK)
    {
        Content = new StringContent(body, Encoding.UTF8, "text/event-stream"),
    };

    private static async Task<List<string>> DrainAsync(HttpClientSseTransport transport, SseRequest request)
    {
        var chunks = new List<string>();
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        await foreach (var chunk in transport.OpenAsync(request, cts.Token).ConfigureAwait(false))
        {
            chunks.Add(chunk);
        }

        return chunks;
    }

    private sealed class RecordingHandler : HttpMessageHandler
    {
        private readonly Func<HttpRequestMessage, HttpResponseMessage> _responder;

        public RecordingHandler(Func<HttpRequestMessage, HttpResponseMessage> responder) => _responder = responder;

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
            Task.FromResult(_responder(request));
    }
}
