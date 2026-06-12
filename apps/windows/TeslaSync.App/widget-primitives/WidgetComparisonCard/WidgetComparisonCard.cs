using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Documents;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces;

namespace TeslaSync.App.WidgetPrimitives;

/// <summary>
/// The native WinUI 3 <c>WidgetComparisonCard</c> widget primitive — a parity port of the web
/// <c>WidgetComparisonCard</c> (web/src/features/dashboard/widgets/shared/WidgetComparisonCard.tsx), the shared
/// building block dashboard widgets drop in to show a short stack of period-over-period metric rows. It composes,
/// per visible metric, a truncating label over a semibold value (with an optional muted unit suffix) on the left
/// and the shared <see cref="Delta"/> percent indicator on the right, separated by hairline row dividers exactly
/// like the web <c>border-b</c> treatment. It reproduces the web's two branches: the muted "No comparison data"
/// line when there are no rows (web L52-L56) and the column of rows otherwise (web L58-L63). The web component is
/// purely presentational — it renders the already-resolved props its parent widget supplies and has no fetch
/// lifecycle, so (like the sibling <c>Delta</c> and <c>KpiOverviewCard</c> surfaces) there is no loading / error
/// / stale / offline chrome to reproduce. All presentational state flows through the shared
/// <see cref="WidgetComparisonCardViewModel"/> and its <see cref="IWidgetComparisonCardSource"/> P1/S8 seam; the
/// view never performs HTTP and never recomputes — it renders the <see cref="WidgetComparisonCardDisplay"/>
/// projection and lets each row's <see cref="Delta"/> own the percent maths. The card carries no animation (so
/// the reduced-motion contract holds by construction), its text uses the tokenized typography sizes/weights and
/// theme brushes (so system font scaling, high contrast and the light theme keep working), each row exposes a
/// Narrator name for its label + value while the trailing delta stays a separate accessible element, and the
/// surface emits the <c>view.opened</c> diagnostic exactly once when it is shown.
/// </summary>
public sealed partial class WidgetComparisonCard : ContentControl, IDisposable
{
    // web Tailwind spacing → effective pixels: gap-3 (row), py-2.5 (row), gap-0.5 (label/value), py-2 (empty).
    private const double RowGap = 12;
    private const double RowVerticalPadding = 10;
    private const double LabelValueSpacing = 2;
    private const double EmptyVerticalPadding = 8;

    // web L29 ml-0.5: a thin leading gap before the unit run (inline runs carry no margin).
    private const string UnitGap = " ";

    private readonly ILocalizer _localizer;
    private readonly WidgetComparisonCardDiagnostics _diagnostics;
    private readonly WidgetComparisonCardViewModel _viewModel;
    private readonly WidgetComparisonCardSource? _mutableSource;
    private readonly DispatcherQueue? _dispatcher;
    private readonly StackPanel _column = new() { Orientation = Orientation.Vertical, Spacing = 0 };
    private readonly List<Delta> _rowDeltas = new();

    private bool _opened;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over a fresh in-memory source and the supplied localizer (the common host path).</summary>
    /// <param name="localizer">The i18n facade used for the empty-line text; never null.</param>
    public WidgetComparisonCard(ILocalizer localizer)
        : this(new WidgetComparisonCardSource(), localizer, diagnostics: null)
    {
    }

    /// <summary>Creates the surface over an explicit input seam, localizer and optional PII-safe diagnostics collector.</summary>
    /// <param name="source">The presentational-input seam (P1/S8); never null.</param>
    /// <param name="localizer">The i18n facade used for the empty-line text; never null.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the surface counters.</param>
    public WidgetComparisonCard(
        IWidgetComparisonCardSource source,
        ILocalizer localizer,
        WidgetComparisonCardDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new WidgetComparisonCardDiagnostics();
        _viewModel = new WidgetComparisonCardViewModel(source, localizer);
        _mutableSource = source as WidgetComparisonCardSource;
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Top;
        Content = _column;

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>The diagnostics slug this surface registers under (<c>WidgetComparisonCard</c>).</summary>
    public static string Slug => WidgetComparisonCardRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public WidgetComparisonCardViewModel ViewModel => _viewModel;

    /// <summary>
    /// The comparison metrics rendered as rows (web <c>metrics</c>). Setting the list pushes it onto the bound
    /// in-memory source so the view re-projects and re-renders; a custom source ignores the setter.
    /// </summary>
    public IReadOnlyList<ComparisonMetric> Metrics
    {
        get => _mutableSource?.Input.Metrics ?? Array.Empty<ComparisonMetric>();
        set => _mutableSource?.SetMetrics(value ?? Array.Empty<ComparisonMetric>());
    }

    /// <summary>Whether the card renders its tighter compact form (web <c>compact</c>); a custom source ignores the setter.</summary>
    public bool Compact
    {
        get => _viewModel.Display.Compact;
        set => _mutableSource?.SetCompact(value);
    }

    /// <summary>Detach from the view-model and dispose the per-row delta controls (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _viewModel.Dispose();
        DisposeRowDeltas();
        GC.SuppressFinalize(this);
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_opened)
        {
            return;
        }

