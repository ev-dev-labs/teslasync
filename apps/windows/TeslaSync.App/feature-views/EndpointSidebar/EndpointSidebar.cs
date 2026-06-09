using System.Globalization;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using Windows.UI;
using DisplayTokens = TeslaSync.App.Components.DataDisplay.DisplayTokens;

namespace TeslaSync.App.FeatureViews.Endpoints;

/// <summary>
/// The native WinUI 3 EndpointSidebar surface — a parity port of
/// web/src/features/admin/components/EndpointSidebar.tsx. It reproduces the web component's composition: a
/// search field (a Fluent search glyph beside a <see cref="TsInput"/>, web <c>Input</c> with the
/// <c>playground.search</c> hint), an always-visible endpoint-count line (web
/// <c>{filtered.length} {t('playground.endpoints')}</c>), and a scrollable list of collapsible tag groups —
/// each a native <see cref="Expander"/> (the native idiom for the web <c>TagGroup</c> button + conditional
/// list, giving free ExpandCollapse keyboard + Narrator support) whose rows pair a method badge with the
/// endpoint path. When the search filter empties the list the groups are replaced by the localized
/// "No matching endpoints" message (web <c>filtered.length === 0</c>), announced through a polite live region
/// rather than hidden. The web source is presentational — its data arrives as props and its only hook is
/// <c>useTranslation</c> — so there is deliberately no loading / error / stale / offline branch to reproduce;
/// those belong to the parent page that owns the fetch. All filtering, grouping, default-open logic and
/// label resolution flow through the shared <see cref="EndpointSidebarViewModel"/> + the pure
/// <see cref="EndpointSidebarProjection"/>; the view never performs HTTP and never computes inline. Every
/// string resolves through the i18n facade and every interactive element carries a Narrator name.
/// </summary>
public sealed partial class EndpointSidebar : ContentControl, IDisposable
{
    private const string SearchGlyph = "\uE721";              // Segoe Fluent — Search (web Lucide Search)
    private const string SelectedAccentBrushKey = "TsColorInfoBrush"; // cyan/info accent (web border-cyan-400)
    private const byte BadgeFillAlpha = 48;                   // ~19% — web bg-{color}/20 badge wash
    private const byte SelectedFillAlpha = 28;               // ~11% — web bg-white/[0.07] selected wash

    private readonly EndpointSidebarViewModel _viewModel;
    private readonly EndpointSidebarDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly Grid _root = new();
    private readonly TsInput _search = new();
    private readonly TextBlock _count = new() { TextWrapping = TextWrapping.NoWrap };
    private readonly StackPanel _body = new() { Spacing = 0 };
    private readonly ScrollViewer _scroller = new();
    private readonly TextBlock _empty = new() { TextWrapping = TextWrapping.Wrap };

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;
    private bool _wasEmpty;

    /// <summary>Creates the surface over its i18n facade and the optional initial props.</summary>
    /// <param name="localizer">The i18n facade resolving every label (web <c>useTranslation</c>).</param>
    /// <param name="endpoints">The initial endpoint list (web <c>endpoints</c> prop); defaults to empty.</param>
    /// <param name="selected">The initially selected endpoint (web <c>selected</c> prop); defaults to none.</param>
    /// <param name="onSelect">The selection callback (web <c>onSelect</c> prop); invoked on a row click.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics collector for the <c>view.opened</c> event.</param>
    public EndpointSidebar(
        ILocalizer localizer,
        IReadOnlyList<ParsedEndpoint>? endpoints = null,
        ParsedEndpoint? selected = null,
        Action<ParsedEndpoint>? onSelect = null,
        EndpointSidebarDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _diagnostics = diagnostics ?? new EndpointSidebarDiagnostics();
        _viewModel = new EndpointSidebarViewModel(localizer, endpoints, selected, onSelect);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        BuildChrome();

        _search.TextChanged += OnSearchChanged;
        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>The diagnostics surface slug this view registers under (<c>EndpointSidebar</c>).</summary>
    public static string Slug => EndpointSidebarRegistration.Slug;

    /// <summary>The shared state holder — the parent drives selection / endpoints through it.</summary>
    public EndpointSidebarViewModel ViewModel => _viewModel;

    /// <summary>Convenience factory mirroring the sibling surfaces' <c>Create</c> entry point.</summary>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="endpoints">The initial endpoint list.</param>
    /// <param name="onSelect">The selection callback invoked on a row click.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics collector for the <c>view.opened</c> event.</param>
    public static EndpointSidebar Create(
        ILocalizer localizer,
        IReadOnlyList<ParsedEndpoint>? endpoints = null,
        Action<ParsedEndpoint>? onSelect = null,
        EndpointSidebarDiagnostics? diagnostics = null) =>
        new(localizer, endpoints, selected: null, onSelect, diagnostics);

    private void BuildChrome()
    {
        _root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        _root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        _root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });

