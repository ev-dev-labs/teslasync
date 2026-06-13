using System.ComponentModel;
using System.Globalization;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Telemetry;

/// <summary>
/// UI-thread-free state holder backing the WinUI <c>MQTTInspectorPage</c> view — the native port of the web page's
/// data flow (web/src/features/telemetry/pages/MQTTInspectorPage.tsx). It reads the Fleet Telemetry broker status
/// through the injected <see cref="IMqttStatusFeed"/> (web <c>useMQTTStatus</c>), accumulates the per-tick signal
/// throughput history exactly as the web <c>useEffect</c> does (skip the initial zero, append the non-negative delta,
/// keep the last 60 samples), and projects the combined result through <see cref="MqttInspectorProjection"/> so the
/// view is a thin renderer. It surfaces the three web data states (loading / empty / success) plus the failure banner
/// (web <c>error &amp;&amp; !status</c>) and an in-flight flag; observable so the view re-renders on
/// <see cref="PropertyChanged"/>. Drive it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class MQTTInspectorPageViewModel : INotifyPropertyChanged, IDisposable
{
    private const int MaxThroughputPoints = 60; // web throughputHistory.slice(-60)

    private readonly IMqttStatusFeed _feed;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _clock;
    private readonly MqttInspectorDiagnostics _diagnostics;
    private readonly List<ThroughputPoint> _throughput = [];

    private CancellationTokenSource? _cts;
    private bool _disposed;

    private bool _loading = true;
    private bool _hasError;
    private string? _errorDetail;
    private MqttStatusSnapshot _status = MqttStatusSnapshot.Empty;
    private long? _prevTotalSignals;

    private MqttInspectorState _state = MqttInspectorState.Loading;
    private MqttInspectorDisplay _display;
    private bool _isFetching;

    /// <summary>Creates the holder over its data feed, localizer and (optional) clock / diagnostics.</summary>
    /// <param name="feed">The broker-status data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="clock">Injectable clock for deterministic staleness / throughput timestamps in tests.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public MQTTInspectorPageViewModel(
        IMqttStatusFeed feed,
        ILocalizer localizer,
        Func<DateTimeOffset>? clock = null,
        MqttInspectorDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _feed = feed;
        _localizer = localizer;
        _clock = clock ?? (() => DateTimeOffset.Now);
        _diagnostics = diagnostics ?? new MqttInspectorDiagnostics();
        _display = MqttInspectorProjection.Project(BuildModel(), _localizer, _clock());
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current top-level data state (loading / empty / success).</summary>
    public MqttInspectorState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready content the view binds to.</summary>
    public MqttInspectorDisplay Display
    {
        get => _display;
        private set => Set(ref _display, value);
    }

    /// <summary>True while a (re)fetch is in flight (drives the auto-refresh indicator).</summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>The localized page title (web <c>mqtt.title</c>).</summary>
    public string Title => MqttInspectorRegistration.Title(_localizer);

    /// <summary>Record that the surface was opened (PII-safe diagnostics).</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();

    /// <summary>Run (or re-run) the broker-status read and fold the result into the throughput history + display.</summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        var cts = Supersede(ref _cts, cancellationToken);

        IsFetching = true;
        if (!_status.HasStatus)
        {
            _loading = true;
            Reproject();
        }

        try
        {
            var snapshot = await _feed.FetchAsync(cts.Token).ConfigureAwait(true);
            cts.Token.ThrowIfCancellationRequested();

            _status = snapshot;
            _hasError = false;
            _errorDetail = null;
            _loading = false;
            AccumulateThroughput(snapshot);
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer load (or disposed) — drop this result silently.
            return;
        }
        catch (Exception ex)
        {
            // web `error`: surface the failure banner only when there is no status at all; a prior snapshot persists
            // (react-query keeps the last successful data), so the panels keep rendering while the banner stays hidden.
            _hasError = true;
            _errorDetail = ex.Message;
            _loading = false;
        }

        IsFetching = false;
        Reproject();
    }

    /// <summary>Refresh the broker status (web auto-refetch / manual refresh).</summary>
    public Task RefreshAsync(CancellationToken cancellationToken = default) => LoadAsync(cancellationToken);

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        Cancel(ref _cts);
    }

    // web useEffect: skip the initial zero sample, append the non-negative delta of the running total, keep last 60.
    private void AccumulateThroughput(MqttStatusSnapshot snapshot)
    {
        long total = snapshot.TotalSignals;
        if (total == 0 && _prevTotalSignals is null)
        {
            return;
        }

        long delta = _prevTotalSignals is { } previous ? total - previous : 0;
        _prevTotalSignals = total;

        if (delta < 0)
        {
            return;
        }

        string timeLabel = _clock().ToString("HH:mm:ss", CultureInfo.CurrentCulture);
        _throughput.Add(new ThroughputPoint(timeLabel, Math.Max(delta, 0)));

        if (_throughput.Count > MaxThroughputPoints)
        {
            _throughput.RemoveRange(0, _throughput.Count - MaxThroughputPoints);
        }
    }

    private MqttInspectorModel BuildModel() =>
        new(_loading, _hasError, _errorDetail, _status, _throughput.ToArray());

    private void Reproject()
    {
        var display = MqttInspectorProjection.Project(BuildModel(), _localizer, _clock());
        Display = display;
        State = display.State;
    }

    private static CancellationTokenSource Supersede(ref CancellationTokenSource? slot, CancellationToken cancellationToken)
    {
        var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var previous = Interlocked.Exchange(ref slot, cts);
        previous?.Cancel();
        previous?.Dispose();
        return cts;
    }

    private static void Cancel(ref CancellationTokenSource? slot)
    {
        var cts = Interlocked.Exchange(ref slot, null);
        cts?.Cancel();
        cts?.Dispose();
    }

    private void Set<T>(ref T field, T value, [CallerMemberName] string? name = null)
    {
        if (EqualityComparer<T>.Default.Equals(field, value))
        {
            return;
        }

        field = value;
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
    }
}
