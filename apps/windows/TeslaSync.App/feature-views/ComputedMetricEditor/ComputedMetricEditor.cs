using System.ComponentModel;
using System.Globalization;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 Computed Metric Editor surface — a parity port of
/// web/src/features/notifications/components/ComputedMetricEditor.tsx. It composes the metric / window /
/// operator dropdowns, the numeric threshold field and the live-preview line (a value verdict against
/// <c>/alerts/test</c>), plus the metric-registry loading / empty / error / stale / offline surfaces the
/// web parent owns. All data flows through the shared <see cref="ComputedMetricEditorViewModel"/>; the view
/// never performs HTTP. Every string resolves through the i18n facade and every interactive element carries
/// a Narrator name.
/// </summary>
public sealed partial class ComputedMetricEditor : ContentControl, IDisposable
{
    private const string PreviewGlyph = "\uE7B3"; // Segoe Fluent — RedEye (preview)

    private readonly ComputedMetricEditorViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly ComputedMetricEditorDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly StackPanel _root = new() { Spacing = 16 };
    private readonly TsSelect _metricSelect = new();
    private readonly TsSelect _windowSelect = new();
    private readonly TsSelect _opSelect = new();
    private readonly TsInput _thresholdInput = new();
    private readonly Border _catalogStatusHost = new() { Visibility = Visibility.Collapsed };
    private readonly TsGlassPanel _previewPanel = new();
    private readonly StackPanel _previewBody = new() { Spacing = 4 };

    private bool _started;
    private bool _renderQueued;
    private bool _suppressEvents;
    private bool _disposed;

    /// <summary>Creates the surface over its two data sources, the localizer, an initial value and diagnostics.</summary>
    public ComputedMetricEditor(
        IComputedMetricCatalogSource catalogSource,
        IComputedMetricPreviewSource previewSource,
        ILocalizer localizer,
        ComputedMetricEditorValue? initialValue = null,
        ComputedMetricEditorDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(catalogSource);
        ArgumentNullException.ThrowIfNull(previewSource);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new ComputedMetricEditorDiagnostics();
        _viewModel = new ComputedMetricEditorViewModel(catalogSource, previewSource, localizer, initialValue);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        BuildChrome();
        Content = _root;

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>The canonical surface id this view registers under (<c>computed-metric-editor</c>).</summary>
    public static string RegistryId => ComputedMetricEditorRegistration.Id;

    /// <summary>The state holder driving this surface (exposed for host wiring and tests).</summary>
    public ComputedMetricEditorViewModel ViewModel => _viewModel;

    /// <summary>
    /// Convenience factory that wires the repository-backed data sources from the shared data layer (the
    /// host's P2-core dependencies).
    /// </summary>
    public static ComputedMetricEditor Create(
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        ComputedMetricEditorValue? initialValue = null,
        ComputedMetricEditorDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);

        var catalogSource = new ComputedMetricCatalogSource(api, engine, options);
        var previewSource = new ComputedMetricPreviewSource(api);
        return new ComputedMetricEditor(catalogSource, previewSource, localizer, initialValue, diagnostics);
    }

    /// <summary>Detach from the view-model and cancel any in-flight work (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    // ──────────────── Chrome ────────────────

    private void BuildChrome()
    {
        _root.Children.Add(BuildSelectorGrid());
        _root.Children.Add(_catalogStatusHost);
        _root.Children.Add(BuildThresholdRow());
        _root.Children.Add(BuildPreviewRow());
    }

