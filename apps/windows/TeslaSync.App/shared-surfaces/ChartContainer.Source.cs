using System.Globalization;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using TeslaSync.App.Core.Auth;
using TeslaSync.App.Core.Data.Net;

namespace TeslaSync.App.SharedSurfaces.ChartContainerSurface;

/// <summary>
/// The durable chart-annotation data seam the ChartContainer state holder binds to (P1/S8) — the native analogue
/// of the web <c>useChartAnnotationsAsData</c> / <c>useCreateAnnotation</c> / <c>useDeleteAnnotation</c> TanStack
/// hooks (web/src/api/hooks/useAnnotations.ts). It fetches the rows pinned to a vehicle plus the fleet-wide rows,
/// creates a new annotation, and deletes one by id. Production uses
/// <see cref="HttpClientChartAnnotationSource"/>; tests inject <see cref="InMemoryChartAnnotationSource"/> so no
/// socket is opened. The view never performs HTTP — it binds through the view-model.
/// </summary>
public interface IChartAnnotationSource
{
    /// <summary>
    /// Fetch the annotations for a scope bucket, optionally scoped to a vehicle (web
    /// <c>GET /annotations?vehicle_id=&amp;scope=</c>), already projected onto the chart-render shape.
    /// </summary>
    /// <param name="vehicleId">The vehicle to pin to, or null for fleet-wide only.</param>
    /// <param name="scope">The scope bucket to read.</param>
    /// <param name="cancellationToken">Cancels the fetch.</param>
    /// <returns>The projected annotations (empty when none).</returns>
    Task<IReadOnlyList<ChartDataAnnotation>> FetchAsync(
        int? vehicleId,
        string scope,
        CancellationToken cancellationToken = default);

    /// <summary>Create a new annotation (web <c>POST /annotations</c>).</summary>
    /// <param name="input">The annotation payload.</param>
    /// <param name="cancellationToken">Cancels the request.</param>
    /// <returns>A task that completes when the annotation is created.</returns>
    Task CreateAsync(CreateAnnotationInput input, CancellationToken cancellationToken = default);

    /// <summary>Delete an annotation by id (web <c>DELETE /annotations/{id}</c>).</summary>
    /// <param name="id">The backend annotation id.</param>
    /// <param name="cancellationToken">Cancels the request.</param>
    /// <returns>A task that completes when the annotation is removed.</returns>
    Task DeleteAsync(long id, CancellationToken cancellationToken = default);
}

