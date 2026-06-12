using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.Net;

namespace TeslaSync.App.FeatureViews.Admin;

/// <summary>
/// The generated-client-backed <see cref="IFeedbackQueueFeed"/> — the native data adapter for the admin feedback
/// queue surface. It binds to the generated OpenAPI contract client (ADR-004): <c>GET /admin/feedback</c> for the
/// page query (web <c>useFeedbackList</c>, with snake_case <c>status</c>/<c>category</c>/<c>limit</c>/<c>offset</c>
/// params, the unset filters omitted exactly as the web <c>buildQuery</c> does) and <c>PATCH /admin/feedback/{id}</c>
/// for the row update (web <c>useUpdateFeedback</c>, sending only the touched <see cref="FeedbackUpdate"/> field). No
/// HTTP touches the view; the response JSON round-trips through the tolerant <see cref="FeedbackListSnapshot"/>
/// parser so the snake_case wire shape is preserved losslessly.
/// </summary>
public sealed class FeedbackQueueClientFeed : IFeedbackQueueFeed
{
    private const string ListOperation = "get_api_v1_admin_feedback";
    private const string UpdateOperation = "patch_api_v1_admin_feedback_id";

    private readonly IApiClient _api;

    /// <summary>Creates the feed over the generated contract client.</summary>
    /// <param name="api">The generated OpenAPI contract client.</param>
    public FeedbackQueueClientFeed(IApiClient api)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
    }

    /// <inheritdoc />
    public async Task<FeedbackListSnapshot> FetchAsync(FeedbackQueueQuery query, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(query);

        var parameters = new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            ["limit"] = query.Limit,
            ["offset"] = query.Page * query.Limit,
        };
        if (!string.IsNullOrEmpty(query.Filter.Status))
        {
            parameters["status"] = query.Filter.Status;
        }

        if (!string.IsNullOrEmpty(query.Filter.Category))
        {
            parameters["category"] = query.Filter.Category;
        }

        var request = new ApiRequest(ListOperation, Query: parameters);
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return FeedbackListSnapshot.FromJson(json);
    }

    /// <inheritdoc />
    public async Task UpdateAsync(long id, FeedbackUpdate update, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(update);

        var body = new Dictionary<string, object?>(StringComparer.Ordinal);
        if (update.Status is not null)
        {
            body["status"] = update.Status;
        }

        if (update.GithubIssueUrl is not null)
        {
            body["github_issue_url"] = update.GithubIssueUrl;
        }

        if (update.ForwardToGithub is not null)
        {
            body["forward_to_github"] = update.ForwardToGithub;
        }

        var request = new ApiRequest(
            UpdateOperation,
            PathParams: new Dictionary<string, string>(StringComparer.Ordinal)
            {
                ["id"] = id.ToString(CultureInfo.InvariantCulture),
            },
            Body: body);

        await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
    }
}
