using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;

namespace TeslaSync.App.UITests.Fixtures;

/// <summary>
/// The deterministic, in-process fake TeslaSync API the UI suite points the app at. It binds a raw
/// loopback <see cref="TcpListener"/> (no <see cref="HttpListener"/> URL-ACL / elevation needed) and
/// speaks just enough HTTP/1.1 to serve seeded JSON, a fake OIDC token exchange, and a never-ending
/// SSE stream. Responses are selected by a requested <see cref="ServerState"/> (success / empty /
/// error / slow-loading / offline / live-stale) supplied via the <c>?state=</c> query or the
/// <c>X-Test-State</c> header, so every page state can be driven without a real backend. Because it
/// only ever listens on <c>127.0.0.1</c>, the suite can never reach the production TeslaSync or Tesla
/// APIs. Every request is recorded for assertions.
/// </summary>
public sealed class FakeApiServer : IDisposable
{
    private readonly TcpListener _listener;
    private readonly CancellationTokenSource _cts = new();
    private readonly List<string> _requests = [];
    private readonly object _sync = new();
    private readonly string _dataDirectory;
    private Task? _loop;

    /// <summary>Create a fake server bound to an ephemeral loopback port.</summary>
    public FakeApiServer()
    {
        _listener = new TcpListener(IPAddress.Loopback, 0);
        _dataDirectory = Path.Combine(AppContext.BaseDirectory, "Fixtures", "Data");
    }

    /// <summary>The base URL the app should use for the TeslaSync API (loopback, ephemeral port).</summary>
    public string BaseUrl { get; private set; } = string.Empty;

    /// <summary>A snapshot of every request line the server has handled.</summary>
    public IReadOnlyList<string> Requests
    {
        get { lock (_sync) { return _requests.ToArray(); } }
    }

    /// <summary>Start listening and begin accepting connections on a background loop.</summary>
    public void Start()
    {
        _listener.Start();
        var port = ((IPEndPoint)_listener.LocalEndpoint).Port;
        BaseUrl = $"http://127.0.0.1:{port}";
        _loop = Task.Run(() => AcceptLoopAsync(_cts.Token));
    }

    /// <summary>True when the server recorded at least one request to <paramref name="pathFragment"/>.</summary>
    public bool Received(string pathFragment)
    {
        lock (_sync)
        {
            return _requests.Any(r => r.Contains(pathFragment, StringComparison.OrdinalIgnoreCase));
        }
    }

    /// <inheritdoc />
    public void Dispose()
    {
        try
        {
            _cts.Cancel();
            _listener.Stop();
            _loop?.Wait(2000);
        }
        catch (Exception ex) when (ex is AggregateException or SocketException or ObjectDisposedException)
        {
            // Shutdown is best-effort.
        }
        finally
        {
            _cts.Dispose();
        }
    }

