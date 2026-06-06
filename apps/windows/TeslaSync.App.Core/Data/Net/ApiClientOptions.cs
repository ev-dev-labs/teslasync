using System.Text.Json;
using System.Text.Json.Serialization;

namespace TeslaSync.App.Core.Data.Net;

/// <summary>
/// Centralized configuration for the API networking layer: the base address, the
/// single <c>/api/v1</c> version segment (applied exactly once so hooks never
/// double-prefix), and the shared JSON settings used to (de)serialize the generated
/// contract types. JSON is snake_case-aware to match the Go API's <c>json</c> tags.
/// </summary>
public sealed class ApiClientOptions
{
    /// <summary>The API origin (scheme + host[:port]); the request path is appended to this.</summary>
    public Uri BaseAddress { get; set; } = new("https://teslasync.local", UriKind.Absolute);

    /// <summary>The version segment prepended to versioned endpoints. The client adds it once.</summary>
    public string VersionBasePath { get; set; } = "/api/v1";

    /// <summary>The shared serializer settings for every request/response body.</summary>
    public JsonSerializerOptions Json { get; init; } = CreateJsonOptions();

    /// <summary>Builds the canonical JSON settings (web defaults + named float literals + null-skip).</summary>
    public static JsonSerializerOptions CreateJsonOptions() => new(JsonSerializerDefaults.Web)
    {
        PropertyNameCaseInsensitive = true,
        NumberHandling = JsonNumberHandling.AllowNamedFloatingPointLiterals,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };
}
