using System.Net.Http;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;

namespace TeslaSync.App.UITests.Drivers;

/// <summary>
/// Locator strategy for resolving an element in the Windows UI Automation tree, mirroring the
/// strategies WinAppDriver accepts over the W3C WebDriver / JSON-wire protocol.
/// </summary>
/// <param name="Using">The WebDriver locator keyword (e.g. <c>accessibility id</c>).</param>
/// <param name="Value">The value matched against that strategy.</param>
public readonly record struct By(string Using, string Value)
{
    /// <summary>Match by <c>AutomationProperties.AutomationId</c> (WinUI sets this from <c>x:Name</c>).</summary>
    public static By AccessibilityId(string id) => new("accessibility id", id);

    /// <summary>Match by accessible Name (<c>AutomationProperties.Name</c> / control content).</summary>
    public static By Name(string name) => new("name", name);

    /// <summary>Match by UIA class name.</summary>
    public static By ClassName(string className) => new("class name", className);

    /// <summary>Match by UIA control type (WinAppDriver tag name, e.g. <c>Button</c>, <c>Edit</c>).</summary>
    public static By ControlType(string controlType) => new("tag name", controlType);

    /// <summary>Match by an XPath expression over the UIA tree.</summary>
    public static By XPath(string xpath) => new("xpath", xpath);
}

/// <summary>
/// A self-contained WinAppDriver client implemented directly over the WebDriver HTTP protocol with
/// <see cref="HttpClient"/> + <see cref="System.Text.Json"/> — no Appium/Selenium package dependency.
/// It speaks the protocol WinAppDriver exposes on <c>http://127.0.0.1:4723</c>: it negotiates a
/// session (sending both the legacy <c>desiredCapabilities</c> and W3C <c>capabilities</c> shapes so
/// it works against classic WinAppDriver and an Appium-2 Windows driver alike), finds elements by
/// every UIA locator strategy, clicks, types, reads text/attributes, captures screenshots and the
/// UIA source tree, and resizes the window. Failures surface as <see cref="WinAppDriverException"/>.
/// </summary>
public sealed class WinAppDriverClient : IDisposable
{
    private const string W3CElementKey = "element-6066-11e4-a52e-4f735466cecf";

    private readonly HttpClient _http;
    private readonly bool _ownsHttp;
    private string? _sessionId;

    /// <summary>Create a client targeting a running WinAppDriver/Appium endpoint.</summary>
    /// <param name="serverUri">Driver base address (default <c>http://127.0.0.1:4723</c>).</param>
    /// <param name="http">Optional shared <see cref="HttpClient"/>; one is created and owned otherwise.</param>
    public WinAppDriverClient(Uri serverUri, HttpClient? http = null)
    {
        ArgumentNullException.ThrowIfNull(serverUri);
        _ownsHttp = http is null;
        _http = http ?? new HttpClient();
        _http.BaseAddress = new Uri(EnsureTrailingSlash(serverUri.ToString()), UriKind.Absolute);
        _http.Timeout = TimeSpan.FromSeconds(60);
    }

    /// <summary>The active WebDriver session id, or null before <see cref="CreateSessionAsync"/>.</summary>
    public string? SessionId => _sessionId;

