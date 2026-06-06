namespace TeslaSync.App.Core.Live;

/// <summary>
/// One SSE connection attempt's intent. <see cref="Path"/> is the API path WITHOUT the
/// <c>/api/v1</c> prefix (the transport adds it), mirroring the resilient HTTP client's contract.
/// <see cref="LastEventId"/> is forwarded as the <c>Last-Event-ID</c> request header so the server
/// can resume the stream after a reconnect; <see langword="null"/> on a fresh connection.
/// </summary>
public sealed record SseRequest(string Path, string? LastEventId);

/// <summary>
/// The transport seam <see cref="SseClient"/> streams through — the SSE analogue of the data
/// layer's HTTP client. Implementations open one connection per <see cref="OpenAsync"/> call and
/// yield the response body as raw UTF-8 text chunks (line boundaries need NOT align with chunk
/// boundaries; the client's <see cref="SseFrameParser"/> reassembles frames).
///
/// <para>The returned sequence:</para>
/// <list type="bullet">
///   <item>completes normally when the server closes the stream (the client reconnects);</item>
///   <item>throws to signal a transport failure (the client reconnects with backoff);</item>
///   <item>throws <see cref="SseUnauthorizedException"/> on a <c>401</c> so the client can refresh
///     the token and reconnect once before surfacing <see cref="LiveConnection.AuthRequired"/>;</item>
///   <item>is cancelled when the consumer cancels (the client closes the connection).</item>
/// </list>
///
/// <para>Production uses <see cref="HttpClientSseTransport"/>; tests inject a scripted fake so no
/// real network or wall-clock sleeping is involved.</para>
/// </summary>
public interface ISseTransport
{
    /// <summary>Opens a streaming connection for <paramref name="request"/>, yielding raw text chunks.</summary>
    IAsyncEnumerable<string> OpenAsync(SseRequest request, CancellationToken cancellationToken = default);
}
