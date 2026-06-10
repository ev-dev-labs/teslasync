using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 <c>CollapsibleCommandGroup</c> feature surface — a parity port of
/// web/src/features/system/components/CollapsibleCommandGroup.tsx. It is a purely presentational disclosure: it
/// heads a command category with the category glyph, its upper-cased label and a <c>(N)</c> command count, and
/// reveals the supplied command tiles (the web <c>children</c>) in a responsive grid when expanded. The web
/// custom ghost button + rotating chevron is realised idiomatically with the shared Fluent
/// <see cref="TsAccordion"/> (an <c>Expander</c>), which contributes the disclosure chevron, the expand/collapse
/// animation, keyboard toggling and Narrator expanded-state for free; the revealed grid fades in via the
/// reduce-motion-aware <see cref="TsFadeIn"/> (the web <c>FadeIn</c>). The web source has no fetch lifecycle (its
/// only data source is <c>useTranslation</c>), so there is no loading / error / stale / offline branch to
/// reproduce — the two states are collapsed and expanded, plus a friendly empty caption when an expanded group
/// has no tiles (so the revealed region is never a blank box). The open/closed state is persisted per
/// vehicle + category through <see cref="ICommandGroupExpansionStore"/> (the native analogue of the web
/// <c>sessionStorage</c>) under the web-compatible <c>teslasync-cat-{vehicleId}-{category}</c> key. The view never
/// performs HTTP; all label resolution, glyph selection, key composition and initial-state resolution happen in
/// the WinUI-free <see cref="CollapsibleCommandGroupProjection"/>. The category glyph is hidden from Narrator, the
/// label is spoken in its natural casing, and the grid re-flows 2/3/4 columns across the web breakpoints.
/// </summary>
public sealed partial class CollapsibleCommandGroup : ContentControl
{
    private const double HeaderSpacing = 8;        // web gap-2 (icon -> label)
    private const double CountSpacing = 4;         // web ml-1 (label -> count)
    private const double GridGap = 12;             // web gap-3
    private const double ContentTopGap = 8;        // web mt-2
    private const double HeaderIconSize = 16;      // web h-4 w-4
    private const double LabelTrackingWider = 50;  // web tracking-wider (0.05em -> 50/1000 em)
    private const double NarrowBreakpoint = 640;   // web base -> 2 columns
    private const double WideBreakpoint = 1024;    // web lg: -> 4 columns
    private const int NarrowColumns = 2;           // web grid-cols-2
    private const int MediumColumns = 3;           // web sm:grid-cols-3
    private const int WideColumns = 4;             // web lg:grid-cols-4

    private readonly ILocalizer _localizer;
    private readonly ICommandGroupExpansionStore _store;
    private readonly CollapsibleCommandGroupDiagnostics _diagnostics;

    private readonly TsAccordion _expander = new();
    private readonly FontIcon _headerIcon = new() { FontSize = HeaderIconSize, VerticalAlignment = VerticalAlignment.Center };
    private readonly TextBlock _label = new() { VerticalAlignment = VerticalAlignment.Center, TextWrapping = TextWrapping.Wrap };
    private readonly TextBlock _count = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly TsFadeIn _fade = new();
    private readonly Grid _grid = new() { ColumnSpacing = GridGap, RowSpacing = GridGap, Margin = new Thickness(0, ContentTopGap, 0, 0) };
    private readonly TsEmptyState _empty = new() { HorizontalAlignment = HorizontalAlignment.Stretch, Margin = new Thickness(0, ContentTopGap, 0, 0) };

    private readonly List<UIElement> _commands = [];

    private CollapsibleCommandGroupModel _model;
    private string _storageKey = string.Empty;
    private int _renderedColumns;
    private bool _suppressPersist;
    private bool _opened;

    /// <summary>Creates the surface over its i18n facade, a model, the command tiles, an expansion store and diagnostics.</summary>
    /// <param name="localizer">The i18n facade the header label resolves through.</param>
    /// <param name="model">The render model (category, vehicle id, command count, default-open).</param>
    /// <param name="commands">The command tiles revealed when expanded (the web <c>children</c>), or null.</param>
    /// <param name="store">The expansion store; defaults to <see cref="SessionCommandGroupExpansionStore.Shared"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public CollapsibleCommandGroup(
        ILocalizer localizer,
        CollapsibleCommandGroupModel model,
        IReadOnlyList<UIElement>? commands = null,
        ICommandGroupExpansionStore? store = null,
        CollapsibleCommandGroupDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(model);

        _localizer = localizer;
        _model = model;
        _store = store ?? SessionCommandGroupExpansionStore.Shared;
        _diagnostics = diagnostics ?? new CollapsibleCommandGroupDiagnostics();
        if (commands is not null)
        {
            _commands.AddRange(commands);
        }

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Top;

        BuildChrome();

        Loaded += OnLoaded;
        SizeChanged += OnSizeChanged;

