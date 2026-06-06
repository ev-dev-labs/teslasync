using System.Net;
using System.Text.Json;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.Core.Data.Behavior;

/// <summary>
/// Maps transport/HTTP faults onto the privacy-safe <see cref="RepositoryError"/> the
/// W7 pages consume. This is the single place the data layer decides "what kind of
/// failure was that" so the classification stays consistent across every repository.
/// </summary>
public static class ApiErrorMapper
{
    /// <summary>Classifies any exception thrown while fetching from the API.</summary>
    public static RepositoryError Map(Exception exception)
    {
        ArgumentNullException.ThrowIfNull(exception);

        return exception switch
        {
            ApiException api => FromStatus(api.StatusCode, api.ErrorCode, api.Message),
            OperationCanceledException => new RepositoryError(RepositoryErrorKind.Canceled, "The request was canceled."),
            JsonException => new RepositoryError(RepositoryErrorKind.Decoding, "The server response could not be read."),
            HttpRequestException => new RepositoryError(RepositoryErrorKind.Network, "The server could not be reached."),
            IOException => new RepositoryError(RepositoryErrorKind.Network, "The connection was interrupted."),
            _ => new RepositoryError(RepositoryErrorKind.Unknown, "Something went wrong."),
        };
    }

    /// <summary>Classifies an HTTP status code (and optional server error code/message).</summary>
    public static RepositoryError FromStatus(int? statusCode, string? code, string? message)
    {
        if (statusCode is not { } status)
        {
            return new RepositoryError(RepositoryErrorKind.Network, message ?? "The server could not be reached.", null, code);
        }

        var kind = status switch
        {
            (int)HttpStatusCode.Unauthorized => RepositoryErrorKind.Unauthorized,
            (int)HttpStatusCode.Forbidden => RepositoryErrorKind.Unauthorized,
            (int)HttpStatusCode.NotFound => RepositoryErrorKind.NotFound,
            (int)HttpStatusCode.RequestTimeout => RepositoryErrorKind.Network,
            429 => RepositoryErrorKind.RateLimited,
            >= 500 and <= 599 => RepositoryErrorKind.Server,
            _ => RepositoryErrorKind.Unknown,
        };

        var text = message ?? kind switch
        {
            RepositoryErrorKind.Unauthorized => "Your session has expired.",
            RepositoryErrorKind.NotFound => "That item could not be found.",
            RepositoryErrorKind.RateLimited => "Too many requests — please wait a moment.",
            RepositoryErrorKind.Server => "The server reported an error.",
            _ => "The request failed.",
        };

        return new RepositoryError(kind, text, status, code);
    }
}