    private Grid BuildSelectorGrid()
    {
        var grid = new Grid { ColumnSpacing = 16 };
        for (var column = 0; column < 3; column++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        _metricSelect.SelectionChanged += OnMetricSelectionChanged;
        _windowSelect.SelectionChanged += OnWindowSelectionChanged;
        _opSelect.SelectionChanged += OnOpSelectionChanged;

        var metricCell = BuildFieldCell(ComputedMetricEditorText.Metric(_localizer), _metricSelect);
        var windowCell = BuildFieldCell(ComputedMetricEditorText.Window(_localizer), _windowSelect);
        var opCell = BuildFieldCell(ComputedMetricEditorText.Operator(_localizer), _opSelect);

        Grid.SetColumn(metricCell, 0);
        Grid.SetColumn(windowCell, 1);
        Grid.SetColumn(opCell, 2);
        grid.Children.Add(metricCell);
        grid.Children.Add(windowCell);
        grid.Children.Add(opCell);
        return grid;
    }

    private static StackPanel BuildFieldCell(string labelText, TsSelect select)
    {
        select.HorizontalAlignment = HorizontalAlignment.Stretch;
        select.DisplayMemberPath = nameof(ComputedMetricOption.Label);
        select.SelectedValuePath = nameof(ComputedMetricOption.Value);
        AutomationProperties.SetName(select, labelText);

        var stack = new StackPanel { Spacing = 4 };
        stack.Children.Add(BuildFieldLabel(labelText));
        stack.Children.Add(select);
        return stack;
    }

    private StackPanel BuildThresholdRow()
    {
        _thresholdInput.Hint = ComputedMetricEditorText.ThresholdPrompt(_localizer);
        _thresholdInput.InputScope = NumberInputScope();
        _thresholdInput.HorizontalAlignment = HorizontalAlignment.Stretch;
        AutomationProperties.SetName(_thresholdInput, ComputedMetricEditorText.Threshold(_localizer));
        _thresholdInput.TextChanged += OnThresholdTextChanged;

        var stack = new StackPanel { Spacing = 4 };
        stack.Children.Add(BuildFieldLabel(ComputedMetricEditorText.Threshold(_localizer)));
        stack.Children.Add(_thresholdInput);
        return stack;
    }

    private TsGlassPanel BuildPreviewRow()
    {
        var eye = new FontIcon { Glyph = PreviewGlyph, FontSize = 12, Foreground = DisplayTokens.TextMuted };
        AutomationProperties.SetAccessibilityView(eye, AccessibilityView.Raw);

        var header = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, VerticalAlignment = VerticalAlignment.Center };
        header.Children.Add(eye);
        header.Children.Add(new TextBlock
        {
            Text = ComputedMetricEditorText.PreviewLabel(_localizer).ToUpper(CultureInfo.CurrentCulture),
            FontSize = 11,
            FontWeight = FontWeights.Medium,
            CharacterSpacing = 80,
            Foreground = DisplayTokens.TextMuted,
        });

        var column = new StackPanel { Spacing = 6 };
        column.Children.Add(header);
        column.Children.Add(_previewBody);

        _previewPanel.Glow = GlassGlow.None;
        _previewPanel.Padding = new Thickness(12);
        _previewPanel.Content = column;
        LiveRegion.Configure(_previewBody);
        AutomationProperties.SetName(_previewPanel, ComputedMetricEditorText.PreviewLabel(_localizer));
        return _previewPanel;
    }

    private static TextBlock BuildFieldLabel(string text) => new()
    {
        Text = text.ToUpper(CultureInfo.CurrentCulture),
        FontSize = 11,
        FontWeight = FontWeights.Medium,
        CharacterSpacing = 80,
        Foreground = DisplayTokens.TextMuted,
    };

    private static InputScope NumberInputScope()
    {
        var scope = new InputScope();
        scope.Names.Add(new InputScopeName(InputScopeNameValue.Number));
        return scope;
    }

    // ──────────────── Lifecycle ────────────────

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

    // ──────────────── Input events ────────────────

