using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Layout;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 Ingest X-Ray header surface — a parity port of
/// web/src/features/admin/components/ingest-xray/XRayHeader.tsx. It composes the web's three
/// <c>StatCard</c>s in a responsive grid: "Total samples" (<c>fmtInt(total_samples)</c>), "Distinct fields"
/// (<c>fmtInt(unique_fields)</c>) and "Window" (the selected window label), each with a Fluent accent glyph
/// standing in for the web Lucide icon and a muted sub-line. The web component renders only the loading ('—')
/// versus populated value; this self-contained surface additionally renders the empty (zero-sample), stale,
/// offline and hard-error (retry) branches — every one visible, never a blank box. All data flows through the
/// shared <see cref="XRayHeaderViewModel"/>; the view never performs HTTP. Every string resolves through the
/// i18n facade, each stat card and the retry control carry a Narrator name, and state changes are announced
/// through a polite live region. The surface adds no custom motion, so reduced-motion is honoured by
/// construction.
/// </summary>
public sealed partial class XRayHeader : ContentControl, IDisposable
{
    private const string RetryGlyph = "\uE72C"; // Segoe Fluent — Refresh
    private const double CardMinWidth = 200;    // web sm:grid-cols-3 wrap threshold

    private readonly XRayHeaderViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly XRayHeaderDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly StackPanel _root = new() { Spacing = 12 };
    private readonly StackPanel _statusRow = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = 8,
        HorizontalAlignment = HorizontalAlignment.Right,
        VerticalAlignment = VerticalAlignment.Center,
    };
    private readonly TsGrid _grid = new() { Columns = 3, Gutter = 16, ItemMinWidth = CardMinWidth };
    private readonly TsStatCard _samplesCard = new();
    private readonly TsStatCard _fieldsCard = new();
    private readonly TsStatCard _windowCard = new();
    private readonly TsDataFreshness _freshness = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly TsButton _retryButton = new();
    private readonly TextBlock _status;

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;
    private string? _announced;

    /// <summary>Creates the surface over its data source, localizer and (optional) diagnostics.</summary>
    public XRayHeader(IXRayHeaderSource source, ILocalizer localizer, XRayHeaderDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new XRayHeaderDiagnostics();
        _viewModel = new XRayHeaderViewModel(source, localizer);
        _dispatcher = DispatcherQueue.GetForCurrentThread();
        _status = DisplayPrimitives.Caption();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        BuildChrome();
        AutomationProperties.SetName(this, _localizer.GetString("admin.xray.pageTitle", "Ingest X-Ray"));

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        _retryButton.Click += OnRetryClick;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>The canonical surface id (<c>ingest-xray-header</c>).</summary>
    public static string SurfaceId => XRayHeaderRegistration.Id;

    /// <summary>The diagnostics surface slug this view registers under (<c>XRayHeader</c>).</summary>
    public static string Slug => XRayHeaderRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting/diagnostics).</summary>
    public XRayHeaderViewModel ViewModel => _viewModel;

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="XRayHeaderSource"/> from the shared
    /// data layer (the host's P2-core dependencies) and points it at a vehicle + window + bucket + limit.
    /// </summary>
    public static XRayHeader Create(
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        int vehicleId,
        IngestXRayWindow window,
        IngestXRayBucket bucket,
        int limit,
        XRayHeaderDiagnostics? diagnostics = null)
    {
        var source = new XRayHeaderSource(api, engine, options);
        var view = new XRayHeader(source, localizer, diagnostics);
        view.Configure(vehicleId, window, bucket, limit);
        return view;
    }

    /// <summary>
    /// Point the surface at a vehicle + window + bucket + limit (web parity for the page's selections).
    /// Reloads immediately when the surface is already live.
    /// </summary>
    public void Configure(int vehicleId, IngestXRayWindow window, IngestXRayBucket bucket, int limit)
    {
        _viewModel.Configure(vehicleId, window, bucket, limit);
        if (_started)
        {
            _ = _viewModel.LoadAsync();
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
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _retryButton.Click -= OnRetryClick;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    private void BuildChrome()
    {
        _samplesCard.Label = _viewModel.SamplesLabel;
        _samplesCard.Sublabel = _viewModel.SamplesSublabel;
        _samplesCard.Glyph = XRayHeaderRegistration.SamplesGlyph;

        _fieldsCard.Label = _viewModel.FieldsLabel;
        _fieldsCard.Sublabel = _viewModel.FieldsSublabel;
        _fieldsCard.Glyph = XRayHeaderRegistration.FieldsGlyph;

        _windowCard.Label = _viewModel.WindowTitle;
        _windowCard.Sublabel = _viewModel.WindowSublabel;
        _windowCard.Glyph = XRayHeaderRegistration.WindowGlyph;

        _grid.Children.Add(_samplesCard);
        _grid.Children.Add(_fieldsCard);
        _grid.Children.Add(_windowCard);

        _retryButton.Text = _viewModel.RetryLabel;
        _retryButton.Variant = ButtonVariant.Secondary;
        _retryButton.Size = ControlSize.Small;
        _retryButton.IconGlyph = RetryGlyph;
        _retryButton.VerticalAlignment = VerticalAlignment.Center;
        AutomationProperties.SetName(_retryButton, _viewModel.RetryLabel);

        _status.TextWrapping = TextWrapping.Wrap;
        _status.Visibility = Visibility.Collapsed;
        LiveRegion.Configure(_status);

        _root.Children.Add(_statusRow);
        _root.Children.Add(_grid);
        _root.Children.Add(_status);

        Content = _root;
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_started)
        {
            return;
        }

        _started = true;
        _diagnostics.RecordViewOpened();
        _ = _viewModel.LoadAsync();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnRetryClick(object sender, RoutedEventArgs e) => _ = _viewModel.RetryAsync();

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
        ScheduleRender();

    private void ScheduleRender()
    {
        if (_renderQueued)
        {
            return;
        }

        _renderQueued = true;
        if (_dispatcher is { } dispatcher)
        {
            dispatcher.TryEnqueue(RenderCoalesced);
        }
        else
        {
            RenderCoalesced();
        }
    }

    private void RenderCoalesced()
    {
        _renderQueued = false;
        Render();
    }

    private void Render()
    {
        _samplesCard.Value = _viewModel.Display.SamplesValue;
        _fieldsCard.Value = _viewModel.Display.FieldsValue;
        _windowCard.Value = _viewModel.Display.WindowValue;

        BuildStatusRow();
        UpdateStatusLine();
    }

    private void BuildStatusRow()
    {
        _statusRow.Children.Clear();

        switch (_viewModel.State)
        {
            case XRayHeaderState.Stale:
                _statusRow.Children.Add(BuildBadge(_viewModel.StaleLabel, StatusKind.Warning));
                break;
            case XRayHeaderState.Offline:
                _statusRow.Children.Add(BuildBadge(_viewModel.OfflineLabel, StatusKind.Danger));
                break;
            case XRayHeaderState.Error:
                _statusRow.Children.Add(_retryButton);
                break;
            default:
                break;
        }

        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.IsError;
        _statusRow.Children.Add(_freshness);
    }

    private void UpdateStatusLine()
    {
        string? message = _viewModel.StatusAnnouncement;
        if (string.IsNullOrEmpty(message))
        {
            _status.Visibility = Visibility.Collapsed;
            _announced = null;
            return;
        }

        _status.Text = message;
        _status.Visibility = Visibility.Visible;
        AutomationProperties.SetName(_status, message);

        if (!string.Equals(_announced, message, StringComparison.Ordinal))
        {
            _announced = message;
            LiveRegion.Announce(_status);
        }
    }

    private static TsBadge BuildBadge(string text, StatusKind kind)
    {
        var badge = new TsBadge
        {
            Status = kind,
            Content = new TextBlock { Text = text, FontSize = 12 },
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(badge, text);
        return badge;
    }
}
