using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Documents;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.A11y;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using Windows.System;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 <c>WidgetPicker</c> feature surface — a parity port of
/// web/src/features/dashboard/components/WidgetPicker.tsx. It composes the web component's fragment as a
/// right-edge <see cref="TsDrawer"/> side sheet: a title bar with a close affordance, a sticky search box (the
/// web Lucide <c>Search</c>-prefixed input) with the "{n} widgets available" caption, a horizontally-scrolling
/// row of category filter pills (the web <c>role="tab"</c> chips, including the leading "All" pill), then a
/// scrollable body that shows — on the unsearched, "All" view — the "Recently Added" section (the web Lucide
/// <c>Clock</c> heading) and the "Layout Presets" cards, followed by either the registry-grouped category
/// sections (each with a "+ Add all {n}" action) or, while searching, the flat results with a results-count
/// bar / "Add all" action and a friendly no-results message; a footer surfaces the "{n} added" summary and a
/// "Done" button. Adds are announced through a <see cref="TsAnnouncerRegion"/> (the web
/// <c>VisuallyHidden liveRegion</c>). There is deliberately no loading / error / stale / offline chrome because
/// the web source is a controlled component over a static catalogue with no asynchronous read — the same shape
/// as the sibling <c>AddWidgetButton</c> / <c>LayoutSwitcher</c> / <c>MiniGridPreview</c> surfaces. All state,
/// filtering, label resolution and announcement composition flow through the shared
/// <see cref="WidgetPickerViewModel"/> / <see cref="WidgetPickerProjection"/>; the view never performs HTTP or
/// storage. Every string resolves through the i18n facade and every interactive element carries a Narrator
/// name. The surface uses no animations, so it is unaffected by the reduced-motion setting, and all text scales
/// with the system font size.
/// </summary>
public sealed partial class WidgetPicker : ContentControl, IDisposable
{
    private const double PaneWidth = 420;            // right side-sheet width (web Drawer)
    private const string CloseGlyph = "\uE8BB";       // Segoe Fluent — ChromeClose (web Drawer close)
    private const string FallbackWidgetGlyph = "\uE71D"; // Segoe Fluent — AllApps (unknown widget id)

    private readonly ILocalizer _localizer;
    private readonly WidgetPickerViewModel _viewModel;
    private readonly WidgetPickerDiagnostics _diagnostics;
    private readonly Microsoft.UI.Dispatching.DispatcherQueue? _dispatcher;

    private readonly TsDrawer _drawer = new() { Side = DrawerSide.Right, PaneWidth = PaneWidth };
    private readonly TsAnnouncerRegion _announcer = new();
    private readonly TextBlock _titleText = new() { TextTrimming = TextTrimming.CharacterEllipsis };
    private readonly TsButton _closeButton = new() { Variant = ButtonVariant.Subtle, Size = ControlSize.Small };
    private readonly TsInput _searchInput = new();
    private readonly TextBlock _availableCaption = new();
    private readonly StackPanel _pillsPanel = new() { Orientation = Orientation.Horizontal, Spacing = 6 };
    private readonly StackPanel _sectionsPanel = new() { Spacing = 16, Padding = new Thickness(16, 8, 16, 16) };
    private readonly Border _footerBorder = new();
    private readonly TextBlock _footerText = new();
    private readonly TsButton _doneButton = new() { Variant = ButtonVariant.Primary, Size = ControlSize.Small };

    private string _lastAnnouncement = string.Empty;
    private bool _suppressSearch;
    private bool _started;
    private bool _renderQueued;
    private bool _syncingDrawer;
    private bool _disposed;

