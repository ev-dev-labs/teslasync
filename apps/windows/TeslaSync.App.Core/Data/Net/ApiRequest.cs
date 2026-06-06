namespace TeslaSync.App.Core.Data.Net;

/// <summary>
/// A request against one generated endpoint, identified by its OpenAPI
/// <see cref="OperationId"/>. Path parameters fill the <c>{name}</c> slots in the
/// endpoint template; query parameters are appended as snake_case key/value pairs to
/// match the Go API (never camelCase). The optional <see cref="Body"/> is serialized
/// as JSON for write operations.
/// </summary>
public sealed record ApiRequest(
    string OperationId,
    IReadOnlyDictionary<string, string>? PathParams = null,
    IReadOnlyDictionary<string, object?>? Query = null,
    object? Body = null)
{
    /// <summary>A request with a single path parameter.</summary>
    public static ApiRequest WithPath(string operationId, string name, string value) =>
        new(operationId, new Dictionary<string, string> { [name] = value });

    /// <summary>A request with a single optional query parameter (omitted when null).</summary>
    public static ApiRequest WithQuery(string operationId, string name, object? value) =>
        new(operationId, null, new Dictionary<string, object?> { [name] = value });
}