/// <summary>
/// The production <see cref="IChartAnnotationSource"/>: talks to the versioned <c>/annotations</c> endpoints over
/// an <see cref="HttpClient"/>, reading the current bearer token from the <see cref="ITokenProvider"/> on every
/// call so a refreshed credential is honoured and building the versioned URI from the
/// <see cref="ApiClientOptions"/> base path (the same wiring the other native data seams use). Rows are decoded
/// from the snake_case wire shape and projected to <see cref="ChartDataAnnotation"/>; the bearer token is never
/// logged.
/// </summary>
public sealed class HttpClientChartAnnotationSource : IChartAnnotationSource
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private readonly HttpClient _http;
    private readonly ApiClientOptions _options;
    private readonly ITokenProvider _tokenProvider;

    /// <summary>Creates the source over a configured client, API options and token provider.</summary>
    /// <param name="http">The HTTP client (base address + handler supplied by the host composition root).</param>
    /// <param name="options">The API options carrying the version base path and fallback base address.</param>
    /// <param name="tokenProvider">The bearer-token source.</param>
    public HttpClientChartAnnotationSource(HttpClient http, ApiClientOptions options, ITokenProvider tokenProvider)
    {
        ArgumentNullException.ThrowIfNull(http);
        ArgumentNullException.ThrowIfNull(options);
        ArgumentNullException.ThrowIfNull(tokenProvider);
        _http = http;
        _options = options;
        _tokenProvider = tokenProvider;
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<ChartDataAnnotation>> FetchAsync(
        int? vehicleId,
        string scope,
        CancellationToken cancellationToken = default)
    {
        using var message = new HttpRequestMessage(HttpMethod.Get, BuildUri("annotations" + BuildQuery(vehicleId, scope)));
        await AuthorizeAsync(message, cancellationToken).ConfigureAwait(false);

        using var response = await _http.SendAsync(message, cancellationToken).ConfigureAwait(false);
        response.EnsureSuccessStatusCode();

        await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken).ConfigureAwait(false);
        var rows = await JsonSerializer
            .DeserializeAsync<List<AnnotationWireDto>>(stream, JsonOptions, cancellationToken)
            .ConfigureAwait(false);

        if (rows is null || rows.Count == 0)
        {
            return Array.Empty<ChartDataAnnotation>();
        }

        var projected = new List<ChartDataAnnotation>(rows.Count);
        foreach (AnnotationWireDto row in rows)
        {
            projected.Add(row.ToRow().ToDataAnnotation());
        }

        return projected;
    }

    /// <inheritdoc />
    public async Task CreateAsync(CreateAnnotationInput input, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(input);

        var payload = new CreateWireDto
        {
            VehicleId = input.VehicleId,
            OccurredAt = input.OccurredAt,
            Category = AnnotationCategories.ToWire(input.Category),
            Title = input.Title,
            Description = input.Description,
            Scope = input.Scope,
        };

        string json = JsonSerializer.Serialize(payload, JsonOptions);
        using var message = new HttpRequestMessage(HttpMethod.Post, BuildUri("annotations"))
        {
            Content = new StringContent(json, Encoding.UTF8, "application/json"),
        };
        await AuthorizeAsync(message, cancellationToken).ConfigureAwait(false);

        using var response = await _http.SendAsync(message, cancellationToken).ConfigureAwait(false);
        response.EnsureSuccessStatusCode();
    }

    /// <inheritdoc />
    public async Task DeleteAsync(long id, CancellationToken cancellationToken = default)
    {
        string path = "annotations/" + id.ToString(CultureInfo.InvariantCulture);
        using var message = new HttpRequestMessage(HttpMethod.Delete, BuildUri(path));
        await AuthorizeAsync(message, cancellationToken).ConfigureAwait(false);

        using var response = await _http.SendAsync(message, cancellationToken).ConfigureAwait(false);
        response.EnsureSuccessStatusCode();
    }

    private static string BuildQuery(int? vehicleId, string scope)
    {
        // web buildQuery: vehicle_id only when non-null, scope only when truthy; snake_case params (no double prefix).
        var parts = new List<string>(2);
        if (vehicleId is { } id)
        {
            parts.Add("vehicle_id=" + Uri.EscapeDataString(id.ToString(CultureInfo.InvariantCulture)));
        }

        if (!string.IsNullOrEmpty(scope))
        {
            parts.Add("scope=" + Uri.EscapeDataString(scope));
        }

        return parts.Count == 0 ? string.Empty : "?" + string.Join("&", parts);
    }

    private async Task AuthorizeAsync(HttpRequestMessage message, CancellationToken cancellationToken)
    {
        var token = await _tokenProvider.GetTokenAsync(cancellationToken).ConfigureAwait(false);
        if (!string.IsNullOrEmpty(token))
        {
            message.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        }
    }

    private Uri BuildUri(string relativePath)
    {
        string versioned = _options.VersionBasePath.TrimEnd('/') + "/" + relativePath;
        return new Uri(_http.BaseAddress ?? _options.BaseAddress, versioned);
    }

    private sealed class AnnotationWireDto
    {
        [JsonPropertyName("id")]
        public long Id { get; set; }

        [JsonPropertyName("vehicle_id")]
        public int? VehicleId { get; set; }

        [JsonPropertyName("occurred_at")]
        public string OccurredAt { get; set; } = string.Empty;

        [JsonPropertyName("category")]
        public string? Category { get; set; }

        [JsonPropertyName("title")]
        public string Title { get; set; } = string.Empty;

        [JsonPropertyName("description")]
        public string? Description { get; set; }

        [JsonPropertyName("scope")]
        public List<string>? Scope { get; set; }

        [JsonPropertyName("color")]
        public string? Color { get; set; }

        [JsonPropertyName("created_at")]
        public string CreatedAt { get; set; } = string.Empty;

        [JsonPropertyName("updated_at")]
        public string UpdatedAt { get; set; } = string.Empty;

        public ChartAnnotationRow ToRow() => new(
            Id: Id,
            VehicleId: VehicleId,
            OccurredAt: OccurredAt,
            Category: AnnotationCategories.FromWire(Category),
            Title: Title,
            Description: Description,
            Scope: Scope ?? new List<string>(),
            Color: Color,
            CreatedAt: CreatedAt,
            UpdatedAt: UpdatedAt);
    }

    private sealed class CreateWireDto
    {
        [JsonPropertyName("vehicle_id")]
        public int? VehicleId { get; set; }

        [JsonPropertyName("occurred_at")]
        public string OccurredAt { get; set; } = string.Empty;

        [JsonPropertyName("category")]
        public string Category { get; set; } = string.Empty;

        [JsonPropertyName("title")]
        public string Title { get; set; } = string.Empty;

        [JsonPropertyName("description")]
        public string? Description { get; set; }

        [JsonPropertyName("scope")]
        public IReadOnlyList<string> Scope { get; set; } = Array.Empty<string>();
    }
}

/// <summary>
/// An in-memory <see cref="IChartAnnotationSource"/> for headless tests and isolated hosts. It mirrors the web
/// store's vehicle-plus-fleet-wide read semantics (a fetch returns rows whose vehicle matches the requested
/// vehicle OR is fleet-wide, in the requested scope) and records call counts so the annotation flow is asserted
/// without a socket.
/// </summary>
public sealed class InMemoryChartAnnotationSource : IChartAnnotationSource
{
    private readonly List<ChartAnnotationRow> _rows;
    private long _nextId;