        var searchSection = BuildSearchSection();
        Grid.SetRow(searchSection, 0);
        _root.Children.Add(searchSection);

        var countSection = BuildCountSection();
        Grid.SetRow(countSection, 1);
        _root.Children.Add(countSection);

        _empty.FontSize = 12;
        _empty.Foreground = DisplayTokens.TextMuted;
        _empty.TextAlignment = TextAlignment.Center;
        _empty.Padding = new Thickness(12, 24, 12, 24);
        _empty.HorizontalAlignment = HorizontalAlignment.Stretch;
        LiveRegion.Configure(_empty);

        _scroller.VerticalScrollBarVisibility = ScrollBarVisibility.Auto;
        _scroller.VerticalScrollMode = ScrollMode.Auto;
        _scroller.HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled;
        _scroller.HorizontalScrollMode = ScrollMode.Disabled;
        _scroller.Content = _body;
        Grid.SetRow(_scroller, 2);
        _root.Children.Add(_scroller);

        // web: the sidebar carries a right hairline (border-r). Wrap the grid so the divider is tokenized.
        var frame = new Border
        {
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(0, 0, 1, 0),
            Child = _root,
        };
        Content = frame;
    }

    private Border BuildSearchSection()
    {
        var grid = new Grid { ColumnSpacing = 8, VerticalAlignment = VerticalAlignment.Center };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        var icon = new FontIcon
        {
            Glyph = SearchGlyph,
            FontSize = 14,
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw); // decorative; field carries the name
        Grid.SetColumn(icon, 0);

        _search.HorizontalAlignment = HorizontalAlignment.Stretch;
        Grid.SetColumn(_search, 1);

        grid.Children.Add(icon);
        grid.Children.Add(_search);

        return new Border
        {
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(0, 0, 0, 1),
            Padding = new Thickness(8),
            Child = grid,
        };
    }

    private Border BuildCountSection()
    {
        _count.FontSize = 11;
        _count.Foreground = DisplayTokens.TextMuted;
        _count.VerticalAlignment = VerticalAlignment.Center;

        return new Border
        {
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(0, 0, 0, 1),
            Padding = new Thickness(12, 6, 12, 6),
            Child = _count,
        };
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_started)
        {
            return;
        }

        _started = true;
        _diagnostics.RecordViewOpened();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    /// <summary>Detach from the view-model and the search field (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _search.TextChanged -= OnSearchChanged;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        GC.SuppressFinalize(this);
    }

    private void OnSearchChanged(object sender, TextChangedEventArgs e) => _viewModel.UpdateSearch(_search.Text);

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
        EndpointSidebarDisplay display = _viewModel.Display;

        AutomationProperties.SetName(this, display.AutomationName);

        // Re-set the hint + name each render so an active-language change is reflected; never touch the
        // input's Text (the user owns it — the hint only shows when the field is empty).
        _search.Hint = display.SearchHint;
        AutomationProperties.SetName(_search, display.SearchAutomationName);

        _count.Text = display.CountLabel;

        _body.Children.Clear();
        if (display.IsEmpty)
        {
            _empty.Text = display.EmptyMessage;
            _body.Children.Add(_empty);
            if (!_wasEmpty)
            {
                LiveRegion.Announce(_empty);
            }

            _wasEmpty = true;
        }
        else
        {
            foreach (EndpointTagGroupDisplay group in display.Groups)
            {
                _body.Children.Add(BuildGroup(group));
            }

            _wasEmpty = false;
        }
    }

    private Expander BuildGroup(EndpointTagGroupDisplay group)
    {
        var rows = new StackPanel { Spacing = 0 };
        foreach (EndpointRowDisplay row in group.Rows)
        {
            rows.Children.Add(BuildRow(row));
        }

        var expander = new Expander
        {
            Header = BuildGroupHeader(group),
            Content = rows,
            IsExpanded = group.IsOpen,
            HorizontalAlignment = HorizontalAlignment.Stretch,
            HorizontalContentAlignment = HorizontalAlignment.Stretch,
            Margin = new Thickness(0),
        };
        AutomationProperties.SetName(expander, group.HeaderAutomationName);

        string tag = group.Tag;
        expander.Expanding += (_, _) => OnGroupToggle(tag, true);
        expander.Collapsed += (_, _) => OnGroupToggle(tag, false);
        return expander;
    }

    private static Grid BuildGroupHeader(EndpointTagGroupDisplay group)
    {
        var grid = new Grid { ColumnSpacing = 8, HorizontalAlignment = HorizontalAlignment.Stretch };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var tag = new TextBlock
        {
            Text = group.Tag.ToUpperInvariant(),
            FontSize = 12,
            FontWeight = FontWeights.SemiBold,
            Foreground = DisplayTokens.TextSecondary,
            CharacterSpacing = 60,
            TextTrimming = TextTrimming.CharacterEllipsis,
            VerticalAlignment = VerticalAlignment.Center,
        };
        Grid.SetColumn(tag, 0);

        var count = new TextBlock
        {
            Text = group.Count.ToString(CultureInfo.InvariantCulture),
            FontSize = 11,
            FontFamily = MonoFont(),
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Center,
        };
        Grid.SetColumn(count, 1);

        grid.Children.Add(tag);
        grid.Children.Add(count);
        return grid;
    }

    private TsButton BuildRow(EndpointRowDisplay row)
    {
        Border badge = BuildMethodBadge(row.MethodLabel, row.MethodBrushKey);

        var path = new TextBlock
        {
            Text = row.Path,
            FontFamily = MonoFont(),
            FontSize = 12,
            Foreground = DisplayTokens.TextSecondary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var content = new Grid { ColumnSpacing = 8, HorizontalAlignment = HorizontalAlignment.Stretch };
        content.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        content.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        Grid.SetColumn(badge, 0);
        Grid.SetColumn(path, 1);
        content.Children.Add(badge);
        content.Children.Add(path);

        var button = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Small,
            Content = content,
            HorizontalAlignment = HorizontalAlignment.Stretch,
            HorizontalContentAlignment = HorizontalAlignment.Stretch,
            Padding = new Thickness(12, 6, 12, 6),
            Margin = new Thickness(0),
        };

        if (row.IsSelected)
        {
            Brush accent = DisplayTokens.Brush(SelectedAccentBrushKey);
            button.BorderBrush = accent;
            button.BorderThickness = new Thickness(2, 0, 0, 0);
            button.Background = Wash(accent, SelectedFillAlpha);
        }

        AutomationProperties.SetName(button, row.AutomationName);
        if (!string.IsNullOrEmpty(row.Summary))
        {
            AutomationProperties.SetHelpText(button, row.Summary);
            ToolTipService.SetToolTip(button, row.Summary);
        }

        ParsedEndpoint endpoint = row.Endpoint;
        button.Click += (_, _) => _viewModel.Select(endpoint);
        return button;
    }

    private static Border BuildMethodBadge(string label, string brushKey)
    {
        Brush brush = DisplayTokens.Brush(brushKey);

        var text = new TextBlock
        {
            Text = label,
            FontFamily = MonoFont(),
            FontSize = 9,
            FontWeight = FontWeights.Bold,
            Foreground = brush,
            HorizontalAlignment = HorizontalAlignment.Center,
            TextAlignment = TextAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var badge = new Border
        {
            CornerRadius = DisplayTokens.Radius("TsRadiusSm", 4),
            Padding = new Thickness(4, 1, 4, 1),
            MinWidth = 48,
            Background = Wash(brush, BadgeFillAlpha),
            VerticalAlignment = VerticalAlignment.Center,
            Child = text,
        };
        AutomationProperties.SetAccessibilityView(badge, AccessibilityView.Raw); // verb is in the row's Narrator name
        return badge;
    }

    private void OnGroupToggle(string tag, bool open)
    {
        // Ignore the programmatic Expanding/Collapsed that fires when the view seeds IsExpanded; only persist
        // a genuine user change so a default-open group is not frozen as an override.
        if (_viewModel.IsGroupOpen(tag) == open)
        {
            return;
        }

        _viewModel.SetGroupOpen(tag, open);
    }

    private static Brush Wash(Brush brush, byte alpha)
    {
        if (brush is SolidColorBrush solid)
        {
            Color color = solid.Color;
            color.A = alpha;
            return new SolidColorBrush(color);
        }

        return brush;
    }

    private static FontFamily MonoFont() =>
        Application.Current?.Resources is { } res
        && res.TryGetValue("TsTypeFontFamilyMono", out object? value)
        && value is FontFamily family
            ? family
            : new FontFamily("Consolas");
}