    /// <summary>
    /// Open a session against the application identified by <paramref name="appIdentity"/> (a packaged
    /// AUMID such as <c>EvDevLabs.TeslaSync_*!App</c> or an absolute executable path), passing the
    /// environment-driven test profile and an implicit-wait timeout.
    /// </summary>
    public async Task CreateSessionAsync(
        string appIdentity,
        IReadOnlyDictionary<string, string>? environment = null,
        TimeSpan? implicitWait = null,
        CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(appIdentity);

        var caps = new Dictionary<string, object>
        {
            ["app"] = appIdentity,
            ["platformName"] = "Windows",
            ["deviceName"] = "WindowsPC",
            ["ms:waitForAppLaunch"] = "10",
        };
        if (environment is { Count: > 0 })
        {
            // WinAppDriver forwards appArguments/environment to the launched process.
            caps["appWorkingDir"] = Environment.CurrentDirectory;
            caps["environment"] = environment.ToDictionary(kv => kv.Key, kv => (object)kv.Value);
        }

        var body = new Dictionary<string, object>
        {
            ["desiredCapabilities"] = caps,
            ["capabilities"] = new Dictionary<string, object>
            {
                ["alwaysMatch"] = caps.ToDictionary(
                    kv => kv.Key is "app" or "platformName" or "deviceName" ? PrefixAppium(kv.Key) : kv.Key,
                    kv => kv.Value),
                ["firstMatch"] = new[] { new Dictionary<string, object>() },
            },
        };

        var response = await PostAsync(string.Empty, "session", body, cancellationToken).ConfigureAwait(false);
        _sessionId = ReadSessionId(response)
            ?? throw new WinAppDriverException("WinAppDriver returned no session id when creating a session.");

        if (implicitWait is { } wait)
        {
            await SetImplicitWaitAsync(wait, cancellationToken).ConfigureAwait(false);
        }
    }

    /// <summary>Set the implicit element-wait used by subsequent find calls.</summary>
    public async Task SetImplicitWaitAsync(TimeSpan timeout, CancellationToken cancellationToken = default)
    {
        var body = new Dictionary<string, object>
        {
            ["ms"] = (long)timeout.TotalMilliseconds,
            ["implicit"] = (long)timeout.TotalMilliseconds,
            ["type"] = "implicit",
        };
        await PostAsync(RequireSession(), "timeouts", body, cancellationToken).ConfigureAwait(false);
    }

    /// <summary>Find the first element matching <paramref name="by"/>; throws when none is found.</summary>
    public async Task<WinAppElement> FindElementAsync(By by, CancellationToken cancellationToken = default)
        => await TryFindElementAsync(by, cancellationToken).ConfigureAwait(false)
            ?? throw new WinAppDriverException($"No element matched {by.Using}='{by.Value}'.");

    /// <summary>Find the first element matching <paramref name="by"/>, or null when none exists.</summary>
    public async Task<WinAppElement?> TryFindElementAsync(By by, CancellationToken cancellationToken = default)
    {
        var body = new Dictionary<string, object> { ["using"] = by.Using, ["value"] = by.Value };
        try
        {
            var response = await PostAsync(RequireSession(), "element", body, cancellationToken).ConfigureAwait(false);
            var id = ReadElementId(response.GetProperty("value"));
            return id is null ? null : new WinAppElement(this, id);
        }
        catch (WinAppDriverException ex) when (ex.IsNoSuchElement)
        {
            return null;
        }
    }

    /// <summary>Find every element matching <paramref name="by"/> (empty when none match).</summary>
    public async Task<IReadOnlyList<WinAppElement>> FindElementsAsync(By by, CancellationToken cancellationToken = default)
    {
        var body = new Dictionary<string, object> { ["using"] = by.Using, ["value"] = by.Value };
        var response = await PostAsync(RequireSession(), "elements", body, cancellationToken).ConfigureAwait(false);

        var results = new List<WinAppElement>();
        if (response.TryGetProperty("value", out var array) && array.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in array.EnumerateArray())
            {
                var id = ReadElementId(item);
                if (id is not null)
                {
                    results.Add(new WinAppElement(this, id));
                }
            }
        }