    /// <summary>Creates the store seeded with optional rows.</summary>
    /// <param name="seed">The initial rows (copied).</param>
    public InMemoryChartAnnotationSource(IEnumerable<ChartAnnotationRow>? seed = null)
    {
        _rows = seed is null ? new List<ChartAnnotationRow>() : new List<ChartAnnotationRow>(seed);
        _nextId = _rows.Count == 0 ? 1 : _rows[^1].Id + 1;
    }

    /// <summary>Number of <see cref="FetchAsync"/> calls.</summary>
    public int FetchCount { get; private set; }

    /// <summary>Number of <see cref="CreateAsync"/> calls.</summary>
    public int CreateCount { get; private set; }

    /// <summary>Number of <see cref="DeleteAsync"/> calls.</summary>
    public int DeleteCount { get; private set; }

    /// <summary>The last <see cref="CreateAnnotationInput"/> passed to <see cref="CreateAsync"/>, or null.</summary>
    public CreateAnnotationInput? LastCreated { get; private set; }

    /// <summary>The last id passed to <see cref="DeleteAsync"/>, or null.</summary>
    public long? LastDeleted { get; private set; }

    /// <inheritdoc />
    public Task<IReadOnlyList<ChartDataAnnotation>> FetchAsync(
        int? vehicleId,
        string scope,
        CancellationToken cancellationToken = default)
    {
        FetchCount++;
        var matches = new List<ChartDataAnnotation>();
        foreach (ChartAnnotationRow row in _rows)
        {
            bool vehicleMatch = row.VehicleId is null || row.VehicleId == vehicleId;
            bool scopeMatch = string.IsNullOrEmpty(scope) || row.Scope.Contains(scope);
            if (vehicleMatch && scopeMatch)
            {
                matches.Add(row.ToDataAnnotation());
            }
        }

        return Task.FromResult<IReadOnlyList<ChartDataAnnotation>>(matches);
    }

    /// <inheritdoc />
    public Task CreateAsync(CreateAnnotationInput input, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(input);
        CreateCount++;
        LastCreated = input;
        long id = _nextId++;
        _rows.Add(new ChartAnnotationRow(
            Id: id,
            VehicleId: input.VehicleId,
            OccurredAt: input.OccurredAt,
            Category: input.Category,
            Title: input.Title,
            Description: input.Description,
            Scope: input.Scope,
            Color: null,
            CreatedAt: input.OccurredAt,
            UpdatedAt: input.OccurredAt));
        return Task.CompletedTask;
    }

    /// <inheritdoc />
    public Task DeleteAsync(long id, CancellationToken cancellationToken = default)
    {
        DeleteCount++;
        LastDeleted = id;
        _rows.RemoveAll(r => r.Id == id);
        return Task.CompletedTask;
    }
}

/// <summary>
/// Persistence seam for the per-chart "Hide annotations" toggle (P1/S8) — the native analogue of the web
/// <c>readHiddenPref</c> / <c>writeHiddenPref</c> localStorage helpers
/// (web/src/components/charts/ChartContainer.tsx). The canonical key is composed by
/// <see cref="HiddenPreference.StorageKey"/>; implementations degrade silently when storage is unavailable
/// (matching the web <c>try/catch</c>). The headless default is <see cref="InMemoryAnnotationHiddenStore"/>; the
/// app wires a durable, settings-backed store at composition.
/// </summary>
public interface IAnnotationHiddenStore
{
    /// <summary>Whether annotations are hidden for the chart key (web <c>readHiddenPref</c>).</summary>
    /// <param name="annotationKey">The per-chart annotation key (chart id or title).</param>
    /// <returns>True when the toggle was persisted as hidden.</returns>
    bool IsHidden(string annotationKey);

    /// <summary>Persist the hidden toggle for the chart key (web <c>writeHiddenPref</c>).</summary>
    /// <param name="annotationKey">The per-chart annotation key.</param>
    /// <param name="hidden">The new hidden state.</param>
    void SetHidden(string annotationKey, bool hidden);
}

/// <summary>
/// An in-memory <see cref="IAnnotationHiddenStore"/> for headless tests and isolated hosts. Stores the toggle
/// under the canonical <see cref="HiddenPreference.StorageKey"/> so the key arithmetic is exercised exactly as the
/// durable store does, but is intentionally non-durable.
/// </summary>
public sealed class InMemoryAnnotationHiddenStore : IAnnotationHiddenStore
{
    private readonly HashSet<string> _hiddenKeys = new(StringComparer.Ordinal);

    /// <inheritdoc />
    public bool IsHidden(string annotationKey) => _hiddenKeys.Contains(HiddenPreference.StorageKey(annotationKey));

    /// <inheritdoc />
    public void SetHidden(string annotationKey, bool hidden)
    {
        string key = HiddenPreference.StorageKey(annotationKey);
        if (hidden)
        {
            _hiddenKeys.Add(key);
        }
        else
        {
            _hiddenKeys.Remove(key);
        }
    }
}
