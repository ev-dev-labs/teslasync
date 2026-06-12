using Microsoft.UI;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using Windows.UI;
using DisplayTokens = TeslaSync.App.Components.DataDisplay.DisplayTokens;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 <c>LinearSidebar</c> shared surface — a parity port of the web <c>LinearSidebar</c>
/// (web/src/components/layout/sidebar/LinearSidebar.tsx), the Linear / Notion-inspired navigation tree that
/// replaces the default sidebar's <c>&lt;nav&gt;</c>. Like the web source it composes a single quiet,
/// monochrome column: an always-visible "Favorites" group (when anything is pinned), then tree-style sections
/// rendered as native <see cref="Expander"/>s (the idiom for the web click-to-collapse header + chevron, giving
/// free ExpandCollapse keyboard + Narrator support) whose rows pair a muted page-marker glyph with the nav
/// label, a 2px left accent bar + medium weight on the active row, an optional trailing affordance (an unread
/// dot for alerts, a monochrome count chip for vehicles / stale rows) and a hover/focus-revealed pin or unpin
/// action. When an active filter matches no section the tree is replaced by the localized "No matches." message
/// + a "Clear filter" button, announced through a polite live region rather than hidden. It binds the
/// <see cref="LinearSidebarViewModel"/> over the active-location and pinned-pages seams (P1/S8) and the i18n
/// facade (P1/S10); the view performs no router or storage I/O, reads every label from the projection, carries
/// the navigation landmark + a Narrator name on every interactive element, and emits the <c>view.opened</c>
/// diagnostic once when shown.
///
/// <para>
/// State coverage: the web source is presentational — its tree and favorites arrive as props and its only hooks
/// are <c>useLocation</c> and <c>useTranslation</c>, so it performs no data fetch and therefore has no
/// loading / error / stale / offline chrome to reproduce. The states it actually renders are reproduced in full
/// (the populated tree with favorites + collapsible sections, and the empty-filter branch). The surface honours
/// the system font scale through its text primitives and animates nothing beyond the Expander's built-in
/// reveal, so reduced-motion needs no special handling.
/// </para>
/// </summary>
public sealed partial class LinearSidebar : ContentControl, IDisposable
{
    private const string FavoritesGlyph = "\uE735";  // Segoe Fluent FavoriteStarFill — the web favorites header star.
    private const string PinGlyph = "\uE734";         // Segoe Fluent FavoriteStar (outline) — the web per-row pin action.
    private const string UnpinGlyph = "\uE711";       // Segoe Fluent ChromeClose — the web favorites unpin action.

    private const double LabelFontSize = 13;          // web text-[13px] nav rows.
    private const double HeaderFontSize = 11;         // web text-[10px] uppercase section / favorites headers.
    private const double CountFontSize = 10;          // web text-[10px] section count + chip.
    private const double GlyphSize = 14;              // web h-3.5 w-3.5 page-marker glyph.
    private const double AccentBarWidth = 2;          // web w-[2px] active accent bar.
    private const double NotificationDotSize = 6;     // web h-1.5 w-1.5 unread dot.
    private const double ChipMinWidth = 18;           // web min-w-[18px] count chip.
    private const byte ActiveWashAlpha = 12;          // web bg-white/[0.04] active row wash.
    private const byte ChipWashAlpha = 14;            // web bg-white/[0.05] count-chip wash.

    private readonly LinearSidebarViewModel _viewModel;
    private readonly LinearSidebarDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly ScrollViewer _scroller = new();
    private readonly StackPanel _navRoot = new() { Orientation = Orientation.Vertical, Spacing = 8 };

    private bool _opened;
    private bool _renderQueued;
    private bool _wasEmptyFilter;
    private bool _disposed;

    /// <summary>
    /// Creates a headless-safe surface over the passthrough localizer and in-memory seams with no sections — the
    /// native analogue of mounting the web component in an isolated gallery host. Production callers use the
    /// seam constructor.
    /// </summary>
    public LinearSidebar()
        : this(PassthroughLocalizer.Instance)
    {
    }

