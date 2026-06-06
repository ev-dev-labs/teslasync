using System.Net;

namespace TeslaSync.App.Tests.Data;

/// <summary>
/// A scriptable <see cref="HttpMessageHandler"/> for the data-layer tests. Each queued
/// responder is invoked once per request in order; the handler records every request URI
/// and Authorization header so tests can assert on URL shape and auth attachment.
/// </summary>
internal sealed class FakeHttpMessageHandler : HttpMessageHandler
{
    private readonly Queue<Func<HttpRequestMessage, HttpResponseMessage>> _responders = new();

    public List<Uri> Requests { get; } = new();

    public List<string?> AuthorizationHeaders { get; } = new();

    public int SendCount { get; private set; }

    public FakeHttpMessageHandler Enqueue(Func<HttpRequestMessage, HttpResponseMessage> responder)
    {
        _responders.Enqueue(responder);
        return this;
    }

    public FakeHttpMessageHandler EnqueueJson(HttpStatusCode status, string json)
        => Enqueue(_ => new HttpResponseMessage(status)
        {
            Content = new StringContent(json, System.Text.Encoding.UTF8, "application/json"),
        });

    public FakeHttpMessageHandler EnqueueStatus(HttpStatusCode status)
        => Enqueue(_ => new HttpResponseMessage(status));

    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        SendCount++;
        Requests.Add(request.RequestUri!);
        AuthorizationHeaders.Add(request.Headers.Authorization?.ToString());

        if (_responders.Count == 0)
        {
            throw new InvalidOperationException("FakeHttpMessageHandler received an unexpected request.");
        }

        var responder = _responders.Dequeue();
        return Task.FromResult(responder(request));
    }
}