    /// <summary>Creates the surface over its i18n facade, an optional model, diagnostics and a recently-added loader.</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="model">The catalogue + active ids; defaults to <see cref="WidgetPickerModel.Default"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    /// <param name="recentlyAddedLoader">The host's persisted recently-added loader (web <c>loadRecentlyAdded</c>).</param>
    public WidgetPicker(
        ILocalizer localizer,
        WidgetPickerModel? model = null,
        WidgetPickerDiagnostics? diagnostics = null,
        Func<IReadOnlyList<string>>? recentlyAddedLoader = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new WidgetPickerDiagnostics();
        _viewModel = new WidgetPickerViewModel(localizer, model ?? WidgetPickerModel.Default, _diagnostics, recentlyAddedLoader);
        _dispatcher = Microsoft.UI.Dispatching.DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;

        BuildChrome();
        Content = _drawer;

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        _drawer.RegisterPropertyChangedCallback(TsDrawer.IsOpenProperty, OnDrawerIsOpenChanged);
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>WidgetPicker</c>).</summary>
    public static string Slug => WidgetPickerRegistration.Slug;

    /// <summary>The backing state holder (exposed so a host can subscribe to the add / preset / close events).</summary>
    public WidgetPickerViewModel ViewModel => _viewModel;

    /// <summary>True while the drawer is open.</summary>
    public bool IsOpen => _viewModel.IsOpen;

    /// <summary>Convenience factory mirroring the sibling surfaces' <c>Create</c> entry point.</summary>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="model">The catalogue + active ids; defaults to <see cref="WidgetPickerModel.Default"/>.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics collector for the <c>view.opened</c> event.</param>
    /// <param name="recentlyAddedLoader">The host's persisted recently-added loader.</param>
    public static WidgetPicker Create(
        ILocalizer localizer,
        WidgetPickerModel? model = null,
        WidgetPickerDiagnostics? diagnostics = null,
        Func<IReadOnlyList<string>>? recentlyAddedLoader = null) =>
        new(localizer, model, diagnostics, recentlyAddedLoader);

    /// <summary>Open the picker drawer (web <c>open</c> → true), resetting the transient state.</summary>
    public void Open() => _viewModel.Open();

    /// <summary>Close the picker drawer (web <c>onClose()</c>).</summary>
    public void Close() => _viewModel.Close();

    /// <summary>Replace the active-widget ids (web <c>activeWidgetIds</c> prop change).</summary>
    /// <param name="activeWidgetIds">The ids now on the dashboard.</param>
    public void SetActiveWidgetIds(IReadOnlyList<string>? activeWidgetIds) =>
        _viewModel.SetActiveWidgetIds(activeWidgetIds);

    private void BuildChrome()
    {
        var content = new Grid { Width = PaneWidth };
        content.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        content.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        content.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        content.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

        content.Children.Add(BuildHeader());

        var topArea = BuildSearchArea();
        Grid.SetRow(topArea, 1);
        content.Children.Add(topArea);

        var bodyScroll = new ScrollViewer
        {
            Content = _sectionsPanel,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
        };
        Grid.SetRow(bodyScroll, 2);
        content.Children.Add(bodyScroll);

        BuildFooterChrome();
        Grid.SetRow(_footerBorder, 3);
        content.Children.Add(_footerBorder);

        // The live region is visually hidden but stays in the automation tree (web `VisuallyHidden liveRegion`).
        content.Children.Add(_announcer);

        _drawer.DrawerContent = content;
    }

    private Grid BuildHeader()
    {
        var header = new Grid { Padding = new Thickness(16, 14, 12, 12), ColumnSpacing = 8 };
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        header.BorderBrush = DisplayTokens.Border;
        header.BorderThickness = new Thickness(0, 0, 0, 1);

        _titleText.FontFamily = TypographyTokens.Sans;
        _titleText.FontSize = TypographyTokens.Size("TsTypeSectionFontSize", 18);
        _titleText.FontWeight = FontWeights.SemiBold;
        _titleText.Foreground = DisplayTokens.TextPrimary;
        _titleText.VerticalAlignment = VerticalAlignment.Center;
        Grid.SetColumn(_titleText, 0);
        header.Children.Add(_titleText);

        _closeButton.Content = DecorativeIcon(CloseGlyph, 16, DisplayTokens.TextSecondary);
        _closeButton.Click += OnCloseClick;
        Grid.SetColumn(_closeButton, 1);
        header.Children.Add(_closeButton);

        return header;
    }

