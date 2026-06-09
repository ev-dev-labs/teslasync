using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Threading.Channels;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The repository-backed <see cref="IOnboardingChecklistSource"/> — the native data adapter for the
/// Setup Checklist surface. It runs three concurrent cache-then-network reads through the shared
/// <see cref="CacheThenNetworkEngine"/> — the vehicle list (<c>GET /vehicles</c>,
/// <see cref="Operations.Vehicles.List"/>), the alert rules (<c>GET /alerts/rules</c>) and the
/// notification channels (<c>GET /notifications</c>, <see cref="Operations.Notifications.List"/>) — the
/// native analogue of the web <c>useVehicles</c> + <c>useAlertRules</c> + <c>useNotificationChannels</c>
/// queries the checklist composes. Their raw JSON emissions are combine-latest merged through
/// <see cref="OnboardingChecklistResultMapper.Combine"/> as each settles, so cached counts surface fast
/// and a slow / failed read simply leaves its task incomplete. No HTTP touches the view.
/// </summary>
public sealed class OnboardingChecklistSource : IOnboardingChecklistSource
{
    // The alert-rules read has no Operations group entry yet (Operations.cs catalogs only the GET reads
    // captured by the codegen seam); the generated endpoint is referenced verbatim here, the only file
    // scoped to this surface. It resolves against TeslaSync.Windows.Generated.Api.ApiEndpoints.
    private const string AlertRulesOperation = "get_api_v1_alerts_rules";

    private const string VehiclesCacheKey = "vehicles:list";
    private const string AlertRulesCacheKey = "alerts:rules";
    private const string ChannelsCacheKey = "notifications:channels";

    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;

    /// <summary>Creates the source over the contract client, cache-then-network engine and JSON settings.</summary>
    public OnboardingChecklistSource(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _api = api;
        _engine = engine;
        _json = options.Json;
    }

    private enum ChecklistPart
    {
        Vehicles,
        Rules,
        Channels,
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<OnboardingChecklistRemoteCounts>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        yield return RepositoryResult<OnboardingChecklistRemoteCounts>.Loading();

        var channel = Channel.CreateUnbounded<MergeItem>(new UnboundedChannelOptions
        {
            SingleReader = true,
            SingleWriter = false,
        });

        var pumps = new List<Task>(3)
        {
            PumpAsync(ChecklistPart.Vehicles, VehiclesStream(cancellationToken), channel.Writer, cancellationToken),
            PumpAsync(ChecklistPart.Rules, RulesStream(cancellationToken), channel.Writer, cancellationToken),
            PumpAsync(ChecklistPart.Channels, ChannelsStream(cancellationToken), channel.Writer, cancellationToken),
        };

        var pumpAll = Task.WhenAll(pumps);

        // Complete the channel once every pump finishes; accessing t.Exception observes any pump fault so
        // the reader surfaces it (and no task goes unobserved). Cancellation flows cleanly via ReadAllAsync.
        _ = pumpAll.ContinueWith(
            static (t, writer) => ((ChannelWriter<MergeItem>)writer!).TryComplete(t.Exception),
            channel.Writer,
            CancellationToken.None,
            TaskContinuationOptions.ExecuteSynchronously,
            TaskScheduler.Default);

        var vehicles = RepositoryResult<JsonElement>.Loading();
        var rules = RepositoryResult<JsonElement>.Loading();
        var channels = RepositoryResult<JsonElement>.Loading();

        await foreach (var item in channel.Reader.ReadAllAsync(cancellationToken).ConfigureAwait(false))
        {
            switch (item.Part)
            {
                case ChecklistPart.Vehicles:
                    vehicles = item.Result;
                    break;
                case ChecklistPart.Rules:
                    rules = item.Result;
                    break;
                default:
                    channels = item.Result;
                    break;
            }

            yield return OnboardingChecklistResultMapper.Combine(vehicles, rules, channels);
        }
    }

    private static async Task PumpAsync(
        ChecklistPart part,
        IAsyncEnumerable<RepositoryResult<JsonElement>> stream,
        ChannelWriter<MergeItem> writer,
        CancellationToken cancellationToken)
    {
        await foreach (var result in stream.ConfigureAwait(false))
        {
            await writer.WriteAsync(new MergeItem(part, result), cancellationToken).ConfigureAwait(false);
        }
    }

    private static bool IsEmptyArray(JsonElement element) =>
        element.ValueKind == JsonValueKind.Array && element.GetArrayLength() == 0;

    private IAsyncEnumerable<RepositoryResult<JsonElement>> VehiclesStream(CancellationToken cancellationToken) =>
        Stream(VehiclesCacheKey, new ApiRequest(Operations.Vehicles.List), cancellationToken);

    private IAsyncEnumerable<RepositoryResult<JsonElement>> RulesStream(CancellationToken cancellationToken) =>
        Stream(AlertRulesCacheKey, new ApiRequest(AlertRulesOperation), cancellationToken);

    private IAsyncEnumerable<RepositoryResult<JsonElement>> ChannelsStream(CancellationToken cancellationToken) =>
        Stream(ChannelsCacheKey, new ApiRequest(Operations.Notifications.List), cancellationToken);

    private IAsyncEnumerable<RepositoryResult<JsonElement>> Stream(
        string cacheKey,
        ApiRequest request,
        CancellationToken cancellationToken) =>
        _engine.StreamAsync<JsonElement>(
            cacheKey,
            ct => _api.SendAsync<JsonElement>(request, ct),
            IsEmptyArray,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

    private readonly record struct MergeItem(ChecklistPart Part, RepositoryResult<JsonElement> Result);
}