    private void OnMetricSelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_suppressEvents)
        {
            return;
        }

        if (_metricSelect.SelectedValue is string id)
        {
            _viewModel.SelectMetric(id);
        }
    }

    private void OnWindowSelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_suppressEvents)
        {
            return;
        }

        if (_windowSelect.SelectedValue is string window)
        {
            _viewModel.SetWindow(window);
        }
    }

    private void OnOpSelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_suppressEvents)
        {
            return;
        }

        if (_opSelect.SelectedValue is string op)
        {
            _viewModel.SetOperator(op);
        }
    }

    private void OnThresholdTextChanged(object sender, TextChangedEventArgs e)
    {
        if (_suppressEvents)
        {
            return;
        }

        _viewModel.SetThreshold(_thresholdInput.Text ?? string.Empty);
    }

    private void OnRetryInvoked(object? sender, EventArgs e) => _ = _viewModel.ReloadMetricsAsync();

    // ──────────────── Render ────────────────

    private void OnViewModelPropertyChanged(object? sender, PropertyChangedEventArgs e) => ScheduleRender();

    private void ScheduleRender()
    {
        if (_renderQueued)
        {
            return;
        }

        _renderQueued = true;
        RunOnDispatcher(RenderCoalesced);
    }

    private void RunOnDispatcher(Action action)
    {
        if (_dispatcher is { } dispatcher && !dispatcher.HasThreadAccess)
        {
            dispatcher.TryEnqueue(() => action());
        }
        else
        {
            action();
        }
    }

    private void RenderCoalesced()
    {
        _renderQueued = false;
        Render();
    }

    private void Render()
    {
        _suppressEvents = true;
        ApplySelect(_metricSelect, _viewModel.MetricOptions, _viewModel.MetricId, _viewModel.MetricPrompt, _viewModel.MetricEnabled);
        ApplySelect(_windowSelect, _viewModel.WindowOptions, _viewModel.MetricWindow, ComputedMetricEditorText.WindowPrompt(_localizer), _viewModel.WindowEnabled);
        ApplySelect(_opSelect, _viewModel.OpOptions, _viewModel.MetricOp, null, _viewModel.OpEnabled);
        if (!string.Equals(_thresholdInput.Text, _viewModel.MetricThreshold, StringComparison.Ordinal))
        {
            _thresholdInput.Text = _viewModel.MetricThreshold;
        }

        _suppressEvents = false;

        RenderCatalogStatus();
        RenderPreview();
    }

    private static void ApplySelect(
        TsSelect select,
        IReadOnlyList<ComputedMetricOption> options,
        string selectedValue,
        string? prompt,
        bool enabled)
    {
        select.Hint = prompt ?? string.Empty;
        if (!ReferenceEquals(select.ItemsSource, options))
        {
            select.ItemsSource = options;
        }

        select.SelectedValue = string.IsNullOrEmpty(selectedValue) ? null : selectedValue;
        select.IsEnabled = enabled;
    }

    private void RenderCatalogStatus()
    {
        var content = BuildCatalogStatusContent();
        _catalogStatusHost.Child = content;
        _catalogStatusHost.Visibility = content is null ? Visibility.Collapsed : Visibility.Visible;
    }

    private UIElement? BuildCatalogStatusContent() => _viewModel.CatalogState switch
    {
        ComputedMetricCatalogState.Loading => BuildLoadingRow(),
        ComputedMetricCatalogState.Empty => BuildEmptyState(),
        ComputedMetricCatalogState.Error => BuildErrorState(),
        ComputedMetricCatalogState.Stale => BuildChip(ComputedMetricEditorText.Stale(_localizer), StatusKind.Warning),
        ComputedMetricCatalogState.Offline => BuildChip(ComputedMetricEditorText.Offline(_localizer), StatusKind.Neutral),
        _ => null,
    };

    private StackPanel BuildLoadingRow()
    {
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        row.Children.Add(new ProgressRing { IsActive = true, Width = 16, Height = 16 });
        row.Children.Add(new TextBlock
        {
            Text = ComputedMetricEditorText.LoadingMetrics(_localizer),
            FontSize = 12,
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Center,
        });
        AutomationProperties.SetName(row, ComputedMetricEditorText.LoadingMetrics(_localizer));
        return row;
    }

    private TsEmptyState BuildEmptyState()
    {
        var empty = new TsEmptyState
        {
            Title = ComputedMetricEditorText.MetricsEmpty(_localizer),
            ActionText = ComputedMetricEditorText.Retry(_localizer),
        };
        empty.ActionInvoked += OnRetryInvoked;
        return empty;
    }

    private TsErrorDisplay BuildErrorState()
    {
        var error = new TsErrorDisplay
        {
            Title = ComputedMetricEditorText.MetricsError(_localizer),
            Message = _viewModel.CatalogError ?? string.Empty,
            ActionText = ComputedMetricEditorText.Retry(_localizer),
        };
        error.ActionInvoked += OnRetryInvoked;
        return error;
    }

    private void RenderPreview()
    {
        _previewBody.Children.Clear();
        switch (_viewModel.PreviewState)
        {
            case ComputedMetricPreviewState.Error:
                _previewBody.Children.Add(new TextBlock
                {
                    Text = _viewModel.PreviewError ?? string.Empty,
                    FontSize = 12,
                    Foreground = DisplayTokens.Brush("TsColorDangerBrush"),
                    TextWrapping = TextWrapping.Wrap,
                });
                break;

            case ComputedMetricPreviewState.Loading:
                _previewBody.Children.Add(MutedText(ComputedMetricEditorText.PreviewLoading(_localizer)));
                break;

            case ComputedMetricPreviewState.Rendered:
                _previewBody.Children.Add(new TextBlock
                {
                    Text = _viewModel.PreviewValueText ?? string.Empty,
                    FontSize = 12,
                    Foreground = DisplayTokens.TextPrimary,
                    TextWrapping = TextWrapping.Wrap,
                });
                break;

            default:
                _previewBody.Children.Add(MutedText(ComputedMetricEditorText.PreviewIdle(_localizer)));
                break;
        }
    }

    private static TextBlock MutedText(string text) => new()
    {
        Text = text,
        FontSize = 12,
        Foreground = DisplayTokens.TextMuted,
        TextWrapping = TextWrapping.Wrap,
    };

    private static Border BuildChip(string text, StatusKind status)
    {
        var content = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, VerticalAlignment = VerticalAlignment.Center };
        content.Children.Add(new Ellipse
        {
            Width = 6,
            Height = 6,
            Fill = DisplayTokens.Brush(StatusResources.AccentBrushKey(status)),
            VerticalAlignment = VerticalAlignment.Center,
        });
        content.Children.Add(new TextBlock
        {
            Text = text,
            FontSize = 11,
            Foreground = DisplayTokens.TextSecondary,
            VerticalAlignment = VerticalAlignment.Center,
        });

        var chip = new Border
        {
            Child = content,
            Padding = new Thickness(8, 3, 8, 3),
            CornerRadius = new CornerRadius(999),
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(1),
            Background = DisplayTokens.Surface,
            HorizontalAlignment = HorizontalAlignment.Left,
        };
        AutomationProperties.SetName(chip, text);
        return chip;
    }
}