    private Grid BuildSearchArea()
    {
        var area = new Grid { Padding = new Thickness(16, 12, 16, 8), RowSpacing = 10 };
        area.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        area.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        area.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

        var searchRow = new Grid { ColumnSpacing = 8 };
        searchRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        searchRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        FontIcon searchIcon = DecorativeIcon(WidgetPickerRegistration.SearchGlyph, 16, DisplayTokens.TextMuted);
        searchIcon.VerticalAlignment = VerticalAlignment.Center;
        Grid.SetColumn(searchIcon, 0);
        searchRow.Children.Add(searchIcon);

        _searchInput.HorizontalAlignment = HorizontalAlignment.Stretch;
        _searchInput.TextChanged += OnSearchTextChanged;
        _searchInput.KeyDown += OnSearchKeyDown;
        Grid.SetColumn(_searchInput, 1);
        searchRow.Children.Add(_searchInput);
        Grid.SetRow(searchRow, 0);
        area.Children.Add(searchRow);

        _availableCaption.FontFamily = TypographyTokens.Sans;
        _availableCaption.FontSize = TypographyTokens.Size("TsTypeCaptionFontSize", 12);
        _availableCaption.Foreground = DisplayTokens.TextMuted;
        Grid.SetRow(_availableCaption, 1);
        area.Children.Add(_availableCaption);

        var pillsScroll = new ScrollViewer
        {
            Content = _pillsPanel,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Auto,
            VerticalScrollBarVisibility = ScrollBarVisibility.Disabled,
            HorizontalScrollMode = ScrollMode.Enabled,
            VerticalScrollMode = ScrollMode.Disabled,
        };
        Grid.SetRow(pillsScroll, 2);
        area.Children.Add(pillsScroll);

        return area;
    }

    private void BuildFooterChrome()
    {
        _footerBorder.BorderBrush = DisplayTokens.Border;
        _footerBorder.BorderThickness = new Thickness(0, 1, 0, 0);
        _footerBorder.Padding = new Thickness(16, 12, 16, 14);
        _footerBorder.Visibility = Visibility.Collapsed;

        var grid = new Grid { ColumnSpacing = 12 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var countRow = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };
        countRow.Children.Add(DecorativeIcon(WidgetPickerRegistration.CheckGlyph, 14, DisplayTokens.Brush("TsColorSuccessBrush")));
        _footerText.FontFamily = TypographyTokens.Sans;
        _footerText.FontSize = TypographyTokens.Size("TsTypeBodyFontSize", 14);
        _footerText.FontWeight = FontWeights.Medium;
        _footerText.Foreground = DisplayTokens.TextPrimary;
        _footerText.VerticalAlignment = VerticalAlignment.Center;
        countRow.Children.Add(_footerText);
        Grid.SetColumn(countRow, 0);
        grid.Children.Add(countRow);

        _doneButton.Click += OnDoneClick;
        Grid.SetColumn(_doneButton, 1);
        grid.Children.Add(_doneButton);

        _footerBorder.Child = grid;
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_started)
        {
            return;
        }