        return results;
    }

    /// <summary>Poll until an element matching <paramref name="by"/> appears or <paramref name="timeout"/> elapses.</summary>
    public async Task<WinAppElement> WaitForElementAsync(
        By by, TimeSpan timeout, CancellationToken cancellationToken = default)
    {
        var deadline = DateTimeOffset.UtcNow + timeout;
        WinAppDriverException? last = null;
        while (DateTimeOffset.UtcNow < deadline)
        {
            cancellationToken.ThrowIfCancellationRequested();
            try
            {
                var found = await TryFindElementAsync(by, cancellationToken).ConfigureAwait(false);
                if (found is not null)
                {
                    return found;
                }
            }
            catch (WinAppDriverException ex)
            {
                last = ex;
            }

            await Task.Delay(150, cancellationToken).ConfigureAwait(false);
        }

        throw last ?? new WinAppDriverException($"Timed out after {timeout.TotalSeconds:0.#}s waiting for {by.Using}='{by.Value}'.");
    }

    /// <summary>Click the element with id <paramref name="elementId"/>.</summary>
    public async Task ClickAsync(string elementId, CancellationToken cancellationToken = default)
        => await PostAsync(RequireSession(), $"element/{elementId}/click", new Dictionary<string, object>(), cancellationToken)
            .ConfigureAwait(false);

    /// <summary>Type <paramref name="text"/> into the element with id <paramref name="elementId"/>.</summary>
    public async Task SendKeysAsync(string elementId, string text, CancellationToken cancellationToken = default)
    {
        var body = new Dictionary<string, object>
        {
            ["text"] = text,
            ["value"] = text.Select(c => c.ToString()).ToArray(),
        };
        await PostAsync(RequireSession(), $"element/{elementId}/value", body, cancellationToken).ConfigureAwait(false);
    }

    /// <summary>Send keystrokes to the focused element / window (used for keyboard-only navigation).</summary>
    public async Task SendKeysAsync(string text, CancellationToken cancellationToken = default)
    {
        var body = new Dictionary<string, object> { ["value"] = text.Select(c => c.ToString()).ToArray() };
        await PostAsync(RequireSession(), "keys", body, cancellationToken).ConfigureAwait(false);
    }

    /// <summary>Read the visible text of the element with id <paramref name="elementId"/>.</summary>
    public async Task<string> GetTextAsync(string elementId, CancellationToken cancellationToken = default)
    {
        var response = await GetAsync(RequireSession(), $"element/{elementId}/text", cancellationToken).ConfigureAwait(false);
        return response.TryGetProperty("value", out var v) && v.ValueKind == JsonValueKind.String ? v.GetString()! : string.Empty;
    }

    /// <summary>Read a UIA attribute (e.g. <c>Name</c>, <c>IsKeyboardFocusable</c>, <c>HasKeyboardFocus</c>).</summary>
    public async Task<string?> GetAttributeAsync(string elementId, string name, CancellationToken cancellationToken = default)
    {
        var response = await GetAsync(
            RequireSession(), $"element/{elementId}/attribute/{name}", cancellationToken).ConfigureAwait(false);
        if (!response.TryGetProperty("value", out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.String => v.GetString(),
            JsonValueKind.Null => null,
            _ => v.GetRawText(),
        };
    }

    /// <summary>Read the element's reported UIA control type via the WebDriver tag-name endpoint.</summary>
    public async Task<string> GetControlTypeAsync(string elementId, CancellationToken cancellationToken = default)
    {
        var response = await GetAsync(RequireSession(), $"element/{elementId}/name", cancellationToken).ConfigureAwait(false);
        return response.TryGetProperty("value", out var v) && v.ValueKind == JsonValueKind.String ? v.GetString()! : string.Empty;
    }

    /// <summary>True when the element currently holds keyboard focus.</summary>
    public async Task<bool> HasKeyboardFocusAsync(string elementId, CancellationToken cancellationToken = default)
    {
        var raw = await GetAttributeAsync(elementId, "HasKeyboardFocus", cancellationToken).ConfigureAwait(false);
        return bool.TryParse(raw, out var focused) && focused;
    }

    /// <summary>Capture a PNG screenshot of the application window.</summary>
    public async Task<byte[]> CaptureScreenshotAsync(CancellationToken cancellationToken = default)
    {
        var response = await GetAsync(RequireSession(), "screenshot", cancellationToken).ConfigureAwait(false);
        var base64 = response.TryGetProperty("value", out var v) && v.ValueKind == JsonValueKind.String
            ? v.GetString()!
            : string.Empty;
        return base64.Length == 0 ? [] : Convert.FromBase64String(base64);
    }

    /// <summary>Read the full UIA tree as the WebDriver page source (XML).</summary>
    public async Task<string> GetPageSourceAsync(CancellationToken cancellationToken = default)
    {
        var response = await GetAsync(RequireSession(), "source", cancellationToken).ConfigureAwait(false);
        return response.TryGetProperty("value", out var v) && v.ValueKind == JsonValueKind.String ? v.GetString()! : string.Empty;
    }

    /// <summary>Resize the application window (drives the title-bar / resize coverage).</summary>
    public async Task SetWindowSizeAsync(int width, int height, CancellationToken cancellationToken = default)
    {
        var rect = new Dictionary<string, object> { ["width"] = width, ["height"] = height };
        // W3C 'window/rect' first; fall back to the legacy 'window/size' for classic WinAppDriver.
        try
        {
            await PostAsync(RequireSession(), "window/rect", rect, cancellationToken).ConfigureAwait(false);
        }
        catch (WinAppDriverException)
        {
            await PostAsync(RequireSession(), "window/size", rect, cancellationToken).ConfigureAwait(false);
        }
    }

    /// <summary>Read the application window's current size (width, height) in pixels.</summary>
    public async Task<(int Width, int Height)> GetWindowRectAsync(CancellationToken cancellationToken = default)
    {
        JsonElement response;
        try
        {
            response = await GetAsync(RequireSession(), "window/rect", cancellationToken).ConfigureAwait(false);
        }
        catch (WinAppDriverException)
        {
            response = await GetAsync(RequireSession(), "window/size", cancellationToken).ConfigureAwait(false);
        }

        if (!response.TryGetProperty("value", out var value) || value.ValueKind != JsonValueKind.Object)
        {
            return (0, 0);
        }

        var width = value.TryGetProperty("width", out var w) && w.TryGetInt32(out var wi) ? wi : 0;
        var height = value.TryGetProperty("height", out var h) && h.TryGetInt32(out var hi) ? hi : 0;
        return (width, height);
    }

    /// <summary>End the session and close the application under test.</summary>
    public async Task DeleteSessionAsync(CancellationToken cancellationToken = default)
    {
        if (_sessionId is null)
        {
            return;
        }

        var path = $"session/{_sessionId}";
        _sessionId = null;
        using var request = new HttpRequestMessage(HttpMethod.Delete, path);
        try
        {
            using var response = await _http.SendAsync(request, cancellationToken).ConfigureAwait(false);
        }
        catch (HttpRequestException)
        {
            // Session teardown is best-effort; the driver/app may already be gone.
        }
    }

    /// <inheritdoc />
    public void Dispose()
    {
        try
        {
            DeleteSessionAsync().GetAwaiter().GetResult();
        }
        catch (WinAppDriverException)
        {
            // Ignore teardown failures on dispose.
        }

        if (_ownsHttp)
        {
            _http.Dispose();
        }
    }

    private async Task<JsonElement> PostAsync(
        string sessionPath, string command, object body, CancellationToken cancellationToken)
    {
        var path = Combine(sessionPath, command);
        using var content = JsonContent.Create(body);
        using var response = await SendAsync(HttpMethod.Post, path, content, cancellationToken).ConfigureAwait(false);
        return await ReadResultAsync(response, $"POST {path}", cancellationToken).ConfigureAwait(false);
    }

    private async Task<JsonElement> GetAsync(string sessionPath, string command, CancellationToken cancellationToken)
    {
        var path = Combine(sessionPath, command);
        using var response = await SendAsync(HttpMethod.Get, path, null, cancellationToken).ConfigureAwait(false);
        return await ReadResultAsync(response, $"GET {path}", cancellationToken).ConfigureAwait(false);
    }

    private async Task<HttpResponseMessage> SendAsync(
        HttpMethod method, string path, HttpContent? content, CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(method, path) { Content = content };
        try
        {
            return await _http.SendAsync(request, cancellationToken).ConfigureAwait(false);
        }
        catch (HttpRequestException ex)
        {
            throw new WinAppDriverException(
                $"Could not reach WinAppDriver at {_http.BaseAddress} ({method} {path}). " +
                "Is WinAppDriver.exe / the Appium Windows driver running?", ex);
        }
        catch (TaskCanceledException ex)
        {
            throw new WinAppDriverException($"WinAppDriver request timed out ({method} {path}).", ex);
        }
    }

    private static async Task<JsonElement> ReadResultAsync(
        HttpResponseMessage response, string context, CancellationToken cancellationToken)
    {
        var payload = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
        JsonElement root;
        try
        {
            using var doc = JsonDocument.Parse(string.IsNullOrWhiteSpace(payload) ? "{}" : payload);
            root = doc.RootElement.Clone();
        }
        catch (JsonException)
        {
            throw new WinAppDriverException($"{context} returned a non-JSON body: {Trim(payload)}");
        }

        if (response.IsSuccessStatusCode && !IsErrorValue(root, out _))
        {
            return root;
        }

        var (error, message) = ExtractError(root, payload);
        throw new WinAppDriverException($"{context} failed ({(int)response.StatusCode}): {message}", error);
    }

    private static bool IsErrorValue(JsonElement root, out string error)
    {
        error = string.Empty;

        // W3C error envelope: { "value": { "error": "...", "message": "..." } }
        if (root.TryGetProperty("value", out var value) &&
            value.ValueKind == JsonValueKind.Object &&
            value.TryGetProperty("error", out var errProp) &&
            errProp.ValueKind == JsonValueKind.String)
        {
            error = errProp.GetString() ?? string.Empty;
            return true;
        }

        // Legacy JSON-wire status: non-zero "status" indicates failure.
        if (root.TryGetProperty("status", out var status) &&
            status.ValueKind == JsonValueKind.Number &&
            status.GetInt32() != 0)
        {
            error = status.GetInt32() == 7 ? "no such element" : $"status {status.GetInt32()}";
            return true;
        }

        return false;
    }

    private static (string Error, string Message) ExtractError(JsonElement root, string payload)
    {
        if (root.TryGetProperty("value", out var value) && value.ValueKind == JsonValueKind.Object)
        {
            var error = value.TryGetProperty("error", out var e) && e.ValueKind == JsonValueKind.String
                ? e.GetString() ?? string.Empty
                : string.Empty;
            var message = value.TryGetProperty("message", out var m) && m.ValueKind == JsonValueKind.String
                ? m.GetString() ?? string.Empty
                : Trim(payload);
            return (error, string.IsNullOrEmpty(message) ? Trim(payload) : message);
        }

        IsErrorValue(root, out var legacyError);
        return (legacyError, Trim(payload));
    }

    private static string? ReadElementId(JsonElement value)
    {
        if (value.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        if (value.TryGetProperty(W3CElementKey, out var w3c) && w3c.ValueKind == JsonValueKind.String)
        {
            return w3c.GetString();
        }

        if (value.TryGetProperty("ELEMENT", out var legacy) && legacy.ValueKind == JsonValueKind.String)
        {
            return legacy.GetString();
        }

        return null;
    }

    private static string? ReadSessionId(JsonElement root)
    {
        if (root.TryGetProperty("sessionId", out var direct) && direct.ValueKind == JsonValueKind.String)
        {
            return direct.GetString();
        }

        if (root.TryGetProperty("value", out var value) &&
            value.ValueKind == JsonValueKind.Object &&
            value.TryGetProperty("sessionId", out var nested) &&
            nested.ValueKind == JsonValueKind.String)
        {
            return nested.GetString();
        }

        return null;
    }

    private string RequireSession() =>
        $"session/{_sessionId ?? throw new WinAppDriverException("No active WinAppDriver session.")}";

    private static string PrefixAppium(string key) => key switch
    {
        "platformName" => "platformName",
        _ => "appium:" + key,
    };

    private static string Combine(string left, string right) =>
        string.IsNullOrEmpty(left) ? right : $"{left}/{right}";

    private static string EnsureTrailingSlash(string uri) => uri.EndsWith('/') ? uri : uri + "/";

    private static string Trim(string value)
    {
        value = value.Replace('\n', ' ').Replace('\r', ' ').Trim();
        return value.Length <= 240 ? value : string.Concat(value.AsSpan(0, 240), "…");
    }
}