        Render();
        ApplyInitialExpansion();
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>CollapsibleCommandGroup</c>).</summary>
    public static string Slug => CollapsibleCommandGroupRegistration.Slug;

    /// <summary>The render model; reassigning re-projects, re-renders and re-resolves the persisted open state.</summary>
    public CollapsibleCommandGroupModel Model
    {
        get => _model;
        set
        {
            ArgumentNullException.ThrowIfNull(value);
            _model = value;
            Render();
            ApplyInitialExpansion();
        }
    }

    /// <summary>The command tiles revealed when expanded (the web <c>children</c>); reassigning re-flows the grid.</summary>
    public IReadOnlyList<UIElement> Commands
    {
        get => _commands;
        set
        {
            _commands.Clear();
            if (value is not null)
            {
                _commands.AddRange(value);
            }

            _renderedColumns = 0;
            RenderContent();
        }
    }

    private void BuildChrome()
    {
        AutomationProperties.SetAccessibilityView(_headerIcon, AccessibilityView.Raw);
        _headerIcon.Foreground = DisplayTokens.TextMuted;

        _label.FontSize = TypographyTokens.Size("TsTypeLabelFontSize", 12);
        _label.FontWeight = FontWeights.Medium;
        _label.Foreground = DisplayTokens.TextSecondary;
        _label.CharacterSpacing = (int)LabelTrackingWider;

        _count.FontSize = TypographyTokens.Size("TsTypeCaptionFontSize", 12);
        _count.Foreground = DisplayTokens.TextMuted;
        _count.Margin = new Thickness(CountSpacing, 0, 0, 0);

        var header = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = HeaderSpacing,
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Left,
        };
        header.Children.Add(_headerIcon);
        header.Children.Add(_label);
        header.Children.Add(_count);

        _fade.Content = _grid;
        _expander.Header = header;
        _expander.Content = _fade;
        _expander.Expanding += OnExpanding;
        _expander.Collapsed += OnCollapsed;

        Content = _expander;
    }

    private void Render()
    {
        CollapsibleCommandGroupDisplay display = CollapsibleCommandGroupProjection.Project(_model, _localizer);
        _storageKey = display.StorageKey;

        _headerIcon.Glyph = display.Glyph;
        _label.Text = display.DisplayLabel;

        // Displayed upper-cased (web `uppercase`) but spoken in its natural casing.
        AutomationProperties.SetName(_label, display.Label);
        _count.Text = display.CountText;
        AutomationProperties.SetName(_expander, display.AutomationName);

        RenderContent();
    }

    private void RenderContent()
    {
        if (_commands.Count == 0)
        {
            // Web parity is an empty grid; the native surface shows a friendly caption instead of a blank box.
            _empty.Message = _localizer.GetString("commands.group.empty", "No commands");
            _fade.Content = _empty;
            _renderedColumns = 0;
            return;
        }

        int columns = ColumnsForWidth(AvailableWidth());
        RebuildGrid(columns);
        _fade.Content = _grid;
    }

    private void RebuildGrid(int columns)
    {
        _grid.Children.Clear();
        _grid.ColumnDefinitions.Clear();
        _grid.RowDefinitions.Clear();

        for (int c = 0; c < columns; c++)
        {
            _grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        int rows = (int)Math.Ceiling(_commands.Count / (double)columns);
        for (int r = 0; r < rows; r++)
        {
            _grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }

        for (int i = 0; i < _commands.Count; i++)
        {
            UIElement tile = _commands[i];
            if (tile is FrameworkElement fe)
            {
                Grid.SetColumn(fe, i % columns);
                Grid.SetRow(fe, i / columns);
            }

            _grid.Children.Add(tile);
        }

        _renderedColumns = columns;
    }

    private void ApplyInitialExpansion()
    {
        bool expanded = CollapsibleCommandGroupProjection.ResolveInitialExpanded(_model, _store);

        // Programmatic restoration must not be recorded back into the store as a user toggle.
        _suppressPersist = true;
        _expander.IsExpanded = expanded;
        _suppressPersist = false;
    }

    private void OnExpanding(Expander sender, ExpanderExpandingEventArgs args)
    {
        if (!_suppressPersist)
        {
            _store.SetExpanded(_storageKey, true);
        }
    }

    private void OnCollapsed(Expander sender, ExpanderCollapsedEventArgs args)
    {
        if (!_suppressPersist)
        {
            _store.SetExpanded(_storageKey, false);
        }
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

    private void OnSizeChanged(object sender, SizeChangedEventArgs e)
    {
        if (_commands.Count == 0 || e.PreviousSize.Width == e.NewSize.Width)
        {
            return;
        }

        // Only rebuild when the available width crosses a breakpoint into a new column count.
        int columns = ColumnsForWidth(AvailableWidth());
        if (columns != _renderedColumns)
        {
            RebuildGrid(columns);
        }
    }

    private double AvailableWidth()
    {
        double width = _fade.ActualWidth;
        if (width <= 0)
        {
            width = ActualWidth;
        }

        return width;
    }

    // Web grid-cols-2 sm:grid-cols-3 lg:grid-cols-4. An unmeasured surface assumes the widest layout and
    // re-flows on the first SizeChanged.
    private static int ColumnsForWidth(double width) => width switch
    {
        <= 0 => WideColumns,
        < NarrowBreakpoint => NarrowColumns,
        < WideBreakpoint => MediumColumns,
        _ => WideColumns,
    };

    protected override AutomationPeer OnCreateAutomationPeer() => new CollapsibleCommandGroupAutomationPeer(this);

    private sealed class CollapsibleCommandGroupAutomationPeer(CollapsibleCommandGroup owner)
        : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;
    }
}