    private async Task AcceptLoopAsync(CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            TcpClient client;
            try
            {
                client = await _listener.AcceptTcpClientAsync(cancellationToken).ConfigureAwait(false);
            }
            catch (Exception ex) when (ex is OperationCanceledException or ObjectDisposedException or SocketException)
            {
                return;
            }

            _ = Task.Run(() => HandleClientAsync(client, cancellationToken), cancellationToken);
        }
    }

    private async Task HandleClientAsync(TcpClient client, CancellationToken cancellationToken)
    {
        using (client)
        {
            try
            {
                using var stream = client.GetStream();
                var request = await ReadRequestAsync(stream, cancellationToken).ConfigureAwait(false);
                if (request is null)
                {
                    return;
                }

                lock (_sync)
                {
                    _requests.Add($"{request.Method} {request.Path}");
                }

                await RouteAsync(stream, request, cancellationToken).ConfigureAwait(false);
            }
            catch (Exception ex) when (ex is IOException or OperationCanceledException or SocketException)
            {
                // A dropped connection is expected during teardown.
            }
        }
    }

    private async Task RouteAsync(NetworkStream stream, FakeRequest request, CancellationToken cancellationToken)
    {
        var state = ResolveState(request);

        if (request.Path.StartsWith("/oauth/token", StringComparison.OrdinalIgnoreCase) ||
            request.Path.StartsWith("/token", StringComparison.OrdinalIgnoreCase))
        {
            await WriteTokenAsync(stream, state, cancellationToken).ConfigureAwait(false);
            return;
        }

        if (request.Path.StartsWith("/oauth/authorize", StringComparison.OrdinalIgnoreCase))
        {
            // Fake the redirect back to the app's custom-scheme callback with an auth code.
            await WriteAsync(stream, 302, "text/plain", "redirecting",
                extraHeaders: "Location: teslasync://oauth/callback?code=fixture-code&state=fixture-state\r\n",
                cancellationToken).ConfigureAwait(false);
            return;
        }

        if (request.Path.Contains("/stream", StringComparison.OrdinalIgnoreCase) ||
            request.Path.Contains("/live", StringComparison.OrdinalIgnoreCase))
        {
            await WriteSseAsync(stream, state, cancellationToken).ConfigureAwait(false);
            return;
        }

        if (state == ServerState.Error)
        {
            await WriteJsonAsync(stream, 503, "{\"error\":\"fixture induced failure\",\"code\":\"FIXTURE_ERROR\"}",
                cancellationToken).ConfigureAwait(false);
            return;
        }

        if (state == ServerState.Offline)
        {
            // Drop the connection without a response to emulate an unreachable backend / offline state.
            return;
        }

        if (state == ServerState.Loading)
        {
            await Task.Delay(TimeSpan.FromMilliseconds(1500), cancellationToken).ConfigureAwait(false);
        }

        await WriteJsonAsync(stream, 200, BuildBody(request, state), cancellationToken).ConfigureAwait(false);
    }

    private string BuildBody(FakeRequest request, ServerState state)
    {
        if (request.Path.StartsWith("/healthz", StringComparison.OrdinalIgnoreCase) ||
            request.Path.Contains("/system/health", StringComparison.OrdinalIgnoreCase))
        {
            return "{\"status\":\"ok\",\"fixture\":true}";
        }

        if (request.Path.Contains("/vehicles", StringComparison.OrdinalIgnoreCase))
        {
            if (state == ServerState.Empty)
            {
                return "{\"vehicles\":[]}";
            }

            var seeded = ReadSeed("vehicles.json");
            if (seeded is not null)
            {
                return state == ServerState.Stale ? StampStale(seeded) : seeded;
            }
        }

        // A generic, deterministic envelope for every other route group endpoint.
        var generatedAt = state == ServerState.Stale
            ? DateTimeOffset.UnixEpoch.ToString("O")
            : DateTimeOffset.UtcNow.ToString("O");
        var items = state == ServerState.Empty ? "[]" : "[{\"id\":1,\"label\":\"fixture\"}]";
        return $"{{\"items\":{items},\"generated_at\":\"{generatedAt}\",\"fixture\":true}}";
    }

    private static string StampStale(string json)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement.Clone();
            using var buffer = new MemoryStream();
            using (var writer = new Utf8JsonWriter(buffer))
            {
                writer.WriteStartObject();
                foreach (var prop in root.EnumerateObject())
                {
                    prop.WriteTo(writer);
                }

                writer.WriteString("generated_at", DateTimeOffset.UnixEpoch.ToString("O"));
                writer.WriteBoolean("stale", true);
                writer.WriteEndObject();
            }

            return Encoding.UTF8.GetString(buffer.ToArray());
        }
        catch (JsonException)
        {
            return json;
        }
    }

    private string? ReadSeed(string fileName)
    {
        try
        {
            var path = Path.Combine(_dataDirectory, fileName);
            return File.Exists(path) ? File.ReadAllText(path) : null;
        }
        catch (IOException)
        {
            return null;
        }
    }

    private static async Task WriteTokenAsync(NetworkStream stream, ServerState state, CancellationToken cancellationToken)
    {
        if (state == ServerState.Error)
        {
            // Drives the token-refresh-failure / re-authentication path.
            await WriteJsonAsync(stream, 401,
                "{\"error\":\"invalid_grant\",\"error_description\":\"fixture refresh rejected\"}",
                cancellationToken).ConfigureAwait(false);
            return;
        }

        var body =
            "{\"access_token\":\"fixture-access-token\",\"refresh_token\":\"fixture-refresh-token\"," +
            "\"id_token\":\"fixture-id-token\",\"token_type\":\"Bearer\",\"expires_in\":3600}";
        await WriteJsonAsync(stream, 200, body, cancellationToken).ConfigureAwait(false);
    }

    private static async Task WriteSseAsync(NetworkStream stream, ServerState state, CancellationToken cancellationToken)
    {
        var stamp = state == ServerState.Stale
            ? DateTimeOffset.UnixEpoch.ToString("O")
            : DateTimeOffset.UtcNow.ToString("O");
        var payload =
            "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nCache-Control: no-cache\r\nConnection: close\r\n\r\n" +
            $"event: signal\r\ndata: {{\"name\":\"battery_level\",\"value\":72,\"at\":\"{stamp}\"}}\r\n\r\n";
        var bytes = Encoding.UTF8.GetBytes(payload);
        await stream.WriteAsync(bytes, cancellationToken).ConfigureAwait(false);
        await stream.FlushAsync(cancellationToken).ConfigureAwait(false);
    }

    private static ServerState ResolveState(FakeRequest request)
    {
        var value = request.Header("X-Test-State");
        if (string.IsNullOrEmpty(value))
        {
            value = request.Query("state");
        }

        return value?.ToLowerInvariant() switch
        {
            "empty" => ServerState.Empty,
            "error" => ServerState.Error,
            "loading" => ServerState.Loading,
            "offline" => ServerState.Offline,
            "stale" => ServerState.Stale,
            _ => ServerState.Success,
        };
    }

    private static Task WriteJsonAsync(NetworkStream stream, int status, string json, CancellationToken cancellationToken)
        => WriteAsync(stream, status, "application/json", json, extraHeaders: null, cancellationToken);

    private static async Task WriteAsync(
        NetworkStream stream, int status, string contentType, string body, string? extraHeaders, CancellationToken cancellationToken)
    {
        var bytes = Encoding.UTF8.GetBytes(body);
        var header = new StringBuilder()
            .Append("HTTP/1.1 ").Append(status).Append(' ').Append(ReasonPhrase(status)).Append("\r\n")
            .Append("Content-Type: ").Append(contentType).Append("\r\n")
            .Append("Content-Length: ").Append(bytes.Length).Append("\r\n")
            .Append("Access-Control-Allow-Origin: *\r\n")
            .Append("Connection: close\r\n");
        if (!string.IsNullOrEmpty(extraHeaders))
        {
            header.Append(extraHeaders);
        }

        header.Append("\r\n");

        var headerBytes = Encoding.ASCII.GetBytes(header.ToString());
        await stream.WriteAsync(headerBytes, cancellationToken).ConfigureAwait(false);
        await stream.WriteAsync(bytes, cancellationToken).ConfigureAwait(false);
        await stream.FlushAsync(cancellationToken).ConfigureAwait(false);
    }

    private static string ReasonPhrase(int status) => status switch
    {
        200 => "OK",
        302 => "Found",
        401 => "Unauthorized",
        503 => "Service Unavailable",
        _ => "OK",
    };

    private static async Task<FakeRequest?> ReadRequestAsync(NetworkStream stream, CancellationToken cancellationToken)
    {
        var buffer = new byte[8192];
        var received = new MemoryStream();
        int headerEnd = -1;

        while (headerEnd < 0)
        {
            var read = await stream.ReadAsync(buffer, cancellationToken).ConfigureAwait(false);
            if (read == 0)
            {
                break;
            }

            received.Write(buffer, 0, read);
            headerEnd = IndexOfDoubleCrlf(received.GetBuffer(), (int)received.Length);
            if (received.Length > 65536)
            {
                break;
            }
        }

        if (received.Length == 0)
        {
            return null;
        }

        var text = Encoding.ASCII.GetString(received.GetBuffer(), 0, (int)received.Length);
        var lines = text.Split("\r\n");
        var requestLine = lines.Length > 0 ? lines[0].Split(' ') : [];
        if (requestLine.Length < 2)
        {
            return null;
        }

        var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        for (var i = 1; i < lines.Length; i++)
        {
            if (lines[i].Length == 0)
            {
                break;
            }

            var split = lines[i].IndexOf(':');
            if (split > 0)
            {
                headers[lines[i][..split].Trim()] = lines[i][(split + 1)..].Trim();
            }
        }

        return new FakeRequest(requestLine[0], requestLine[1], headers);
    }

    private static int IndexOfDoubleCrlf(byte[] buffer, int length)
    {
        for (var i = 0; i + 3 < length; i++)
        {
            if (buffer[i] == '\r' && buffer[i + 1] == '\n' && buffer[i + 2] == '\r' && buffer[i + 3] == '\n')
            {
                return i;
            }
        }

        return -1;
    }

    /// <summary>The response shape a request asks the fake server to produce.</summary>
    private enum ServerState
    {
        Success,
        Empty,
        Error,
        Loading,
        Offline,
        Stale,
    }

    private sealed record FakeRequest(string Method, string RawTarget, IReadOnlyDictionary<string, string> Headers)
    {
        public string Path => RawTarget.Split('?', 2)[0];

        public string? Header(string name) => Headers.TryGetValue(name, out var v) ? v : null;

        public string? Query(string key)
        {
            var split = RawTarget.Split('?', 2);
            if (split.Length < 2)
            {
                return null;
            }

            foreach (var pair in split[1].Split('&', StringSplitOptions.RemoveEmptyEntries))
            {
                var kv = pair.Split('=', 2);
                if (kv.Length == 2 && kv[0].Equals(key, StringComparison.OrdinalIgnoreCase))
                {
                    return Uri.UnescapeDataString(kv[1]);
                }
            }

            return null;
        }
    }
}
