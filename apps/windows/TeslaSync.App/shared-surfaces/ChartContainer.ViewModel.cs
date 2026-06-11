using System.ComponentModel;
using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces.ChartContainerSurface;

/// <summary>
/// The UI-thread-free state holder backing the WinUI <c>ChartContainer</c> view — the native composition of the
/// web ChartContainer's component state plus the annotation hooks it owns
/// (web/src/components/charts/ChartContainer.tsx, web/src/api/hooks/useAnnotations.ts). It projects the localized
/// chrome labels, derives the mutually-exclusive body state from the loading / empty inputs, gates the export
/// menu, and — when the surface opts into annotations — drives the full annotation flow through the injected
/// <see cref="IChartAnnotationSource"/> and <see cref="IAnnotationHiddenStore"/> seams: fetch, add, delete, and the
/// persisted hide toggle. It performs no HTTP and references no view framework, so every transition is asserted
/// headlessly. Drive it from one confinement (the UI thread); the annotation fetch's background continuation may
/// raise change notifications, and marshalling onto the UI thread is the mounted view's responsibility (mirroring
/// how React reconciles the hook's setState).
/// </summary>
public sealed class ChartContainerViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IChartAnnotationSource _annotationSource;
    private readonly IAnnotationHiddenStore _hiddenStore;
    private readonly ChartContainerOptions _options;
    private readonly HiddenSeriesState? _hiddenSeries;

    private bool _loading;
    private bool _empty;
    private bool _hidden;
    private bool _popoverOpen;
    private IReadOnlyList<ChartDataAnnotation> _fetchedAnnotations = Array.Empty<ChartDataAnnotation>();
    private CancellationTokenSource? _loadCts;
    private bool _disposed;

    /// <summary>Creates the holder over its annotation source, hidden-toggle store, localizer and options.</summary>
    /// <param name="annotationSource">The durable annotation data seam (web annotation hooks); never opened by the view.</param>
    /// <param name="hiddenStore">The persisted hide-toggle store (web localStorage helpers).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="options">The immutable composition inputs (web props other than the chart body itself).</param>
    public ChartContainerViewModel(
        IChartAnnotationSource annotationSource,
        IAnnotationHiddenStore hiddenStore,
        ILocalizer localizer,
        ChartContainerOptions options)
    {
        ArgumentNullException.ThrowIfNull(annotationSource);
        ArgumentNullException.ThrowIfNull(hiddenStore);
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(options);

        _annotationSource = annotationSource;
        _hiddenStore = hiddenStore;
        _options = options;
        Display = ChartContainerProjection.Project(localizer);

        _loading = options.Loading;
        _empty = options.Empty;

        // web: useState(() => readHiddenPref(annotationKey)). Only meaningful when annotations are enabled.
        _hidden = AnnotationsEnabled && hiddenStore.IsHidden(AnnotationKey);

        // web: chartKey opts the chart into useHiddenSeries(chartKey); otherwise the render-prop hiddenSeries is null.
        _hiddenSeries = string.IsNullOrEmpty(options.ChartKey) ? null : new HiddenSeriesState(options.ChartKey!);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The projected, localized chrome labels (web <c>t('…')</c> call sites).</summary>
    public ChartContainerDisplay Display { get; }

    /// <summary>The immutable composition inputs.</summary>
    public ChartContainerOptions Options => _options;

    /// <summary>The chart heading (web <c>title</c>).</summary>
    public string Title => _options.Title;

    /// <summary>The optional sub-heading (web <c>subtitle</c>).</summary>
    public string? Subtitle => _options.Subtitle;

    /// <summary>The required accessible name for the chart figure (web <c>ariaLabel</c>).</summary>
    public string AriaLabel => _options.AriaLabel;

    /// <summary>The optional long description wired to the accessible figcaption (web <c>ariaDescription</c>).</summary>
    public string? AriaDescription => _options.AriaDescription;

    /// <summary>The fixed body height in effective pixels (web <c>height</c>).</summary>
    public double Height => _options.Height;

    /// <summary>Whether the surface owns the annotation flow (web <c>annotationsEnabled = annotationsConfig != null</c>).</summary>
    public bool AnnotationsEnabled => _options.Annotations is not null;

    /// <summary>The annotation-integration config, or null (web <c>annotationsConfig</c>).</summary>
    public ChartAnnotationsConfig? AnnotationConfig => _options.Annotations;

    /// <summary>The hide-toggle persistence key (web <c>annotationsConfig?.chartId ?? title</c>).</summary>
    public string AnnotationKey => _options.Annotations?.ChartId ?? _options.Title;

    /// <summary>Whether the chart is loading (web <c>loading</c> prop).</summary>
    public bool Loading
    {
        get => _loading;
        set
        {
            if (Set(ref _loading, value))
            {
                Raise(nameof(BodyState));
                Raise(nameof(ShowExportMenu));
            }
        }
    }

    /// <summary>Whether the chart resolved to no data (web <c>empty</c> prop).</summary>
    public bool Empty
    {
        get => _empty;
        set
        {
            if (Set(ref _empty, value))
            {
                Raise(nameof(BodyState));
                Raise(nameof(ShowExportMenu));
            }
        }
    }

    /// <summary>The mutually-exclusive chart body (web <c>loading ? spinner : empty ? emptyState : children</c>).</summary>
    public ChartBodyState BodyState =>
        _loading ? ChartBodyState.Loading : _empty ? ChartBodyState.Empty : ChartBodyState.Ready;

    /// <summary>Whether the annotation overlay is toggled off (web <c>hidden</c> state).</summary>
    public bool Hidden => _hidden;

    /// <summary>Whether the add-annotation popover is open (web <c>popoverOpen</c> state).</summary>
    public bool PopoverOpen => _popoverOpen;

    /// <summary>The fetched annotations for this chart's scope (web <c>fetchedAnnotations</c>).</summary>
    public IReadOnlyList<ChartDataAnnotation> FetchedAnnotations => _fetchedAnnotations;

    /// <summary>
    /// The annotations to overlay — collapses to empty whenever annotations are off or the user toggled them
    /// hidden (web <c>annotationsEnabled &amp;&amp; !hidden ? fetchedAnnotations : []</c>).
    /// </summary>
    public IReadOnlyList<ChartDataAnnotation> VisibleAnnotations =>
        AnnotationsEnabled && !_hidden ? _fetchedAnnotations : Array.Empty<ChartDataAnnotation>();

    /// <summary>
    /// Whether the export menu is shown — only when exportable and there is something to capture (web
    /// <c>showExportMenu = exportableResolved &amp;&amp; !loading &amp;&amp; !empty</c>).
    /// </summary>
    public bool ShowExportMenu => _options.Exportable && !_loading && !_empty;

    /// <summary>Whether a fullscreen toggle is offered (web <c>fullscreen</c> prop).</summary>
    public bool ShowFullscreen => _options.Fullscreen;

    /// <summary>The base file name for exports (web <c>exportFilename ?? title</c>).</summary>
    public string ExportFileName => string.IsNullOrEmpty(_options.ExportFileName) ? _options.Title : _options.ExportFileName!;

    /// <summary>
    /// Whether the mobile annotation marker chips are shown (web <c>showMarkerRow = annotationsEnabled &amp;&amp;
    /// !hidden &amp;&amp; visibleAnnotations.length &gt; 0</c>).
    /// </summary>
    public bool ShowMarkerRow => AnnotationsEnabled && !_hidden && VisibleAnnotations.Count > 0;

    /// <summary>
    /// Whether the annotation list footer is shown (web <c>annotationsEnabled &amp;&amp;
    /// fetchedAnnotations.length &gt; 0</c>).
    /// </summary>
    public bool AnnotationListVisible => AnnotationsEnabled && _fetchedAnnotations.Count > 0;

    /// <summary>The URL-persisted hidden-series legend state, or null when no chart key was supplied (web <c>hiddenSeries</c>).</summary>
    public HiddenSeriesState? HiddenSeries => _hiddenSeries;

    /// <summary>The fallback-table rows (web <c>data</c>), never null.</summary>
    public IReadOnlyList<ChartDataRow> Data => _options.Data ?? Array.Empty<ChartDataRow>();

    /// <summary>The fallback-table columns (web <c>dataColumns</c>), never null.</summary>
    public IReadOnlyList<ChartDataColumn> DataColumns => _options.DataColumns ?? Array.Empty<ChartDataColumn>();

    /// <summary>Whether the accessible fallback <c>&lt;table&gt;</c> can be rendered (web <c>hasFallbackTable</c>).</summary>
    public bool HasFallbackTable => ChartFallbackTable.HasTable(_options.Data, _options.DataColumns);

    /// <summary>Whether the figcaption shows the prose description (web <c>ariaDescription &amp;&amp; …</c>).</summary>
    public bool ShowFallbackDescription => !string.IsNullOrEmpty(AriaDescription);

    /// <summary>
    /// Whether the figcaption shows the bare summary — only when there is neither a table nor a description (web
    /// <c>hasFallbackTable ? table : !ariaDescription ? summary : null</c>).
    /// </summary>
    public bool ShowFallbackSummary => !HasFallbackTable && string.IsNullOrEmpty(AriaDescription);

    /// <summary>The fallback-table caption for this chart (web <c>{{title}} — data table</c>).</summary>
    /// <returns>The interpolated caption.</returns>
    public string FallbackTableLabel() => Display.FallbackTableLabel(Title);

    /// <summary>The bare accessible summary for this chart (web <c>Chart: {{title}}</c>).</summary>
    /// <returns>The interpolated summary.</returns>
    public string AccessibleSummary() => Display.Summary(Title);

    /// <summary>The Narrator name for the hide / show toggle, reflecting the current state (web <c>aria-label</c>).</summary>
    public string ToggleAnnotationsLabel => _hidden ? Display.ShowAnnotations : Display.HideAnnotations;

    /// <summary>
    /// Fetch the annotations for this chart's scope (web <c>useChartAnnotationsAsData</c>'s query). A no-op when
    /// annotations are not enabled. The fetch runs on a background flow; a transport / decode failure degrades
    /// silently to the current list (the web query simply renders no overlay on error), and a cancelled fetch is
    /// swallowed.
    /// </summary>
    /// <param name="cancellationToken">Cancels the fetch.</param>
    /// <returns>A task that completes when the fetch settles.</returns>
    public async Task LoadAnnotationsAsync(CancellationToken cancellationToken = default)
    {
        if (_disposed || !AnnotationsEnabled || _options.Annotations is not { } config)
        {
            return;
        }

        var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        CancellationTokenSource? previous = _loadCts;
        _loadCts = cts;
        previous?.Cancel();
        previous?.Dispose();

        try
        {
            IReadOnlyList<ChartDataAnnotation> rows =
                await _annotationSource.FetchAsync(config.VehicleId, config.Scope, cts.Token).ConfigureAwait(false);
            SetFetched(rows);
        }
        catch (OperationCanceledException)
        {
            // A superseded or disposed fetch returns quietly, never an error surface (web AbortController).
        }
        catch (HttpRequestException)
        {
            // web: a failed annotations query renders no overlay; the chart itself is unaffected.
        }
        catch (JsonException)
        {
            // Malformed annotation payload degrades to no overlay rather than tearing down the chart.
        }
        catch (IOException)
        {
            // A dropped connection mid-stream degrades to no overlay.
        }
    }

    /// <summary>
    /// Toggle the annotation overlay's visibility and persist the new state (web <c>toggleHidden</c> +
    /// <c>writeHiddenPref</c>). A no-op when annotations are not enabled.
    /// </summary>
    public void ToggleHidden()
    {
        if (!AnnotationsEnabled)
        {
            return;
        }

        bool next = !_hidden;
        _hiddenStore.SetHidden(AnnotationKey, next);
        if (Set(ref _hidden, next, nameof(Hidden)))
        {
            Raise(nameof(VisibleAnnotations));
            Raise(nameof(ShowMarkerRow));
            Raise(nameof(ToggleAnnotationsLabel));
        }
    }

    /// <summary>Open the add-annotation popover (web <c>setPopoverOpen(true)</c>).</summary>
    public void OpenPopover() => Set(ref _popoverOpen, true, nameof(PopoverOpen));

    /// <summary>Close the add-annotation popover (web <c>setPopoverOpen(false)</c>).</summary>
    public void ClosePopover() => Set(ref _popoverOpen, false, nameof(PopoverOpen));

    /// <summary>
    /// Create an annotation, then refresh the list (web <c>handleAddAnnotation</c> → <c>createMutation.mutate</c>
    /// → query invalidation). A no-op when annotations are disabled or no occurrence timestamp was supplied
    /// (web <c>if (!occurredAt) return;</c>); the scope is the single configured bucket (web <c>[config.scope]</c>).
    /// </summary>
    /// <param name="label">The annotation title (web <c>label</c>).</param>
    /// <param name="category">The colour-coding category.</param>
    /// <param name="description">Optional description.</param>
    /// <param name="occurredAt">The ISO occurrence timestamp; empty cancels the add.</param>
    /// <returns>A task that completes once the annotation is created and the list refreshed.</returns>
    public async Task AddAnnotationAsync(
        string label,
        AnnotationCategory category,
        string? description,
        string? occurredAt)
    {
        if (!AnnotationsEnabled || _options.Annotations is not { } config)
        {
            return;
        }

        if (string.IsNullOrEmpty(occurredAt))
        {
            return;
        }

        var input = new CreateAnnotationInput(
            VehicleId: config.VehicleId,
            OccurredAt: occurredAt,
            Category: category,
            Title: label,
            Description: description,
            Scope: new[] { config.Scope });

        await _annotationSource.CreateAsync(input).ConfigureAwait(false);
        ClosePopover();
        await LoadAnnotationsAsync().ConfigureAwait(false);
    }

    /// <summary>
    /// Remove an annotation by its (stringified) id, then refresh the list (web <c>handleRemoveAnnotation</c> →
    /// <c>deleteMutation.mutate</c>). Ignores a non-numeric or non-positive id (web
    /// <c>if (!Number.isFinite(numeric) || numeric &lt;= 0) return;</c>).
    /// </summary>
    /// <param name="id">The stringified backend id.</param>
    /// <returns>A task that completes once the annotation is removed and the list refreshed.</returns>
    public async Task RemoveAnnotationAsync(string id)
    {
        if (!long.TryParse(id, NumberStyles.Integer, CultureInfo.InvariantCulture, out long numeric) || numeric <= 0)
        {
            return;
        }

        await _annotationSource.DeleteAsync(numeric).ConfigureAwait(false);
        await LoadAnnotationsAsync().ConfigureAwait(false);
    }

    /// <summary>Cancel any in-flight annotation fetch (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        CancellationTokenSource? cts = _loadCts;
        _loadCts = null;
        if (cts is not null)
        {
            cts.Cancel();
            cts.Dispose();
        }
    }

    private void SetFetched(IReadOnlyList<ChartDataAnnotation> rows)
    {
        _fetchedAnnotations = rows;
        Raise(nameof(FetchedAnnotations));
        Raise(nameof(VisibleAnnotations));
        Raise(nameof(ShowMarkerRow));
        Raise(nameof(AnnotationListVisible));
    }

    private bool Set<T>(ref T field, T value, [CallerMemberName] string? propertyName = null)
    {
        if (EqualityComparer<T>.Default.Equals(field, value))
        {
            return false;
        }

        field = value;
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));
        return true;
    }

    private void Raise(string propertyName) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));
}
