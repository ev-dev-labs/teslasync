using System.ComponentModel;
using System.Globalization;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>One dropdown choice — the canonical wire <see cref="Value"/> plus its localized <see cref="Label"/>.</summary>
public sealed record ComputedMetricOption(string Value, string Label);

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="ComputedMetricEditor"/> view — the native port
/// of the web <c>ComputedMetricEditor</c>'s hook composition
/// (web/src/features/notifications/components/ComputedMetricEditor.tsx). It owns the editor's working value
/// (metric / window / operator / raw threshold / vehicle scope), composes the two data sources (the metric
/// registry read and the live preview render), and exposes the catalog + preview states plus the derived,
/// display-ready dropdown options so the view is a thin renderer. Drive it from one confinement (the UI
/// thread); it is not internally synchronised.
/// </summary>
public sealed class ComputedMetricEditorViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IComputedMetricCatalogSource _catalogSource;
    private readonly IComputedMetricPreviewSource _previewSource;
    private readonly ILocalizer _localizer;
    private readonly Func<CancellationToken, Task> _previewDelay;

    // Working value (web ComputedMetricEditorValue).
    private string _metricId;
    private string _metricWindow;
    private string _metricOp;
    private string _metricThreshold;
    private long? _vehicleId;

    // Metric registry (cache-then-network).
    private IReadOnlyList<ComputedMetricSummary> _allMetrics = Array.Empty<ComputedMetricSummary>();
    private ComputedMetricCatalogState _catalogState = ComputedMetricCatalogState.Loading;
    private string? _catalogError;

    // Derived collections (web useMemo).
    private ComputedMetricSummary? _selected;
    private IReadOnlyList<ComputedMetricOption> _metricOptions = Array.Empty<ComputedMetricOption>();
    private IReadOnlyList<ComputedMetricOption> _windowOptions = Array.Empty<ComputedMetricOption>();
    private IReadOnlyList<ComputedMetricOption> _opOptions = Array.Empty<ComputedMetricOption>();

    // Live preview.
    private ComputedMetricPreviewState _previewState = ComputedMetricPreviewState.Idle;
    private ComputedMetricPreview? _previewResult;
    private string? _previewError;
    private string? _previewValueText;
    private string? _lastPreviewKey;

    private CancellationTokenSource? _metricsCts;
    private CancellationTokenSource? _previewCts;
    private bool _disposed;

    /// <summary>Creates the holder over its two data sources, the localizer and an initial editor value.</summary>
    /// <param name="catalogSource">Computed-metric registry source.</param>
    /// <param name="previewSource">Live preview render source.</param>
    /// <param name="localizer">i18n facade.</param>
    /// <param name="initialValue">The initial editor value (<see cref="ComputedMetricEditorValue.Empty"/> when null).</param>
    /// <param name="previewDelay">Debounce delay for the preview render (default 150 ms; pass a no-op in tests).</param>
    public ComputedMetricEditorViewModel(
        IComputedMetricCatalogSource catalogSource,
        IComputedMetricPreviewSource previewSource,
        ILocalizer localizer,
        ComputedMetricEditorValue? initialValue = null,
        Func<CancellationToken, Task>? previewDelay = null)
    {
        ArgumentNullException.ThrowIfNull(catalogSource);
        ArgumentNullException.ThrowIfNull(previewSource);
        ArgumentNullException.ThrowIfNull(localizer);

        _catalogSource = catalogSource;
        _previewSource = previewSource;
        _localizer = localizer;

        var value = initialValue ?? ComputedMetricEditorValue.Empty;
        _metricId = value.MetricId;
        _metricWindow = value.MetricWindow;
        _metricOp = value.MetricOp;
        _metricThreshold = value.MetricThreshold;
        _vehicleId = value.VehicleId;

        _previewDelay = previewDelay ?? (ct => Task.Delay(150, ct));
        RecomputeDerived();
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>Raised whenever the editor's working value changes (the native analogue of the web <c>onChange</c>).</summary>
    public event EventHandler<ComputedMetricEditorValue>? ValueChanged;

    /// <summary>The i18n facade (the view composes static labels through <see cref="ComputedMetricEditorText"/>).</summary>
    public ILocalizer Localizer => _localizer;

    // ──────────────── Working value ────────────────

    /// <summary>The selected metric id.</summary>
    public string MetricId => _metricId;

    /// <summary>The selected aggregation window.</summary>
    public string MetricWindow => _metricWindow;

    /// <summary>The selected comparison operator.</summary>
    public string MetricOp => _metricOp;

    /// <summary>The raw threshold text (web parity: the field keeps the user's exact string).</summary>
    public string MetricThreshold => _metricThreshold;

    /// <summary>The optional vehicle scope forwarded to the preview endpoint.</summary>
    public long? VehicleId => _vehicleId;

    /// <summary>The current editor value (the payload raised through <see cref="ValueChanged"/>).</summary>
    public ComputedMetricEditorValue Value =>
        new(_metricId, _metricWindow, _metricOp, _metricThreshold, _vehicleId);

    // ──────────────── Metric registry ────────────────

    /// <summary>The metric registry load state (drives the loading / empty / error / stale / offline surfaces).</summary>
    public ComputedMetricCatalogState CatalogState
    {
        get => _catalogState;
        private set
        {
            if (Set(ref _catalogState, value))
            {
                Raise(nameof(MetricsLoading));
                Raise(nameof(MetricEnabled));
                Raise(nameof(MetricPrompt));
            }
        }
    }

    /// <summary>Localized detail for a failed / offline registry load (the classified error message).</summary>
    public string? CatalogError
    {
        get => _catalogError;
        private set => Set(ref _catalogError, value);
    }

    /// <summary>True while the registry has no rows and is still loading (web metric-query loading flag).</summary>
    public bool MetricsLoading => _catalogState == ComputedMetricCatalogState.Loading;

    /// <summary>The metric registry rows currently available.</summary>
    public IReadOnlyList<ComputedMetricSummary> Metrics => _allMetrics;

    // ──────────────── Derived collections ────────────────

    /// <summary>The metric matching <see cref="MetricId"/>, when present (web <c>selected</c>).</summary>
    public ComputedMetricSummary? Selected => _selected;

    /// <summary>The metric dropdown options (web <c>metricOptions</c>).</summary>
    public IReadOnlyList<ComputedMetricOption> MetricOptions => _metricOptions;

    /// <summary>The window dropdown options for the selected metric (web <c>windowOptions</c>).</summary>
    public IReadOnlyList<ComputedMetricOption> WindowOptions => _windowOptions;

    /// <summary>The operator dropdown options (selected metric's ops, else all ops; web <c>opOptions</c>).</summary>
    public IReadOnlyList<ComputedMetricOption> OpOptions => _opOptions;

    /// <summary>Whether the metric dropdown is interactive (web <c>disabled={loading}</c> inverted).</summary>
    public bool MetricEnabled => _catalogState != ComputedMetricCatalogState.Loading;

    /// <summary>Whether the window dropdown is interactive (web <c>disabled={!selected}</c> inverted).</summary>
    public bool WindowEnabled => _selected is not null;

    /// <summary>Whether the operator dropdown is interactive (web <c>disabled={!selected}</c> inverted).</summary>
    public bool OpEnabled => _selected is not null;

    /// <summary>The metric dropdown prompt ("Loading metrics…" while loading, else "Choose a metric").</summary>
    public string MetricPrompt => MetricsLoading
        ? ComputedMetricEditorText.LoadingMetrics(_localizer)
        : ComputedMetricEditorText.MetricPrompt(_localizer);

    /// <summary>
    /// Whether the editor has enough input to preview (web <c>ready</c>): a metric, a window, an operator
    /// and a finite numeric threshold.
    /// </summary>
    public bool Ready =>
        !string.IsNullOrEmpty(_metricId) &&
        !string.IsNullOrEmpty(_metricWindow) &&
        !string.IsNullOrEmpty(_metricOp) &&
        TryParseLeadingDouble(_metricThreshold, out _);

    // ──────────────── Live preview ────────────────

    /// <summary>The live-preview pane state (idle / loading / rendered / error).</summary>
    public ComputedMetricPreviewState PreviewState
    {
        get => _previewState;
        private set => Set(ref _previewState, value);
    }

    /// <summary>Localized error text for a failed preview render.</summary>
    public string? PreviewError
    {
        get => _previewError;
        private set => Set(ref _previewError, value);
    }

    /// <summary>The composed "Right now this metric is …" sentence when a verdict is available.</summary>
    public string? PreviewValueText => _previewValueText;

    // ──────────────── Loading ────────────────

    /// <summary>Start the editor: load the metric registry and fire the first preview render when ready.</summary>
    public Task LoadAsync(CancellationToken cancellationToken = default)
    {
        var metrics = ReloadMetricsAsync(cancellationToken);
        SchedulePreviewRefresh();
        return metrics;
    }

    /// <summary>(Re)load the metric registry as a cache-then-network stream (the retry path).</summary>
    public async Task ReloadMetricsAsync(CancellationToken cancellationToken = default)
    {
        var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var previous = Interlocked.Exchange(ref _metricsCts, cts);
        previous?.Cancel();
        previous?.Dispose();

        if (_allMetrics.Count == 0)
        {
            CatalogState = ComputedMetricCatalogState.Loading;
        }

        try
        {
            await foreach (var result in _catalogSource.StreamAsync(cts.Token).ConfigureAwait(false))
            {
                ApplyCatalog(result);
            }
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer load (or disposed) — drop silently.
        }
    }

    // ──────────────── Edits ────────────────

    /// <summary>Select a metric (web <c>handleMetric</c>): reset the window/operator to the metric's first valid pair.</summary>
    public void SelectMetric(string id)
    {
        ArgumentNullException.ThrowIfNull(id);
        var def = FindMetric(id);
        _metricId = id;
        _metricWindow = def is not null && def.Windows.Count > 0 ? def.Windows[0] : string.Empty;
        _metricOp = def is not null && def.Ops.Count > 0 ? def.Ops[0] : _metricOp;
        PreviewError = null;
        RaiseValueProperties();
        RecomputeDerived();
        RaiseValueChanged();
        SchedulePreviewRefresh();
    }

    /// <summary>Set the aggregation window.</summary>
    public void SetWindow(string window)
    {
        ArgumentNullException.ThrowIfNull(window);
        if (string.Equals(_metricWindow, window, StringComparison.Ordinal))
        {
            return;
        }

        _metricWindow = window;
        Raise(nameof(MetricWindow));
        Raise(nameof(Ready));
        RaiseValueChanged();
        SchedulePreviewRefresh();
    }

    /// <summary>Set the comparison operator.</summary>
    public void SetOperator(string op)
    {
        ArgumentNullException.ThrowIfNull(op);
        if (string.Equals(_metricOp, op, StringComparison.Ordinal))
        {
            return;
        }

        _metricOp = op;
        Raise(nameof(MetricOp));
        Raise(nameof(Ready));
        RaiseValueChanged();
        SchedulePreviewRefresh();
    }

    /// <summary>Set the raw threshold text.</summary>
    public void SetThreshold(string rawThreshold)
    {
        ArgumentNullException.ThrowIfNull(rawThreshold);
        if (string.Equals(_metricThreshold, rawThreshold, StringComparison.Ordinal))
        {
            return;
        }

        _metricThreshold = rawThreshold;
        Raise(nameof(MetricThreshold));
        Raise(nameof(Ready));
        RaiseValueChanged();
        SchedulePreviewRefresh();
    }

    /// <summary>Set the optional vehicle scope forwarded to the preview endpoint.</summary>
    public void SetVehicleId(long? vehicleId)
    {
        if (_vehicleId == vehicleId)
        {
            return;
        }

        _vehicleId = vehicleId;
        Raise(nameof(VehicleId));
        RaiseValueChanged();
        SchedulePreviewRefresh();
    }

    /// <summary>Render the preview immediately (bypassing the debounce) and fold the outcome into the preview state.</summary>
    public async Task RefreshPreviewNowAsync(CancellationToken cancellationToken = default)
    {
        if (!Ready)
        {
            _previewResult = null;
            _lastPreviewKey = null;
            PreviewError = null;
            SetPreviewValueText(null);
            PreviewState = ComputedMetricPreviewState.Idle;
            return;
        }

        if (!TryParseLeadingDouble(_metricThreshold, out var threshold))
        {
            // Unreachable while Ready (which requires a finite threshold), but keeps the parse result used.
            return;
        }

        var request = ComputedMetricPreviewRequest.From(Value, threshold);
        var key = request.DebounceKey();
        if (string.Equals(key, _lastPreviewKey, StringComparison.Ordinal) && _previewResult is not null)
        {
            return;
        }

        if (_previewResult is null)
        {
            PreviewState = ComputedMetricPreviewState.Loading;
        }

        var outcome = await _previewSource.PreviewAsync(request, cancellationToken).ConfigureAwait(false);
        cancellationToken.ThrowIfCancellationRequested();
        _lastPreviewKey = key;

        if (outcome.Success && outcome.Result is { } result)
        {
            _previewResult = result;
            PreviewError = null;
            SetPreviewValueText(ComposePreviewText(result));
            PreviewState = ComputedMetricPreviewState.Rendered;
        }
        else
        {
            SetPreviewValueText(null);
            PreviewError = ErrorTextFor(outcome.Error);
            PreviewState = ComputedMetricPreviewState.Error;
        }
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _metricsCts?.Cancel();
        _metricsCts?.Dispose();
        _previewCts?.Cancel();
        _previewCts?.Dispose();
        GC.SuppressFinalize(this);
    }

    // ──────────────── Stream folding ────────────────

    private void ApplyCatalog(RepositoryResult<IReadOnlyList<ComputedMetricSummary>> result)
    {
        switch (result.Status)
        {
            case LoadStatus.Loading:
                if (_allMetrics.Count == 0)
                {
                    CatalogState = ComputedMetricCatalogState.Loading;
                }

                break;

            case LoadStatus.Cached:
            case LoadStatus.Refreshing:
                SetMetrics(
                    result.Value!,
                    result.IsStale ? ComputedMetricCatalogState.Stale : ComputedMetricCatalogState.Loaded,
                    null);
                break;

            case LoadStatus.Loaded:
                SetMetrics(result.Value!, ComputedMetricCatalogState.Loaded, null);
                break;

            case LoadStatus.Empty:
                SetMetrics(Array.Empty<ComputedMetricSummary>(), ComputedMetricCatalogState.Empty, null);
                break;

            case LoadStatus.Offline:
                SetMetrics(result.Value!, ComputedMetricCatalogState.Offline, ErrorTextFor(result.Error));
                break;

            default:
                _allMetrics = Array.Empty<ComputedMetricSummary>();
                CatalogError = ErrorTextFor(result.Error);
                CatalogState = ComputedMetricCatalogState.Error;
                Raise(nameof(Metrics));
                RecomputeDerived();
                break;
        }
    }

    private void SetMetrics(
        IReadOnlyList<ComputedMetricSummary> metrics,
        ComputedMetricCatalogState state,
        string? error)
    {
        _allMetrics = metrics;
        CatalogError = error;
        CatalogState = metrics.Count == 0 && state == ComputedMetricCatalogState.Loaded
            ? ComputedMetricCatalogState.Empty
            : state;
        Raise(nameof(Metrics));
        RecomputeDerived();

        // Keep the rendered preview suffix in sync once the registry (and thus the selected unit) arrives.
        if (_previewResult is not null && _previewState == ComputedMetricPreviewState.Rendered)
        {
            SetPreviewValueText(ComposePreviewText(_previewResult));
        }
    }

    private void RecomputeDerived()
    {
        _selected = FindMetric(_metricId);
        _metricOptions = BuildMetricOptions();
        _windowOptions = BuildWindowOptions();
        _opOptions = BuildOpOptions();

        Raise(nameof(Selected));
        Raise(nameof(MetricOptions));
        Raise(nameof(WindowOptions));
        Raise(nameof(OpOptions));
        Raise(nameof(WindowEnabled));
        Raise(nameof(OpEnabled));
        Raise(nameof(Ready));
    }

    private ComputedMetricSummary? FindMetric(string id)
    {
        if (string.IsNullOrEmpty(id))
        {
            return null;
        }

        foreach (var metric in _allMetrics)
        {
            if (string.Equals(metric.Id, id, StringComparison.Ordinal))
            {
                return metric;
            }
        }

        return null;
    }

    private IReadOnlyList<ComputedMetricOption> BuildMetricOptions()
    {
        if (_allMetrics.Count == 0)
        {
            return Array.Empty<ComputedMetricOption>();
        }

        var options = new List<ComputedMetricOption>(_allMetrics.Count);
        foreach (var metric in _allMetrics)
        {
            options.Add(new ComputedMetricOption(
                metric.Id,
                ComputedMetricEditorText.MetricName(_localizer, metric.Id, metric.Label)));
        }

        return options;
    }

    private IReadOnlyList<ComputedMetricOption> BuildWindowOptions()
    {
        var windows = _selected?.Windows ?? Array.Empty<string>();
        if (windows.Count == 0)
        {
            return Array.Empty<ComputedMetricOption>();
        }

        var options = new List<ComputedMetricOption>(windows.Count);
        foreach (var window in windows)
        {
            options.Add(new ComputedMetricOption(window, ComputedMetricEditorText.MetricWindowLabel(_localizer, window)));
        }

        return options;
    }

    private IReadOnlyList<ComputedMetricOption> BuildOpOptions()
    {
        var ops = _selected is null ? ComputedMetricOps.All : _selected.Ops;
        if (ops.Count == 0)
        {
            return Array.Empty<ComputedMetricOption>();
        }

        var options = new List<ComputedMetricOption>(ops.Count);
        foreach (var op in ops)
        {
            options.Add(new ComputedMetricOption(op, ComputedMetricEditorText.MetricOpLabel(_localizer, op)));
        }

        return options;
    }

    // ──────────────── Preview plumbing ────────────────

    private void SchedulePreviewRefresh()
    {
        if (_disposed)
        {
            return;
        }

        var cts = new CancellationTokenSource();
        var previous = Interlocked.Exchange(ref _previewCts, cts);
        previous?.Cancel();
        previous?.Dispose();
        _ = DebouncedPreviewAsync(cts.Token);
    }

    private async Task DebouncedPreviewAsync(CancellationToken cancellationToken)
    {
        try
        {
            await _previewDelay(cancellationToken).ConfigureAwait(false);
            await RefreshPreviewNowAsync(cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer edit — drop silently.
        }
    }

    private string ComposePreviewText(ComputedMetricPreview result)
    {
        var value = NumberFormatting.Format(result.Value, null, 2);
        var rawSuffix = _selected is not null ? ComputedMetricUnits.Suffix(_selected.Unit) : string.Empty;
        var suffix = string.IsNullOrEmpty(rawSuffix) ? string.Empty : string.Concat(" ", rawSuffix);
        var verdict = result.WouldTrigger
            ? ComputedMetricEditorText.Would(_localizer)
            : ComputedMetricEditorText.WouldNot(_localizer);
        return ComputedMetricEditorText.PreviewValue(_localizer, value, suffix, verdict);
    }

    private string ErrorTextFor(RepositoryError? error) =>
        error?.Message ?? ComputedMetricEditorText.MetricsError(_localizer);

    private void SetPreviewValueText(string? text)
    {
        _previewValueText = text;
        Raise(nameof(PreviewValueText));
    }

    private void RaiseValueProperties()
    {
        Raise(nameof(MetricId));
        Raise(nameof(MetricWindow));
        Raise(nameof(MetricOp));
    }

    private void RaiseValueChanged()
    {
        Raise(nameof(Value));
        ValueChanged?.Invoke(this, Value);
    }

    /// <summary>JS <c>parseFloat</c> parity: parse the leading numeric prefix, succeeding only for a finite value.</summary>
    private static bool TryParseLeadingDouble(string? text, out double value)
    {
        value = double.NaN;
        if (string.IsNullOrEmpty(text))
        {
            return false;
        }

        var span = text.AsSpan();
        var i = 0;
        while (i < span.Length && char.IsWhiteSpace(span[i]))
        {
            i++;
        }

        var start = i;
        if (i < span.Length && (span[i] == '+' || span[i] == '-'))
        {
            i++;
        }

        var digitsBefore = 0;
        while (i < span.Length && span[i] is >= '0' and <= '9')
        {
            i++;
            digitsBefore++;
        }

        var digitsAfter = 0;
        if (i < span.Length && span[i] == '.')
        {
            i++;
            while (i < span.Length && span[i] is >= '0' and <= '9')
            {
                i++;
                digitsAfter++;
            }
        }

        if (digitsBefore == 0 && digitsAfter == 0)
        {
            return false;
        }

        var beforeExponent = i;
        if (i < span.Length && (span[i] == 'e' || span[i] == 'E'))
        {
            var j = i + 1;
            if (j < span.Length && (span[j] == '+' || span[j] == '-'))
            {
                j++;
            }

            var expDigits = 0;
            while (j < span.Length && span[j] is >= '0' and <= '9')
            {
                j++;
                expDigits++;
            }

            i = expDigits > 0 ? j : beforeExponent;
        }

        var numeric = span[start..i];
        return double.TryParse(numeric, NumberStyles.Float, CultureInfo.InvariantCulture, out value)
            && double.IsFinite(value);
    }

    private bool Set<T>(ref T field, T value, [CallerMemberName] string? name = null)
    {
        if (EqualityComparer<T>.Default.Equals(field, value))
        {
            return false;
        }

        field = value;
        Raise(name);
        return true;
    }

    private void Raise(string? name) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