    /// <summary>Creates the surface over its i18n facade, the shared seams (P1/S8) and the initial props.</summary>
    /// <param name="localizer">The i18n facade resolving every surface-owned label (web <c>useTranslation</c>, P1/S10).</param>
    /// <param name="sections">The initial section catalogue (web <c>sections</c> prop); defaults to empty.</param>
    /// <param name="pinnedStore">The pinned-pages seam (web <c>pinnedItems</c> + <c>onPin</c> / <c>onUnpin</c>, P1/S8).</param>
    /// <param name="location">The active-location seam (web <c>useLocation</c>, P1/S8).</param>
    /// <param name="navLabel">The label resolver (web <c>navLabel</c> prop); null is treated as identity.</param>
    /// <param name="onItemSelect">The row-activation callback (web <c>onItemSelect</c>); the host navigates + closes the drawer.</param>
    /// <param name="activeSectionTitle">The title of the section containing the active page (web <c>activeSectionTitle</c> prop).</param>
    /// <param name="alertCount">The unread alert count (web <c>alertCount</c> prop).</param>
    /// <param name="vehicleCount">The vehicle count (web <c>vehicleCount</c> prop).</param>
    /// <param name="staleCount">The stale-rows count (web <c>staleCount</c> prop).</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics collector for the <c>view.opened</c> event.</param>
    public LinearSidebar(
        ILocalizer localizer,
        IReadOnlyList<LinearNavSection>? sections = null,
        IPinnedPagesStore? pinnedStore = null,
        INavLocationSource? location = null,
        Func<string, string>? navLabel = null,
        Action<string>? onItemSelect = null,
        string? activeSectionTitle = null,
        int alertCount = 0,
        int vehicleCount = 0,
        int staleCount = 0,
        LinearSidebarDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _diagnostics = diagnostics ?? new LinearSidebarDiagnostics();
        _viewModel = new LinearSidebarViewModel(
            localizer, sections, pinnedStore, location, navLabel, activeSectionTitle, alertCount, vehicleCount, staleCount);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        if (onItemSelect is not null)
        {
            _viewModel.ItemSelected += (_, to) => onItemSelect(to);
        }

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        BuildChrome();

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>The diagnostics surface slug this view registers under (<c>LinearSidebar</c>).</summary>
    public static string Slug => LinearSidebarRegistration.Slug;

    /// <summary>The shared state holder — the host drives sections, pins, active path and counts through it.</summary>
    public LinearSidebarViewModel ViewModel => _viewModel;

    /// <summary>Convenience factory mirroring the sibling surfaces' <c>Create</c> entry point.</summary>
    /// <param name="localizer">The i18n facade resolving every surface-owned label.</param>
    /// <param name="sections">The initial section catalogue (web <c>sections</c> prop).</param>
    /// <param name="navLabel">The label resolver (web <c>navLabel</c> prop).</param>
    /// <param name="onItemSelect">The row-activation callback (web <c>onItemSelect</c>).</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics collector for the <c>view.opened</c> event.</param>
    public static LinearSidebar Create(
        ILocalizer localizer,
        IReadOnlyList<LinearNavSection>? sections = null,
        Func<string, string>? navLabel = null,
        Action<string>? onItemSelect = null,
        LinearSidebarDiagnostics? diagnostics = null) =>
        new(localizer, sections, pinnedStore: null, location: null, navLabel, onItemSelect, diagnostics: diagnostics);

    private void BuildChrome()
    {
        _navRoot.Padding = new Thickness(8, 0, 8, 12);

        // web: <nav aria-label="Sidebar navigation"> — expose the navigation landmark + its accessible name.
        AutomationProperties.SetLandmarkType(_navRoot, AutomationLandmarkType.Navigation);

        _scroller.VerticalScrollBarVisibility = ScrollBarVisibility.Auto;
        _scroller.VerticalScrollMode = ScrollMode.Auto;
        _scroller.HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled;
        _scroller.HorizontalScrollMode = ScrollMode.Disabled;
        _scroller.Content = _navRoot;

        Content = _scroller;
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

    /// <summary>Detach from the view-model + lifecycle events and dispose the holder (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
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
        LinearSidebarDisplay display = _viewModel.Display;

        AutomationProperties.SetName(_navRoot, display.NavAutomationName);

        _navRoot.Children.Clear();

        if (display.Favorites is { } favorites)
        {
            _navRoot.Children.Add(BuildFavorites(favorites));
        }

        foreach (LinearSectionDisplay section in display.Sections)
        {
            _navRoot.Children.Add(BuildSection(section));
        }

        if (display.IsEmptyFilter)
        {
            FrameworkElement empty = BuildEmptyFilter(display);
            _navRoot.Children.Add(empty);
            if (!_wasEmptyFilter)
            {
                LiveRegion.Announce(empty);
            }

            _wasEmptyFilter = true;
        }
        else
        {
            _wasEmptyFilter = false;
        }
    }

    private StackPanel BuildFavorites(LinearFavoritesDisplay favorites)
    {
        var panel = new StackPanel { Orientation = Orientation.Vertical, Spacing = 1 };
        AutomationProperties.SetName(panel, favorites.Label);

        var header = new Grid { ColumnSpacing = 6, Padding = new Thickness(8, 4, 8, 4) };
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        var star = new FontIcon
        {
            Glyph = FavoritesGlyph,
            FontFamily = SymbolFont(),
            FontSize = 12,
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(star, AccessibilityView.Raw);
        Grid.SetColumn(star, 0);

        var label = new TextBlock
        {
            Text = favorites.Label.ToUpperInvariant(),
            FontSize = HeaderFontSize,
            FontWeight = FontWeights.SemiBold,
            Foreground = DisplayTokens.TextMuted,
            CharacterSpacing = 80,
            VerticalAlignment = VerticalAlignment.Center,
        };
        Grid.SetColumn(label, 1);

        header.Children.Add(star);
        header.Children.Add(label);
        panel.Children.Add(header);

        foreach (LinearNavLinkDisplay row in favorites.Items)
        {
            panel.Children.Add(BuildRow(row));
        }

        return panel;
    }

    private Expander BuildSection(LinearSectionDisplay section)
    {
        var rows = new StackPanel { Orientation = Orientation.Vertical, Spacing = 1 };
        foreach (LinearNavLinkDisplay row in section.Items)
        {
            rows.Children.Add(BuildRow(row));
        }

        var expander = new Expander
        {
            Header = BuildSectionHeader(section),
            Content = rows,
            IsExpanded = section.IsExpanded,
            HorizontalAlignment = HorizontalAlignment.Stretch,
            HorizontalContentAlignment = HorizontalAlignment.Stretch,
        };
        AutomationProperties.SetName(expander, section.Title);

        string title = section.Title;
        expander.Expanding += (_, _) => OnSectionToggle(title, true);
        expander.Collapsed += (_, _) => OnSectionToggle(title, false);
        return expander;
    }

    private static Grid BuildSectionHeader(LinearSectionDisplay section)
    {
        var grid = new Grid { ColumnSpacing = 8, HorizontalAlignment = HorizontalAlignment.Stretch };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var title = new TextBlock
        {
            Text = section.Title.ToUpperInvariant(),
            FontSize = HeaderFontSize,
            FontWeight = FontWeights.SemiBold,
            Foreground = DisplayTokens.TextSecondary,
            CharacterSpacing = 80,
            TextTrimming = TextTrimming.CharacterEllipsis,
            VerticalAlignment = VerticalAlignment.Center,
        };
        Grid.SetColumn(title, 0);

        var count = new TextBlock
        {
            Text = section.Count.ToString(System.Globalization.CultureInfo.InvariantCulture),
            FontSize = CountFontSize,
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(count, AccessibilityView.Raw);
        Grid.SetColumn(count, 1);

        grid.Children.Add(title);
        grid.Children.Add(count);
        return grid;
    }

    private Grid BuildRow(LinearNavLinkDisplay row)
    {
        var outer = new Grid { ColumnSpacing = 2, HorizontalAlignment = HorizontalAlignment.Stretch };
        outer.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        outer.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        TsButton navButton = BuildNavButton(row);
        Grid.SetColumn(navButton, 0);
        outer.Children.Add(navButton);

        TsButton? action = BuildHoverAction(row);
        if (action is not null)
        {
            Grid.SetColumn(action, 1);
            outer.Children.Add(action);

            // web: the pin/unpin action is opacity-0 and revealed on row hover or keyboard focus-within.
            action.Opacity = 0;
            outer.PointerEntered += (_, _) => action.Opacity = 1;
            outer.PointerExited += (_, _) => action.Opacity = IsFocusWithin(navButton, action) ? 1 : 0;
            navButton.GotFocus += (_, _) => action.Opacity = 1;
            action.GotFocus += (_, _) => action.Opacity = 1;
            navButton.LostFocus += (_, _) => action.Opacity = IsFocusWithin(navButton, action) ? 1 : 0;
            action.LostFocus += (_, _) => action.Opacity = IsFocusWithin(navButton, action) ? 1 : 0;
        }

        return outer;
    }

    private TsButton BuildNavButton(LinearNavLinkDisplay row)
    {
        var content = new Grid { ColumnSpacing = 10, HorizontalAlignment = HorizontalAlignment.Stretch };
        content.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        content.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        content.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var glyph = new FontIcon
        {
            Glyph = row.Glyph,
            FontFamily = SymbolFont(),
            FontSize = GlyphSize,
            Foreground = row.IsActive ? DisplayTokens.TextPrimary : DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(glyph, AccessibilityView.Raw);
        Grid.SetColumn(glyph, 0);

        var label = new TextBlock
        {
            Text = row.Label,
            FontSize = LabelFontSize,
            FontWeight = row.IsActive ? FontWeights.Medium : FontWeights.Normal,
            Foreground = row.IsActive ? DisplayTokens.TextPrimary : DisplayTokens.TextSecondary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
            VerticalAlignment = VerticalAlignment.Center,
        };
        Grid.SetColumn(label, 1);

        content.Children.Add(glyph);
        content.Children.Add(label);

        Border? trailing = BuildTrailing(row);
        if (trailing is not null)
        {
            Grid.SetColumn(trailing, 2);
            content.Children.Add(trailing);
        }

        var button = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Small,
            Content = content,
            HorizontalAlignment = HorizontalAlignment.Stretch,
            HorizontalContentAlignment = HorizontalAlignment.Stretch,
            Padding = new Thickness(12, 4, 8, 4),
            Margin = new Thickness(0),
        };
        AutomationProperties.SetName(button, row.AutomationName);

        if (row.IsActive)
        {
            // web: 2px left accent bar + subtle white wash on the active row.
            Brush accent = DisplayTokens.Accent;
            button.BorderBrush = accent;
            button.BorderThickness = new Thickness(AccentBarWidth, 0, 0, 0);
            button.Background = Wash(DisplayTokens.TextPrimary, ActiveWashAlpha);
            AutomationProperties.SetItemStatus(button, "current"); // web aria-current="page"
        }

        string to = row.To;
        button.Click += (_, _) => _viewModel.SelectItem(to);
        return button;
    }

    private TsButton? BuildHoverAction(LinearNavLinkDisplay row)
    {
        if (row.ShowUnpin)
        {
            return BuildActionButton(UnpinGlyph, row.UnpinLabel, row.To, pin: false);
        }

        if (row.ShowPin)
        {
            return BuildActionButton(PinGlyph, row.PinLabel, row.To, pin: true);
        }

        return null;
    }

    private TsButton BuildActionButton(string glyph, string label, string to, bool pin)
    {
        var button = new TsButton
        {
            Variant = ButtonVariant.Icon,
            Size = ControlSize.Small,
            IconGlyph = glyph,
            VerticalAlignment = VerticalAlignment.Center,
            Margin = new Thickness(0),
        };
        AutomationProperties.SetName(button, label);
        ToolTipService.SetToolTip(button, label);

        button.Click += (_, _) =>
        {
            if (pin)
            {
                _viewModel.Pin(to);
            }
            else
            {
                _viewModel.Unpin(to);
            }
        };
        return button;
    }

    private static Border? BuildTrailing(LinearNavLinkDisplay row) => row.Trailing switch
    {
        LinearTrailingKind.NotificationDot => BuildNotificationDot(),
        LinearTrailingKind.CountChip => BuildCountChip(row.TrailingValue, row.TrailingLabel),
        _ => null,
    };

    private static Border BuildNotificationDot()
    {
        var dot = new Border
        {
            Width = NotificationDotSize,
            Height = NotificationDotSize,
            CornerRadius = new CornerRadius(NotificationDotSize / 2),
            Background = DisplayTokens.Accent,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(dot, AccessibilityView.Raw); // web NotificationDot is aria-hidden
        return dot;
    }

    private static Border BuildCountChip(int value, string label)
    {
        var text = new TextBlock
        {
            Text = LinearSidebarRegistration.CountChipText(value),
            FontSize = CountFontSize,
            FontWeight = FontWeights.Medium,
            Foreground = DisplayTokens.TextSecondary,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var chip = new Border
        {
            MinWidth = ChipMinWidth,
            Height = 16,
            CornerRadius = new CornerRadius(6),
            Padding = new Thickness(4, 0, 4, 0),
            Background = Wash(DisplayTokens.TextPrimary, ChipWashAlpha),
            VerticalAlignment = VerticalAlignment.Center,
            Child = text,
        };
        AutomationProperties.SetName(chip, label);
        return chip;
    }

    private StackPanel BuildEmptyFilter(LinearSidebarDisplay display)
    {
        var panel = new StackPanel
        {
            Orientation = Orientation.Vertical,
            Spacing = 8,
            Padding = new Thickness(12, 16, 12, 16),
            HorizontalAlignment = HorizontalAlignment.Stretch,
        };
        LiveRegion.Configure(panel);

        var message = new TextBlock
        {
            Text = display.EmptyFilterMessage,
            FontSize = 12,
            Foreground = DisplayTokens.TextMuted,
            TextAlignment = TextAlignment.Center,
            TextWrapping = TextWrapping.Wrap,
            HorizontalAlignment = HorizontalAlignment.Stretch,
        };

        var clear = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Small,
            Content = display.ClearFilterLabel,
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        AutomationProperties.SetName(clear, display.ClearFilterLabel);
        clear.Click += (_, _) => _viewModel.ClearFilter();

        panel.Children.Add(message);
        panel.Children.Add(clear);
        return panel;
    }

    private void OnSectionToggle(string title, bool open)
    {
        // Ignore the programmatic Expanding/Collapsed that fires when a freshly-built section seeds IsExpanded;
        // only persist a genuine user change so the projection's collapse set is not churned needlessly.
        if (_viewModel.IsSectionExpanded(title) == open)
        {
            return;
        }

        _viewModel.ToggleSection(title);
    }

    private static bool IsFocusWithin(Control navButton, Control action) =>
        navButton.FocusState != FocusState.Unfocused || action.FocusState != FocusState.Unfocused;

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

    private static FontFamily SymbolFont() =>
        Application.Current?.Resources is { } res
        && res.TryGetValue("SymbolThemeFontFamily", out object? value)
        && value is FontFamily family
            ? family
            : new FontFamily("Segoe Fluent Icons");
}
