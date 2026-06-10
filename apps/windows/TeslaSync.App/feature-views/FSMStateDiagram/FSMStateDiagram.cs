using System.Globalization;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using Windows.Foundation;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 State Diagram surface — a parity port of
/// web/src/features/system/components/FSMStateDiagram.tsx. It renders the web's glass panel titled
/// "State Diagram" with a horizontal, wrapping flow of state nodes (a coloured status dot, the state name, the
/// observed transition count, a "current state" marker on the latest state, and inter-node arrows carrying the
/// observed edge counts), followed by the count-descending edge-frequency summary chips. When the selected FSM
/// type has no registered diagram it shows the web's "Select a specific FSM type" empty state. The web component
/// is a pure child fed its <c>transitions</c> prop; the native surface binds its own cache-then-network read, so
/// it also renders the loading skeleton, a retry surface on hard failure, and stale / offline freshness chips.
/// All data flows through the shared <see cref="FsmStateDiagramViewModel"/>; the view never performs HTTP. Every
/// string resolves through the i18n facade and every meaningful element carries a Narrator name.
/// </summary>
public sealed partial class FSMStateDiagram : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C"; // Segoe Fluent — Refresh
    private const string ArrowGlyph = "\u2192";   // →
    private const string TimesGlyph = "\u00D7";   // ×
    private const double PanelPadding = 20;
    private const double SectionSpacing = 16;
    private const double NodeMinWidth = 84;
    private const double MarkerSize = 8;

    private readonly FsmStateDiagramViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly FsmStateDiagramDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly Grid _root = new();
    private readonly StackPanel _header = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = 8,
        HorizontalAlignment = HorizontalAlignment.Right,
        VerticalAlignment = VerticalAlignment.Center,
        Padding = new Thickness(0, 0, 0, 8),
    };

    private readonly TsDataFreshness _freshness = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly ContentControl _bodyHost = new()
    {
        HorizontalContentAlignment = HorizontalAlignment.Stretch,
        VerticalContentAlignment = VerticalAlignment.Stretch,
    };

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, FSM type, localizer and (optional) diagnostics.</summary>
    /// <param name="source">The cache-then-network transition source.</param>
    /// <param name="fsmType">The FSM type to diagram (web's resolved <c>fsmType</c>, e.g. <c>vehicle</c>).</param>
    /// <param name="localizer">The i18n facade resolving every string.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public FSMStateDiagram(
        IFsmStateDiagramSource source,
        string fsmType,
        ILocalizer localizer,
        FsmStateDiagramDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentException.ThrowIfNullOrWhiteSpace(fsmType);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new FsmStateDiagramDiagnostics();
        _viewModel = new FsmStateDiagramViewModel(source, fsmType, localizer);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;
        AutomationProperties.SetName(this, _viewModel.Title);

        BuildChrome();

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>The canonical surface id (<c>fsm-state-diagram</c>).</summary>
    public static string SurfaceId => FsmStateDiagramRegistration.Id;

    /// <summary>The backing state holder (exposed for hosting / diagnostics).</summary>
    public FsmStateDiagramViewModel ViewModel => _viewModel;

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="FsmStateDiagramSource"/> from the shared
    /// data layer (the host's P2-core dependencies) for one vehicle, FSM type and time window.
    /// </summary>
    /// <param name="api">The generated contract API client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The API client options carrying the JSON serializer settings.</param>
    /// <param name="localizer">The i18n facade resolving every string.</param>
    /// <param name="vehicleId">The vehicle whose transition log is read.</param>
    /// <param name="fsmType">The FSM type to diagram.</param>
    /// <param name="hours">The look-back window in hours (defaults to 24).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public static FSMStateDiagram Create(
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        long vehicleId,
        string fsmType,
        int hours = 24,
        FsmStateDiagramDiagnostics? diagnostics = null)
    {
        var source = new FsmStateDiagramSource(api, engine, options, vehicleId, fsmType, hours);
        return new FSMStateDiagram(source, fsmType, localizer, diagnostics);
    }

    private void BuildChrome()
    {
        _root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        _root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });

        var scroll = new ScrollViewer
        {
            Content = _bodyHost,
            VerticalScrollMode = ScrollMode.Auto,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollMode = ScrollMode.Disabled,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
        };

        Grid.SetRow(_header, 0);
        Grid.SetRow(scroll, 1);
        _root.Children.Add(_header);
        _root.Children.Add(scroll);
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

    /// <summary>Detach from the view-model and cancel any in-flight load (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _viewModel.Dispose();
    }

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
        var display = _viewModel.Display;
        AutomationProperties.SetName(this, display.AutomationName);

        switch (_viewModel.State)
        {
            case FsmStateDiagramState.Loading:
                Content = WrapScroll(BuildPanel(BuildSkeletons()));
                break;

            case FsmStateDiagramState.Error:
                Content = WrapScroll(BuildPanel(BuildError()));
                break;

            case FsmStateDiagramState.Empty:
                Content = WrapScroll(BuildPanel(BuildEmpty(display)));
                break;

            default:
                UpdateHeader();
                _bodyHost.Content = BuildPanel(BuildDiagramBody(display));
                Content = _root;
                break;
        }
    }

    // ── Panel chrome ─────────────────────────────────────────────────────────────────────────────────

    private TsGlassPanel BuildPanel(UIElement body)
    {
        var column = new StackPanel { Spacing = SectionSpacing };
        column.Children.Add(new PanelTitle { Value = _viewModel.Title });
        column.Children.Add(body);
        return new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = column };
    }

    private static ScrollViewer WrapScroll(UIElement child) => new()
    {
        Content = child,
        VerticalScrollMode = ScrollMode.Auto,
        VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
        HorizontalScrollMode = ScrollMode.Disabled,
        HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
    };

    // ── State surfaces ───────────────────────────────────────────────────────────────────────────────

    private ChipWrapPanel BuildSkeletons()
    {
        var wrap = new ChipWrapPanel { HorizontalSpacing = 12, VerticalSpacing = 12 };
        for (int i = 0; i < 5; i++)
        {
            wrap.Children.Add(new TsSkeleton { BlockWidth = NodeMinWidth, BlockHeight = 52, Radius = 8 });
        }

        AutomationProperties.SetName(wrap, _viewModel.LoadingMessage);
        return wrap;
    }

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.ErrorMessage ?? _localizer.GetString(FsmStateDiagramText.ErrorKey, FsmStateDiagramText.ErrorFallback),
            ActionText = _localizer.GetString("common.retry", "Retry"),
            AttemptCount = _viewModel.Attempts,
        };
        error.ActionInvoked += (_, _) => _ = _viewModel.RetryAsync();
        return error;
    }

    private static TsEmptyState BuildEmpty(FsmStateDiagramDisplay display) => new TsEmptyState
    {
        Message = display.EmptyMessage,
    };

    // ── Diagram body ─────────────────────────────────────────────────────────────────────────────────

    private static StackPanel BuildDiagramBody(FsmStateDiagramDisplay display)
    {
        var column = new StackPanel { Spacing = SectionSpacing };

        var nodes = new ChipWrapPanel { HorizontalSpacing = 12, VerticalSpacing = 12 };
        foreach (var node in display.Nodes)
        {
            nodes.Children.Add(BuildNodeGroup(node));
        }

        column.Children.Add(nodes);

        if (display.HasEdgeSummary)
        {
            var summary = new ChipWrapPanel { HorizontalSpacing = 8, VerticalSpacing = 8 };
            foreach (var item in display.EdgeSummary)
            {
                summary.Children.Add(BuildEdgeChip(item));
            }

            column.Children.Add(summary);
        }

        return column;
    }

    private static StackPanel BuildNodeGroup(FsmStateNode node)
    {
        var accent = DisplayTokens.Brush(node.BrushKey);

        var inner = new StackPanel
        {
            Orientation = Orientation.Vertical,
            HorizontalAlignment = HorizontalAlignment.Center,
            Spacing = 2,
        };
        inner.Children.Add(new Ellipse
        {
            Width = MarkerSize,
            Height = MarkerSize,
            Fill = accent,
            HorizontalAlignment = HorizontalAlignment.Center,
        });
        inner.Children.Add(new TextBlock
        {
            Text = node.State,
            FontSize = 12,
            FontWeight = FontWeights.Medium,
            Foreground = accent,
            HorizontalAlignment = HorizontalAlignment.Center,
        });
        if (node.Count > 0)
        {
            inner.Children.Add(new TextBlock
            {
                Text = node.Count.ToString(CultureInfo.CurrentCulture),
                FontSize = 10,
                Foreground = DisplayTokens.TextMuted,
                HorizontalAlignment = HorizontalAlignment.Center,
            });
        }

        var box = new Border
        {
            Child = inner,
            MinWidth = NodeMinWidth,
            Padding = new Thickness(12, 8, 12, 8),
            CornerRadius = DisplayTokens.Radius("TsRadiusMd", 8),
            Background = DisplayTokens.Surface,
            BorderBrush = node.IsCurrent ? DisplayTokens.Accent : DisplayTokens.Border,
            BorderThickness = new Thickness(node.IsCurrent ? 1.5 : 1),
            Opacity = node.IsActive ? 1.0 : 0.5,
        };

        var boxHost = new Grid();
        boxHost.Children.Add(box);
        if (node.IsCurrent)
        {
            boxHost.Children.Add(new Ellipse
            {
                Width = MarkerSize,
                Height = MarkerSize,
                Fill = DisplayTokens.Brush("TsColorSuccessBrush"),
                HorizontalAlignment = HorizontalAlignment.Right,
                VerticalAlignment = VerticalAlignment.Top,
                Margin = new Thickness(0, -2, -2, 0),
            });
        }

        AutomationProperties.SetName(boxHost, node.AutomationName);

        var group = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };
        group.Children.Add(boxHost);
        if (node.HasNext)
        {
            group.Children.Add(BuildArrow(node.NextEdgeCount));
        }

        return group;
    }

    private static StackPanel BuildArrow(int? edgeCount)
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 2,
            VerticalAlignment = VerticalAlignment.Center,
        };
        row.Children.Add(new TextBlock
        {
            Text = ArrowGlyph,
            FontSize = 16,
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Center,
        });
        if (edgeCount is { } count)
        {
            row.Children.Add(new TextBlock
            {
                Text = count.ToString(CultureInfo.CurrentCulture),
                FontSize = 10,
                Foreground = DisplayTokens.TextMuted,
                VerticalAlignment = VerticalAlignment.Center,
            });
        }

        // The arrow is decorative; node Narrator names already convey the flow.
        AutomationProperties.SetAccessibilityView(row, AccessibilityView.Raw);
        return row;
    }

    private static Border BuildEdgeChip(FsmEdgeSummaryItem item)
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 4,
            VerticalAlignment = VerticalAlignment.Center,
        };
        row.Children.Add(new TextBlock
        {
            Text = item.From,
            FontSize = 10,
            Foreground = DisplayTokens.Brush(item.FromBrushKey),
            VerticalAlignment = VerticalAlignment.Center,
        });
        row.Children.Add(new TextBlock
        {
            Text = ArrowGlyph,
            FontSize = 10,
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Center,
        });
        row.Children.Add(new TextBlock
        {
            Text = item.To,
            FontSize = 10,
            Foreground = DisplayTokens.Brush(item.ToBrushKey),
            VerticalAlignment = VerticalAlignment.Center,
        });
        row.Children.Add(new TextBlock
        {
            Text = TimesGlyph + item.Count.ToString(CultureInfo.CurrentCulture),
            FontSize = 10,
            FontFamily = new FontFamily("Consolas"),
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Center,
        });

        var chip = new Border
        {
            Child = row,
            CornerRadius = DisplayTokens.Radius("TsRadiusSm", 4),
            Background = DisplayTokens.Surface,
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(1),
            Padding = new Thickness(8, 4, 8, 4),
        };
        AutomationProperties.SetName(chip, item.AutomationName);
        return chip;
    }

    // ── Header (stale/offline chip + freshness + refresh) ──────────────────────────────────────────────

    private void UpdateHeader()
    {
        _header.Children.Clear();

        if (_viewModel.State is FsmStateDiagramState.Stale or FsmStateDiagramState.Offline)
        {
            _header.Children.Add(BuildFreshnessChip(_viewModel.State));
        }

        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.State == FsmStateDiagramState.Offline;
        _header.Children.Add(_freshness);
        _header.Children.Add(BuildRefreshButton());
    }

    private TsBadge BuildFreshnessChip(FsmStateDiagramState state)
    {
        bool offline = state == FsmStateDiagramState.Offline;
        string text = offline
            ? _localizer.GetString("common.offline", "Offline")
            : _localizer.GetString("common.stale", "Stale");

        var badge = new TsBadge
        {
            Status = offline ? StatusKind.Danger : StatusKind.Warning,
            Content = new TextBlock { Text = text, FontSize = 12 },
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(badge, text);
        return badge;
    }

    private TsButton BuildRefreshButton()
    {
        var button = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Small,
            IconGlyph = RefreshGlyph,
            VerticalAlignment = VerticalAlignment.Center,
            IsEnabled = !_viewModel.IsFetching,
        };
        AutomationProperties.SetName(button, _localizer.GetString("common.refresh", "Refresh"));
        button.Click += (_, _) => _ = _viewModel.RetryAsync();
        return button;
    }

    /// <summary>
    /// A minimal left-to-right wrap panel for the node flow and the edge-summary run — the native analogue of
    /// the web <c>flex flex-wrap</c> rows so items flow onto a new run rather than clipping on a narrow surface.
    /// </summary>
    private sealed partial class ChipWrapPanel : Panel
    {
        /// <summary>Horizontal gap between items on a run.</summary>
        public double HorizontalSpacing { get; set; }

        /// <summary>Vertical gap between wrapped runs.</summary>
        public double VerticalSpacing { get; set; }

        protected override Size MeasureOverride(Size availableSize)
        {
            double maxWidth = double.IsNaN(availableSize.Width) || double.IsInfinity(availableSize.Width)
                ? double.PositiveInfinity
                : availableSize.Width;

            double rowWidth = 0;
            double rowHeight = 0;
            double totalHeight = 0;
            double widest = 0;

            foreach (var child in Children)
            {
                child.Measure(new Size(double.PositiveInfinity, double.PositiveInfinity));
                var desired = child.DesiredSize;

                if (rowWidth > 0 && rowWidth + HorizontalSpacing + desired.Width > maxWidth)
                {
                    widest = Math.Max(widest, rowWidth);
                    totalHeight += rowHeight + VerticalSpacing;
                    rowWidth = desired.Width;
                    rowHeight = desired.Height;
                }
                else
                {
                    rowWidth += (rowWidth > 0 ? HorizontalSpacing : 0) + desired.Width;
                    rowHeight = Math.Max(rowHeight, desired.Height);
                }
            }

            widest = Math.Max(widest, rowWidth);
            totalHeight += rowHeight;

            double measuredWidth = double.IsInfinity(maxWidth) ? widest : maxWidth;
            return new Size(measuredWidth, totalHeight);
        }

        protected override Size ArrangeOverride(Size finalSize)
        {
            double x = 0;
            double y = 0;
            double rowHeight = 0;

            foreach (var child in Children)
            {
                var desired = child.DesiredSize;
                if (x > 0 && x + HorizontalSpacing + desired.Width > finalSize.Width)
                {
                    x = 0;
                    y += rowHeight + VerticalSpacing;
                    rowHeight = 0;
                }

                if (x > 0)
                {
                    x += HorizontalSpacing;
                }

                child.Arrange(new Rect(x, y, desired.Width, desired.Height));
                x += desired.Width;
                rowHeight = Math.Max(rowHeight, desired.Height);
            }

            return finalSize;
        }
    }
}