        _started = true;
        Render();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    /// <summary>Detach from the view-model and stop rendering (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _searchInput.TextChanged -= OnSearchTextChanged;
        _searchInput.KeyDown -= OnSearchKeyDown;
        _closeButton.Click -= OnCloseClick;
        _doneButton.Click -= OnDoneClick;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
    }

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
        ScheduleRender();

    private void OnDrawerIsOpenChanged(DependencyObject sender, DependencyProperty dp)
    {
        if (_syncingDrawer)
        {
            return;
        }

        // Light-dismiss (Escape / click-away) closed the popup — keep the view-model in sync (web onClose).
        if (!_drawer.IsOpen && _viewModel.IsOpen)
        {
            _viewModel.Close();
        }
    }

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
        WidgetPickerDisplay display = _viewModel.Display;

        _syncingDrawer = true;
        if (_drawer.IsOpen != _viewModel.IsOpen)
        {
            _drawer.IsOpen = _viewModel.IsOpen;
        }

        _syncingDrawer = false;

        AutomationProperties.SetName(this, display.AutomationName);
        AutomationProperties.SetName(_drawer, display.AutomationName);
        _titleText.Text = display.Title;

        AutomationProperties.SetName(_closeButton, display.Title);
        ToolTipService.SetToolTip(_closeButton, display.Title);

        if (_searchInput.Text != display.SearchText)
        {
            _suppressSearch = true;
            _searchInput.Text = display.SearchText;
            _suppressSearch = false;
        }

        _searchInput.Hint = display.SearchHint;
        AutomationProperties.SetName(_searchInput, display.SearchHint);
        _availableCaption.Text = display.AvailableCountText;
        AutomationProperties.SetName(_pillsPanel, display.CategoryFilterLabel);

        BuildPills(display);
        BuildSections(display);

        _footerBorder.Visibility = display.ShowFooter ? Visibility.Visible : Visibility.Collapsed;
        _footerText.Text = display.AddedCountText;
        _doneButton.Text = display.DoneLabel;
        AutomationProperties.SetName(_doneButton, display.DoneLabel);

        if (!string.IsNullOrEmpty(display.Announcement) && display.Announcement != _lastAnnouncement)
        {
            _announcer.Announce(display.Announcement);
            _lastAnnouncement = display.Announcement;
        }
    }

    // ── Category filter pills (web role="tab" chips) ─────────────────────────────────────────────────

    private void BuildPills(WidgetPickerDisplay display)
    {
        _pillsPanel.Children.Clear();
        foreach (WidgetCategoryPill pill in display.Pills)
        {
            _pillsPanel.Children.Add(BuildPill(pill));
        }
    }

    private Button BuildPill(WidgetCategoryPill pill)
    {
        var label = new TextBlock
        {
            Text = pill.Label,
            FontFamily = TypographyTokens.Sans,
            FontSize = TypographyTokens.Size("TsTypeCaptionFontSize", 11),
            FontWeight = FontWeights.Medium,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var button = new Button
        {
            Content = label,
            Padding = new Thickness(12, 4, 12, 4),
            CornerRadius = new CornerRadius(14),
            BorderThickness = new Thickness(1),
        };

        if (pill.IsSelected)
        {
            button.Background = DisplayTokens.Brush("TsColorAccentSoftBrush");
            button.BorderBrush = DisplayTokens.Accent;
            label.Foreground = DisplayTokens.Accent;
        }
        else
        {
            button.Background = DisplayTokens.Surface;
            button.BorderBrush = DisplayTokens.Border;
            label.Foreground = DisplayTokens.TextSecondary;
        }

        AutomationProperties.SetName(button, pill.Label);
        button.Click += (_, _) => _viewModel.SetCategoryFilter(pill.Category);
        return button;
    }

    // ── Body sections (web recently-added / presets / grouped / search) ──────────────────────────────

    private void BuildSections(WidgetPickerDisplay display)
    {
        _sectionsPanel.Children.Clear();

        if (display.ShowRecentlyAdded)
        {
            _sectionsPanel.Children.Add(SectionHeading(display.RecentlyAddedHeading, WidgetPickerRegistration.RecentGlyph));
            _sectionsPanel.Children.Add(CardList(display.RecentlyAddedCards));
            _sectionsPanel.Children.Add(Separator());
        }

        if (display.ShowPresets)
        {
            _sectionsPanel.Children.Add(SectionHeading(display.PresetsHeading, null));
            var presetList = new StackPanel { Spacing = 8 };
            foreach (WidgetPresetCard preset in display.Presets)
            {
                presetList.Children.Add(BuildPresetCard(preset));
            }

            _sectionsPanel.Children.Add(presetList);
            _sectionsPanel.Children.Add(Separator());
        }

        if (display.IsSearching)
        {
            BuildSearchResults(display);
        }
        else
        {
            foreach (WidgetGroupView group in display.Groups)
            {
                _sectionsPanel.Children.Add(BuildGroupHeader(group));
                _sectionsPanel.Children.Add(CardList(group.Cards));
            }
        }
    }

    private void BuildSearchResults(WidgetPickerDisplay display)
    {
        if (display.ShowNoResults)
        {
            _sectionsPanel.Children.Add(new TextBlock
            {
                Text = display.NoResultsText,
                FontFamily = TypographyTokens.Sans,
                FontSize = TypographyTokens.Size("TsTypeBodyFontSize", 14),
                Foreground = DisplayTokens.TextMuted,
                TextAlignment = TextAlignment.Center,
                TextWrapping = TextWrapping.Wrap,
                Margin = new Thickness(0, 24, 0, 24),
            });
            return;
        }

        if (display.ShowSearchResultsBar)
        {
            var bar = new Grid
            {
                ColumnSpacing = 12,
                Padding = new Thickness(12, 8, 12, 8),
                BorderBrush = DisplayTokens.Border,
                BorderThickness = new Thickness(1),
                CornerRadius = DisplayTokens.Radius("TsRadiusLg", 12),
                Background = DisplayTokens.Surface,
            };
            bar.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            bar.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            var barText = new TextBlock
            {
                Text = display.SearchResultsText,
                FontFamily = TypographyTokens.Sans,
                FontSize = TypographyTokens.Size("TsTypeCaptionFontSize", 12),
                Foreground = DisplayTokens.TextMuted,
                TextTrimming = TextTrimming.CharacterEllipsis,
                VerticalAlignment = VerticalAlignment.Center,
            };
            Grid.SetColumn(barText, 0);
            bar.Children.Add(barText);

            var addAll = new TsButton
            {
                Variant = ButtonVariant.Subtle,
                Size = ControlSize.Small,
                Text = display.SearchAddAllLabel,
                IsEnabled = display.SearchAddAllEnabled,
            };
            AutomationProperties.SetName(addAll, display.SearchAddAllLabel);
            addAll.Click += (_, _) => _viewModel.AddAllSearchResults();
            Grid.SetColumn(addAll, 1);
            bar.Children.Add(addAll);

            _sectionsPanel.Children.Add(bar);
        }

        _sectionsPanel.Children.Add(CardList(display.SearchResults));
    }

    private Grid BuildGroupHeader(WidgetGroupView group)
    {
        var grid = new Grid { ColumnSpacing = 12 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var heading = new TextBlock
        {
            Text = group.Heading,
            FontFamily = TypographyTokens.Sans,
            FontSize = TypographyTokens.Size("TsTypeCaptionFontSize", 12),
            FontWeight = FontWeights.SemiBold,
            CharacterSpacing = 60,
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Center,
        };
        Grid.SetColumn(heading, 0);
        grid.Children.Add(heading);

        var addAll = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Small,
            Text = group.AddAllLabel,
            IsEnabled = group.AddAllEnabled,
        };
        AutomationProperties.SetName(addAll, group.AddAllLabel);
        WidgetCategory category = group.Category;
        addAll.Click += (_, _) => _viewModel.AddAllInCategory(category);
        Grid.SetColumn(addAll, 1);
        grid.Children.Add(addAll);

        return grid;
    }

    private StackPanel CardList(IReadOnlyList<WidgetCardView> cards)
    {
        var list = new StackPanel { Spacing = 8 };
        foreach (WidgetCardView card in cards)
        {
            list.Children.Add(BuildWidgetCard(card));
        }

        return list;
    }

    private Button BuildWidgetCard(WidgetCardView card)
    {
        var grid = new Grid { ColumnSpacing = 12 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        var iconBox = new Border
        {
            Background = DisplayTokens.Surface,
            CornerRadius = DisplayTokens.Radius("TsRadiusMd", 8),
            Padding = new Thickness(8),
            VerticalAlignment = VerticalAlignment.Top,
            Child = DecorativeIcon(card.IconGlyph ?? FallbackWidgetGlyph, 16, DisplayTokens.Accent),
        };
        Grid.SetColumn(iconBox, 0);
        grid.Children.Add(iconBox);

        var textStack = new StackPanel { Spacing = 2 };

        var nameRow = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 6,
            VerticalAlignment = VerticalAlignment.Center,
        };
        nameRow.Children.Add(HighlightedText(
            card.NameSpans,
            DisplayTokens.TextPrimary,
            TypographyTokens.Size("TsTypeBodyFontSize", 14),
            FontWeights.Medium));

        if (card.IsAdded)
        {
            var badge = new TsBadge
            {
                Status = StatusKind.Neutral,
                Content = new TextBlock
                {
                    Text = card.AddedBadgeLabel,
                    FontSize = TypographyTokens.Size("TsTypeCaptionFontSize", 12),
                },
                VerticalAlignment = VerticalAlignment.Center,
            };
            AutomationProperties.SetAccessibilityView(badge, AccessibilityView.Raw);
            nameRow.Children.Add(badge);
        }

        textStack.Children.Add(nameRow);

        textStack.Children.Add(HighlightedText(
            card.DescriptionSpans,
            DisplayTokens.TextMuted,
            TypographyTokens.Size("TsTypeCaptionFontSize", 12),
            FontWeights.Normal));

        var meta = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        meta.Children.Add(new TextBlock
        {
            Text = card.SizeText,
            FontFamily = TypographyTokens.Sans,
            FontSize = TypographyTokens.Size("TsTypeCaptionFontSize", 10),
            Foreground = DisplayTokens.TextMuted,
        });

        if (card.ShowCategoryLabel)
        {
            meta.Children.Add(new TextBlock
            {
                Text = card.CategoryLabel,
                FontFamily = TypographyTokens.Sans,
                FontSize = TypographyTokens.Size("TsTypeCaptionFontSize", 10),
                Foreground = DisplayTokens.TextMuted,
            });
        }

        textStack.Children.Add(meta);

        Grid.SetColumn(textStack, 1);
        grid.Children.Add(textStack);

        var button = new Button
        {
            Content = grid,
            Padding = new Thickness(12),
            CornerRadius = DisplayTokens.Radius("TsRadiusLg", 12),
            BorderThickness = new Thickness(1),
            BorderBrush = DisplayTokens.Border,
            Background = DisplayTokens.Surface,
            HorizontalAlignment = HorizontalAlignment.Stretch,
            HorizontalContentAlignment = HorizontalAlignment.Stretch,
            IsEnabled = !card.IsAdded,
            Opacity = card.IsAdded ? 0.4 : 1.0,
        };
        AutomationProperties.SetName(button, card.AutomationName);

        string widgetId = card.Id;
        button.Click += (_, _) => _viewModel.AddWidget(widgetId);

        // web: Ctrl/Cmd+Enter adds the focused widget and closes the drawer.
        var accelerator = new KeyboardAccelerator { Key = VirtualKey.Enter, Modifiers = VirtualKeyModifiers.Control };
        accelerator.Invoked += (_, args) =>
        {
            args.Handled = true;
            _viewModel.AddWidget(widgetId, closeAfterAdd: true);
        };
        button.KeyboardAccelerators.Add(accelerator);

        return button;
    }

    private Button BuildPresetCard(WidgetPresetCard preset)
    {
        var stack = new StackPanel { Spacing = 2 };
        stack.Children.Add(new TextBlock
        {
            Text = preset.Name,
            FontFamily = TypographyTokens.Sans,
            FontSize = TypographyTokens.Size("TsTypeBodyFontSize", 14),
            FontWeight = FontWeights.Medium,
            Foreground = DisplayTokens.TextPrimary,
        });
        stack.Children.Add(new TextBlock
        {
            Text = preset.WidgetCountText,
            FontFamily = TypographyTokens.Sans,
            FontSize = TypographyTokens.Size("TsTypeCaptionFontSize", 10),
            Foreground = DisplayTokens.TextMuted,
        });

        var button = new Button
        {
            Content = stack,
            Padding = new Thickness(12),
            CornerRadius = DisplayTokens.Radius("TsRadiusLg", 12),
            BorderThickness = new Thickness(1),
            BorderBrush = DisplayTokens.Border,
            Background = DisplayTokens.Surface,
            HorizontalAlignment = HorizontalAlignment.Stretch,
            HorizontalContentAlignment = HorizontalAlignment.Stretch,
        };
        AutomationProperties.SetName(button, preset.AutomationName);

        string presetId = preset.Id;
        button.Click += (_, _) => _viewModel.ApplyPreset(presetId);
        return button;
    }

    private static StackPanel SectionHeading(string text, string? glyph)
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };

        if (glyph is not null)
        {
            row.Children.Add(DecorativeIcon(glyph, 14, DisplayTokens.TextMuted));
        }

        row.Children.Add(new TextBlock
        {
            Text = text,
            FontFamily = TypographyTokens.Sans,
            FontSize = TypographyTokens.Size("TsTypeCaptionFontSize", 12),
            FontWeight = FontWeights.SemiBold,
            CharacterSpacing = 60,
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Center,
        });
        AutomationProperties.SetName(row, text);
        return row;
    }

    private static TextBlock HighlightedText(
        IReadOnlyList<WidgetHighlightSpan> spans,
        Brush baseBrush,
        double fontSize,
        Windows.UI.Text.FontWeight weight)
    {
        var block = new TextBlock
        {
            TextWrapping = TextWrapping.Wrap,
            FontFamily = TypographyTokens.Sans,
            FontSize = fontSize,
            FontWeight = weight,
            Foreground = baseBrush,
        };

        foreach (WidgetHighlightSpan span in spans)
        {
            var run = new Run { Text = span.Text };
            if (span.IsMatch)
            {
                run.Foreground = DisplayTokens.Accent;
                run.FontWeight = FontWeights.SemiBold;
            }

            block.Inlines.Add(run);
        }

        return block;
    }

    private static Border Separator() => new()
    {
        Height = 1,
        Background = DisplayTokens.Border,
    };

    private static FontIcon DecorativeIcon(string glyph, double size, Brush? brush = null)
    {
        var icon = new FontIcon { Glyph = glyph, FontSize = size };
        if (brush is not null)
        {
            icon.Foreground = brush;
        }

        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
        return icon;
    }

    private void OnSearchTextChanged(object sender, TextChangedEventArgs e)
    {
        if (_suppressSearch)
        {
            return;
        }

        _viewModel.SetSearch(_searchInput.Text);
    }

    private void OnSearchKeyDown(object sender, KeyRoutedEventArgs e)
    {
        switch (e.Key)
        {
            case VirtualKey.Escape:
                // web: Escape clears a non-empty search; an empty search bubbles up to close the drawer.
                if (!string.IsNullOrEmpty(_searchInput.Text))
                {
                    _viewModel.ClearSearch();
                    e.Handled = true;
                }

                break;

            case VirtualKey.Enter:
                // web: Enter with a query adds the result when exactly one addable widget matches.
                TryAddSoleSearchResult(e);
                break;

            default:
                break;
        }
    }

    private void TryAddSoleSearchResult(KeyRoutedEventArgs e)
    {
        WidgetPickerDisplay display = _viewModel.Display;
        if (!display.IsSearching)
        {
            return;
        }

        string? soleId = null;
        foreach (WidgetCardView card in display.SearchResults)
        {
            if (card.IsAdded)
            {
                continue;
            }

            if (soleId is not null)
            {
                return;
            }

            soleId = card.Id;
        }

        if (soleId is not null)
        {
            _viewModel.AddWidget(soleId);
            e.Handled = true;
        }
    }

    private void OnCloseClick(object sender, RoutedEventArgs e) => _viewModel.Close();

    private void OnDoneClick(object sender, RoutedEventArgs e) => _viewModel.Close();
}