        _opened = true;
        _diagnostics.RecordViewOpened();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e)
    {
        if (e.PropertyName == nameof(WidgetComparisonCardViewModel.Display))
        {
            ScheduleRender();
        }
    }

    private void ScheduleRender()
    {
        if (_renderQueued || _disposed)
        {
            return;
        }

        _renderQueued = true;

        // A source change can be raised from a background state callback; render on the UI thread.
        if (_dispatcher is { } dispatcher && !dispatcher.HasThreadAccess)
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
        DisposeRowDeltas();
        _column.Children.Clear();

        WidgetComparisonCardDisplay display = _viewModel.Display;

        // web L52-L56: empty branch — a single muted "No comparison data" line.
        if (display.IsEmpty)
        {
            _column.Children.Add(BuildEmpty(display.EmptyMessage));
            return;
        }

        // web L58-L63: populated branch — the column of metric rows; each row self-describes to Narrator.
        IReadOnlyList<WidgetComparisonCardRow> rows = display.Rows;
        for (int i = 0; i < rows.Count; i++)
        {
            _column.Children.Add(BuildRow(rows[i], isLast: i == rows.Count - 1));
        }
    }

    private static TextBlock BuildEmpty(string message)
    {
        // web L54: <p className="text-sm text-[var(--text-muted)] py-2">No comparison data</p>.
        var text = new TextBlock
        {
            Text = message,
            FontFamily = TypographyTokens.Sans,
            FontSize = TypographyTokens.Size("TsTypeBodyFontSize", 14),
            Foreground = ResolveBrush("TsColorTextMutedBrush"),
            TextWrapping = TextWrapping.Wrap,
            Margin = new Thickness(0, EmptyVerticalPadding, 0, EmptyVerticalPadding),
        };
        AutomationProperties.SetName(text, message);
        return text;
    }

    private Border BuildRow(WidgetComparisonCardRow row, bool isLast)
    {
        var textColumn = new StackPanel
        {
            Orientation = Orientation.Vertical,
            Spacing = LabelValueSpacing,
            VerticalAlignment = VerticalAlignment.Center,
        };
        textColumn.Children.Add(BuildLabel(row.Label));
        textColumn.Children.Add(BuildValue(row));

        var delta = new Delta(new DeltaSource(row.DeltaInput, DeltaUnitContext.Metric), _localizer)
        {
            VerticalAlignment = VerticalAlignment.Center,
        };
        _rowDeltas.Add(delta);

        var grid = new Grid { ColumnSpacing = RowGap };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(textColumn, 0);
        Grid.SetColumn(delta, 1);
        grid.Children.Add(textColumn);
        grid.Children.Add(delta);

        var border = new Border
        {
            Padding = new Thickness(0, RowVerticalPadding, 0, RowVerticalPadding),
            BorderThickness = isLast ? new Thickness(0) : new Thickness(0, 0, 0, 1),
            BorderBrush = ResolveBrush("TsColorBorderBrush"),
            Child = grid,
        };

        // The row's label + value read as one Narrator name; the trailing delta stays a separate accessible element.
        AutomationProperties.SetName(border, row.AccessibleName);
        return border;
    }

    private static TextBlock BuildLabel(string label)
    {
        // web L25: <span className="truncate text-xs text-[var(--text-muted)]">{label}</span>.
        var text = new TextBlock
        {
            Text = label,
            FontFamily = TypographyTokens.Sans,
            FontSize = TypographyTokens.Size("TsTypeCaptionFontSize", 12),
            Foreground = ResolveBrush("TsColorTextMutedBrush"),
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
        };
        AutomationProperties.SetAccessibilityView(text, AccessibilityView.Raw);
        return text;
    }

    private static TextBlock BuildValue(WidgetComparisonCardRow row)
    {
        // web L26-L33: a truncating semibold value, with the optional unit as a smaller muted normal-weight run.
        var text = new TextBlock
        {
            FontFamily = TypographyTokens.Sans,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
        };

        var value = new Run
        {
            Text = row.FormattedCurrent,
            FontSize = TypographyTokens.Size("TsTypePanelFontSize", 16),
            FontWeight = TypographyTokens.Weight(TypographyTokens.Size("TsTypePanelFontWeight", 600)),
            Foreground = ResolveBrush("TsColorTextPrimaryBrush"),
        };
        text.Inlines.Add(value);

        if (row.HasUnit)
        {
            var unit = new Run
            {
                Text = UnitGap + row.Unit,
                FontSize = TypographyTokens.Size("TsTypeCaptionFontSize", 12),
                FontWeight = TypographyTokens.Weight(TypographyTokens.Size("TsTypeBodyFontWeight", 400)),
                Foreground = ResolveBrush("TsColorTextMutedBrush"),
            };
            text.Inlines.Add(unit);
        }

        AutomationProperties.SetAccessibilityView(text, AccessibilityView.Raw);
        return text;
    }

    private void DisposeRowDeltas()
    {
        foreach (Delta delta in _rowDeltas)
        {
            delta.Dispose();
        }

        _rowDeltas.Clear();
    }

    private static Brush ResolveBrush(string key) =>
        TypographyTokens.Brush(key) ?? new SolidColorBrush(Microsoft.UI.Colors.Gray);
}
