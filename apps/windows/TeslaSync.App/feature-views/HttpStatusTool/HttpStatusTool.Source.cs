namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The catalog port the <see cref="HttpStatusToolViewModel"/> reads its reference rows from (P1/S8
/// state-holder seam) — the native analogue of the web <c>HTTP_CODES</c> constant
/// (web/src/features/admin/components/devtools/constants.ts). The view never reaches for the data itself; the
/// concrete <see cref="HttpStatusCodeSource"/> (or a test fake) supplies it.
/// </summary>
public interface IHttpStatusCodeSource
{
    /// <summary>The canonical HTTP status codes, in catalog (declaration) order.</summary>
    IReadOnlyList<HttpStatusCode> GetCodes();
}

/// <summary>
/// The single real <see cref="IHttpStatusCodeSource"/> — the native mirror of the web <c>HTTP_CODES</c>
/// reference table (web/src/features/admin/components/devtools/constants.ts). The nineteen entries and their
/// order match the web constant exactly so the projected table reads row-for-row the same; the data is static
/// reference material that runs entirely on the device (no HTTP, no SI conversion).
/// </summary>
public sealed class HttpStatusCodeSource : IHttpStatusCodeSource
{
    private static readonly IReadOnlyList<HttpStatusCode> CodeCatalog =
    [
        new(200, "OK", "Request succeeded"),
        new(201, "Created", "Resource created"),
        new(204, "No Content", "Success with no body"),
        new(301, "Moved Permanently", "Resource moved"),
        new(302, "Found", "Temporary redirect"),
        new(304, "Not Modified", "Use cached version"),
        new(400, "Bad Request", "Invalid request"),
        new(401, "Unauthorized", "Auth required"),
        new(403, "Forbidden", "Access denied"),
        new(404, "Not Found", "Resource not found"),
        new(405, "Method Not Allowed", "HTTP method not supported"),
        new(408, "Request Timeout", "Client took too long"),
        new(409, "Conflict", "Resource conflict"),
        new(422, "Unprocessable Entity", "Validation failed"),
        new(429, "Too Many Requests", "Rate limited"),
        new(500, "Internal Server Error", "Server error"),
        new(502, "Bad Gateway", "Upstream error"),
        new(503, "Service Unavailable", "Server overloaded"),
        new(504, "Gateway Timeout", "Upstream timeout"),
    ];

    /// <inheritdoc />
    public IReadOnlyList<HttpStatusCode> GetCodes() => CodeCatalog;
}
