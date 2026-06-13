using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Animation;
using TeslaSync.App.Components.A11y;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Forms;
using TeslaSync.App.Core.Notifications;
using Windows.System;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 <c>TreeSelect</c> shared surface — a parity port of
/// <c>web/src/components/forms/TreeSelect.tsx</c>, the generic tri-state two-level (groups → leaves) tree
/// multi-select. Like the web source it composes its own tree (rather than wrapping the platform
/// <see cref="TreeView"/>): a tokenized search box (a borderless <see cref="TextBox"/> with a leading search glyph
/// and a trailing clear button), a header row carrying a tri-state "select visible" <see cref="TsCheckbox"/> with
/// its Select/Clear-all (+ "{{count}} visible") label, the selected/visible counts and a clear-all action, and a
/// scrollable tree body whose group rows carry an expand chevron, a tri-state group checkbox, the label and a
/// <c>{selected}/{visible}</c> count over leaf rows with a per-leaf checkbox and disabled state. It binds the
/// <see cref="TreeSelectViewModel"/> (over the Core selection engine + the i18n facade) and reproduces every state
/// the web source renders: the four-row pulse skeleton while loading, the empty-catalog text, the "no matches"
/// text, and the populated tree. Selection is independent of the search filter, group / select-visible toggles
/// only touch visible-enabled leaves, and the rows implement the web roving-tabindex keyboard model (arrows /
/// Home / End / expand / collapse / focus-parent / Space-toggle / Enter-expand). Each interactive element carries
/// an accessible name, the selection summary is mirrored to a polite live region, and the surface emits the
/// <c>view.opened</c> diagnostic once when shown. The view performs no I/O.
///
/// <para>
/// State coverage: the web component is a controlled, prop-fed primitive with no fetch, query-freshness or
/// connectivity concept, so — like the peer presentational surfaces (Accordion / Combobox) — it has no error /
/// stale / offline chrome to reproduce. Every branch it does have is reproduced in full (loading / empty /
/// no-results / populated), and reduce-motion gates the skeleton pulse through <see cref="MotionPreference"/>.
/// </para>
/// </summary>
public sealed partial class TreeSelect : ContentControl, IDisposable
{
    private const string SearchGlyph = "\uE721";       // Segoe Fluent "Search".
    private const string ClearGlyph = "\uE894";        // Segoe Fluent "Clear" (web × icon).
    private const string ChevronRightGlyph = "\uE76C"; // Segoe Fluent "ChevronRight" — collapsed group.
    private const string ChevronDownGlyph = "\uE70D";  // Segoe Fluent "ChevronDown" — expanded group.

    private const double RootSpacing = 8;              // web gap-2.
    private const double IconSize = 16;                // web h-4 w-4.
    private const double LabelFontSize = 14;           // web text-sm.
    private const double SmallFontSize = 12;           // web text-xs.
    private const double DefaultMaxBodyHeight = 420;   // web max-h-[60vh] (a sensible fixed native cap).
    private const int SkeletonRows = 4;                // web Array.from({ length: 4 }).

    private static readonly Thickness GroupRowPadding = new(8, 6, 8, 6);   // web px-2 py-1.5.
    private static readonly Thickness LeafRowPadding = new(36, 4, 8, 4);   // web pl-9 pr-2 py-1.
    private static readonly SolidColorBrush TransparentFill = new(Microsoft.UI.Colors.Transparent);

    private readonly TreeSelectViewModel _viewModel;
    private readonly TreeSelectDiagnostics _diagnostics;
    private readonly Microsoft.UI.Dispatching.DispatcherQueue? _dispatcher;
    private readonly bool _reduceMotion;

    private readonly StackPanel _root = new() { Spacing = RootSpacing, HorizontalAlignment = HorizontalAlignment.Stretch };

    // Search box.
    private readonly Border _searchBox = new()
    {
        CornerRadius = new CornerRadius(6),
        BorderThickness = new Thickness(1),
        Padding = new Thickness(8, 2, 4, 2),
        HorizontalAlignment = HorizontalAlignment.Stretch,
    };

    private readonly Grid _searchGrid = new() { ColumnSpacing = 6 };
    private readonly FontIcon _searchIcon = new() { Glyph = SearchGlyph, FontSize = IconSize, VerticalAlignment = VerticalAlignment.Center };
    private readonly TextBox _search = new()
    {
        BorderThickness = new Thickness(0),
        Background = new SolidColorBrush(Microsoft.UI.Colors.Transparent),
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly TsButton _clearSearch = new() { Variant = ButtonVariant.Icon, Size = ControlSize.Small, IconGlyph = ClearGlyph };

    // Header (select-all + counts).
    private readonly Grid _header = new() { Margin = new Thickness(4, 0, 4, 0) };
    private readonly TsCheckbox _selectAll = new() { IsThreeState = true, VerticalAlignment = VerticalAlignment.Center };
    private readonly StackPanel _headerRight = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = 12,
        VerticalAlignment = VerticalAlignment.Center,
        HorizontalAlignment = HorizontalAlignment.Right,
    };

    private readonly TextBlock _counts = new() { FontSize = SmallFontSize, VerticalAlignment = VerticalAlignment.Center };
    private readonly TsButton _clearAll = new() { Variant = ButtonVariant.Subtle, Size = ControlSize.Small };

    // Body.
    private readonly Border _bodyBox = new() { BorderThickness = new Thickness(1) };
    private readonly ScrollViewer _bodyScroll = new()
    {
        VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
        HorizontalScrollMode = ScrollMode.Disabled,
    };

    private readonly StackPanel _body = new() { Orientation = Orientation.Vertical };
    private readonly TsVisuallyHidden _summary = new();

    private readonly List<ContentControl> _rowControls = new();
    private Storyboard? _skeletonPulse;
    private bool _suppressSearchText;
    private bool _opened;
    private bool _disposed;

    /// <summary>
    /// Creates a headless-safe surface over an empty catalog and the passthrough localizer — the native analogue
    /// of mounting the web component in an isolated gallery host. It renders the empty state. Production callers
    /// use a seam constructor.
    /// </summary>
    public TreeSelect()
        : this(PassthroughLocalizer.Instance, groups: null)
    {
    }

    /// <summary>Creates the surface over its i18n facade, the catalog and the optional presentation seams.</summary>
    /// <param name="localizer">The i18n facade every label resolves through (P1/S10).</param>
    /// <param name="groups">The group catalog (web <c>groups</c>); null renders the empty state.</param>
    /// <param name="initialSelection">The initially-selected leaf values (web <c>selectedIds</c>).</param>
    /// <param name="searchValue">The initial search value (web <c>searchValue</c>).</param>
    /// <param name="isLoading">Whether the catalog is loading (web <c>isLoading</c>).</param>
    /// <param name="expandedByDefault">Whether groups start expanded; the web default is collapsed.</param>
    /// <param name="getLeafDisabled">Predicate marking a leaf visible-but-uncheckable (web <c>getLeafDisabled</c>).</param>
    /// <param name="getLeafDisabledReason">Reason for a disabled leaf (web <c>getLeafDisabledReason</c>).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public TreeSelect(
        ILocalizer localizer,
        IReadOnlyList<TreeGroup>? groups,
        IReadOnlyList<string>? initialSelection = null,
        string searchValue = "",
        bool isLoading = false,
        bool expandedByDefault = false,
        Func<TreeLeaf, bool>? getLeafDisabled = null,
        Func<TreeLeaf, string?>? getLeafDisabledReason = null,
        TreeSelectDiagnostics? diagnostics = null)
        : this(
            new TreeSelectViewModel(
                groups ?? Array.Empty<TreeGroup>(),
                localizer,
                initialSelection,
                searchValue,
                isLoading,
                expandedByDefault,
                getLeafDisabled,
                getLeafDisabledReason),
            diagnostics)
    {
    }

    /// <summary>Creates the surface over an explicit state holder (tests / headless hosts) and diagnostics.</summary>
    /// <param name="viewModel">The backing state holder.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public TreeSelect(TreeSelectViewModel viewModel, TreeSelectDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(viewModel);

        _viewModel = viewModel;
        _diagnostics = diagnostics ?? new TreeSelectDiagnostics();
        _dispatcher = Microsoft.UI.Dispatching.DispatcherQueue.GetForCurrentThread();
        _reduceMotion = MotionPreference.ReduceMotion;

        IsTabStop = false;
        HorizontalAlignment = HorizontalAlignment.Stretch;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;

        BuildLayout();

        _search.TextChanged += OnSearchTextChanged;
        _clearSearch.Click += OnClearSearchClicked;
        _selectAll.Click += OnSelectAllClicked;
        _clearAll.Click += OnClearAllClicked;
        _bodyBox.KeyDown += OnBodyKeyDown;
        _viewModel.PropertyChanged += OnViewModelChanged;
        _viewModel.FocusMoved += OnFocusMoved;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render();
    }

    /// <summary>The canonical surface slug (<c>TreeSelect</c>).</summary>
    public static string Slug => TreeSelectRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public TreeSelectViewModel ViewModel => _viewModel;

    /// <summary>The maximum height of the scrollable tree body (web <c>max-h-[60vh]</c>).</summary>
    public double MaxBodyHeight
    {
        get => _bodyScroll.MaxHeight;
        set => _bodyScroll.MaxHeight = value;
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _search.TextChanged -= OnSearchTextChanged;
        _clearSearch.Click -= OnClearSearchClicked;
        _selectAll.Click -= OnSelectAllClicked;
        _clearAll.Click -= OnClearAllClicked;
        _bodyBox.KeyDown -= OnBodyKeyDown;
        _viewModel.PropertyChanged -= OnViewModelChanged;
        _viewModel.FocusMoved -= OnFocusMoved;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        StopSkeletonPulse();
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    private void BuildLayout()
    {
        // Search row: [icon auto][input *][clear auto].
        _searchGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        _searchGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        _searchGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(_searchIcon, 0);
        Grid.SetColumn(_search, 1);
        Grid.SetColumn(_clearSearch, 2);
        AutomationProperties.SetAccessibilityView(_searchIcon, AccessibilityView.Raw);
        _searchGrid.Children.Add(_searchIcon);
        _searchGrid.Children.Add(_search);
        _searchGrid.Children.Add(_clearSearch);
        _searchBox.Child = _searchGrid;

        // Header row: [select-all *][counts + clear-all auto].
        _header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        _header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(_selectAll, 0);
        Grid.SetColumn(_headerRight, 1);
        _headerRight.Children.Add(_counts);
        _headerRight.Children.Add(_clearAll);
        _header.Children.Add(_selectAll);
        _header.Children.Add(_headerRight);

        // Body.
        _bodyScroll.MaxHeight = DefaultMaxBodyHeight;
        _bodyScroll.Content = _body;
        _bodyBox.Child = _bodyScroll;
        _bodyBox.CornerRadius = DisplayTokens.Radius(TreeSelectRegistration.CornerRadiusKey, TreeSelectRegistration.CornerRadiusFallback);
        _bodyBox.Background = DisplayTokens.Brush(TreeSelectRegistration.SurfaceBrushKey);
        _bodyBox.BorderBrush = DisplayTokens.Brush(TreeSelectRegistration.BorderBrushKey);

        // The summary is a polite live region (web VisuallyHidden aria-live="polite").
        AutomationProperties.SetLiveSetting(_summary, AutomationLiveSetting.Polite);

        _searchBox.BorderBrush = DisplayTokens.Brush(TreeSelectRegistration.BorderBrushKey);
        _search.Foreground = DisplayTokens.Brush(TreeSelectRegistration.TextPrimaryBrushKey);
        _searchIcon.Foreground = DisplayTokens.Brush(TreeSelectRegistration.TextMutedBrushKey);
        _counts.Foreground = DisplayTokens.Brush(TreeSelectRegistration.TextMutedBrushKey);

        _root.Children.Add(_searchBox);
        _root.Children.Add(_header);
        _root.Children.Add(_bodyBox);
        _root.Children.Add(_summary);
        Content = _root;
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (!_opened)
        {
            _opened = true;
            _diagnostics.RecordViewOpened();
        }

        Render();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnViewModelChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) => Marshal(Render);

    private void OnFocusMoved(object? sender, int index) => Marshal(() => FocusRow(index));

    private void OnSearchTextChanged(object sender, TextChangedEventArgs e)
    {
        if (_suppressSearchText)
        {
            return;
        }

        _viewModel.SetSearch(_search.Text);
    }

    private void OnClearSearchClicked(object sender, RoutedEventArgs e)
    {
        _viewModel.ClearSearch();
        _search.Focus(FocusState.Programmatic);
    }

    private void OnSelectAllClicked(object sender, RoutedEventArgs e) => _viewModel.ToggleAllVisible();

    private void OnClearAllClicked(object sender, RoutedEventArgs e) => _viewModel.ClearAllSelected();

    private void OnBodyKeyDown(object sender, KeyRoutedEventArgs e)
    {
        switch (e.Key)
        {
            case VirtualKey.Down:
                _viewModel.FocusNext();
                e.Handled = true;
                break;
            case VirtualKey.Up:
                _viewModel.FocusPrevious();
                e.Handled = true;
                break;
            case VirtualKey.Home:
                _viewModel.FocusFirst();
                e.Handled = true;
                break;
            case VirtualKey.End:
                _viewModel.FocusLast();
                e.Handled = true;
                break;
            case VirtualKey.Right:
                _viewModel.ExpandFocused();
                e.Handled = true;
                break;
            case VirtualKey.Left:
                _viewModel.CollapseOrFocusParent();
                e.Handled = true;
                break;
            case VirtualKey.Space:
                _viewModel.ToggleSelectionAtFocus();
                e.Handled = true;
                break;
            case VirtualKey.Enter:
                _viewModel.ToggleExpansionAtFocus();
                e.Handled = true;
                break;
            default:
                break;
        }
    }

    private void Render()
    {
        // Search.
        _search.PlaceholderText = _viewModel.SearchHint; // parity:allow PlaceholderText is the WinUI hint API
        AutomationProperties.SetName(_search, _viewModel.FilterAria);
        if (_search.Text != _viewModel.Search)
        {
            _suppressSearchText = true;
            _search.Text = _viewModel.Search;
            _search.SelectionStart = _search.Text.Length;
            _suppressSearchText = false;
        }

        _clearSearch.Visibility = _viewModel.ShowClearSearch ? Visibility.Visible : Visibility.Collapsed;
        AutomationProperties.SetName(_clearSearch, _viewModel.ClearSearchLabel);

        // Header.
        _selectAll.Content = _viewModel.SelectAllLabel;
        _selectAll.IsChecked = ToIsChecked(_viewModel.HeaderCheckState);
        _selectAll.IsEnabled = _viewModel.HeaderCanToggle;
        AutomationProperties.SetName(_selectAll, _viewModel.SelectAllLabel);

        _counts.Text = _viewModel.SelectedSummary;
        _clearAll.Text = _viewModel.ClearAllSelectedLabel;
        _clearAll.Visibility = _viewModel.ShowClearAllSelected ? Visibility.Visible : Visibility.Collapsed;
        AutomationProperties.SetName(_clearAll, _viewModel.ClearAllSelectedLabel);

        // Body accessible name + live summary.
        AutomationProperties.SetName(_bodyBox, _viewModel.TreeLabel);
        _summary.Text = _viewModel.Summary;

        RenderBody();
    }

    private void RenderBody()
    {
        bool hadFocus = TreeHasFocus();
        StopSkeletonPulse();
        _body.Children.Clear();
        _rowControls.Clear();

        switch (_viewModel.VisualState)
        {
            case TreeSelectVisualState.Loading:
                RenderSkeleton();
                break;
            case TreeSelectVisualState.Empty:
                _body.Children.Add(BuildBodyMessage(_viewModel.EmptyLabel));
                break;
            case TreeSelectVisualState.NoResults:
                _body.Children.Add(BuildBodyMessage(_viewModel.NoResultsLabel));
                break;
            case TreeSelectVisualState.Populated:
            default:
                RenderRows();
                break;
        }

        if (hadFocus && _rowControls.Count > 0)
        {
            FocusRow(_viewModel.FocusIndex);
        }
    }

    private void RenderSkeleton()
    {
        var bars = new List<Border>(SkeletonRows);
        var host = new StackPanel { Spacing = 8, Padding = new Thickness(12) };
        for (int i = 0; i < SkeletonRows; i++)
        {
            var bar = new Border
            {
                Height = 24,
                CornerRadius = new CornerRadius(4),
                Background = DisplayTokens.Brush("TsColorSurfaceGlassBrush"),
            };
            AutomationProperties.SetAccessibilityView(bar, AccessibilityView.Raw);
            bars.Add(bar);
            host.Children.Add(bar);
        }

        var loading = new TsVisuallyHidden { Text = _viewModel.LoadingLabel };
        AutomationProperties.SetLiveSetting(loading, AutomationLiveSetting.Polite);
        host.Children.Add(loading);
        _body.Children.Add(host);

        StartSkeletonPulse(bars);
    }

    private void RenderRows()
    {
        foreach (TreeSelectRow row in _viewModel.Rows)
        {
            ContentControl control = row.Kind == TreeSelectRowKind.Group ? BuildGroupRow(row) : BuildLeafRow(row);
            control.IsTabStop = row.RowIndex == _viewModel.FocusIndex;
            control.UseSystemFocusVisuals = true;
            _rowControls.Add(control);
            _body.Children.Add(control);
        }
    }

    private ContentControl BuildGroupRow(TreeSelectRow row)
    {
        var grid = new Grid { Padding = GroupRowPadding, ColumnSpacing = 8, Background = TransparentFill };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var chevron = new FontIcon
        {
            Glyph = row.IsExpanded ? ChevronDownGlyph : ChevronRightGlyph,
            FontSize = IconSize,
            VerticalAlignment = VerticalAlignment.Center,
            Foreground = DisplayTokens.Brush(TreeSelectRegistration.TextMutedBrushKey),
        };
        AutomationProperties.SetAccessibilityView(chevron, AccessibilityView.Raw);

        var checkbox = new TsCheckbox
        {
            IsThreeState = true,
            IsChecked = ToIsChecked(row.CheckState),
            IsEnabled = row.CanToggle,
            IsTabStop = false,
            MinWidth = 0,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(checkbox, row.ToggleName);
        string groupKey = row.GroupKey;
        int groupIndex = row.RowIndex;
        checkbox.Click += (_, _) =>
        {
            // Move roving focus onto the group row (a checkbox click does not focus the row), then toggle so the
            // rebuild the toggle triggers refocuses this group rather than a stale index.
            _viewModel.SetFocusIndex(groupIndex);
            _viewModel.ToggleGroupVisible(groupKey);
        };

        var label = new TextBlock
        {
            Text = row.Label,
            FontSize = LabelFontSize,
            TextTrimming = TextTrimming.CharacterEllipsis,
            VerticalAlignment = VerticalAlignment.Center,
            Foreground = DisplayTokens.Brush(TreeSelectRegistration.TextPrimaryBrushKey),
        };

        var count = new TextBlock
        {
            Text = TreeSelectRegistration.GroupCount(row.SelectedCount, row.VisibleCount),
            FontSize = SmallFontSize,
            FontFamily = new FontFamily("Consolas"),
            VerticalAlignment = VerticalAlignment.Center,
            Foreground = DisplayTokens.Brush(TreeSelectRegistration.TextMutedBrushKey),
        };

        Grid.SetColumn(chevron, 0);
        Grid.SetColumn(checkbox, 1);
        Grid.SetColumn(label, 2);
        Grid.SetColumn(count, 3);
        grid.Children.Add(chevron);
        grid.Children.Add(checkbox);
        grid.Children.Add(label);
        grid.Children.Add(count);

        var rowControl = new ContentControl
        {
            Content = grid,
            HorizontalContentAlignment = HorizontalAlignment.Stretch,
            Padding = new Thickness(0),
        };
        AutomationProperties.SetName(rowControl, row.AccessibleName);
        AutomationProperties.SetAutomationId(rowControl, row.AutomationId);
        int index = row.RowIndex;
        rowControl.GotFocus += (_, _) => _viewModel.SetFocusIndex(index);
        rowControl.Tapped += (_, e) =>
        {
            // web: header click toggles expand; a click on the checkbox is intercepted.
            if (IsDescendantOf(e.OriginalSource as DependencyObject, checkbox))
            {
                return;
            }

            e.Handled = true;
            _viewModel.SetFocusIndex(index);
            _viewModel.ToggleExpanded(groupKey);
        };
        AttachHover(grid);
        return rowControl;
    }

    private ContentControl BuildLeafRow(TreeSelectRow row)
    {
        var grid = new Grid { Padding = LeafRowPadding, ColumnSpacing = 8, Background = TransparentFill };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        var checkbox = new TsCheckbox
        {
            IsChecked = row.CheckState == TreeCheckState.Checked,
            IsEnabled = !row.IsDisabled,
            IsTabStop = false,
            IsHitTestVisible = false,
            MinWidth = 0,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(checkbox, AccessibilityView.Raw);

        var label = new TextBlock
        {
            Text = row.Label,
            FontSize = LabelFontSize,
            TextTrimming = TextTrimming.CharacterEllipsis,
            VerticalAlignment = VerticalAlignment.Center,
            Foreground = DisplayTokens.Brush(TreeSelectRegistration.TextPrimaryBrushKey),
        };

        Grid.SetColumn(checkbox, 0);
        Grid.SetColumn(label, 1);
        grid.Children.Add(checkbox);
        grid.Children.Add(label);

        var rowControl = new ContentControl
        {
            Content = grid,
            HorizontalContentAlignment = HorizontalAlignment.Stretch,
            Padding = new Thickness(0),
            Opacity = row.IsDisabled ? 0.5 : 1,
        };
        AutomationProperties.SetName(rowControl, row.AccessibleName);
        AutomationProperties.SetAutomationId(rowControl, row.AutomationId);

        int index = row.RowIndex;
        bool disabled = row.IsDisabled;
        string? value = row.LeafValue;
        rowControl.GotFocus += (_, _) => _viewModel.SetFocusIndex(index);
        rowControl.Tapped += (_, e) =>
        {
            e.Handled = true;
            _viewModel.SetFocusIndex(index);
            if (!disabled && value is not null)
            {
                _viewModel.ToggleLeaf(value);
            }
        };

        if (!disabled)
        {
            AttachHover(grid);
        }

        return rowControl;
    }

    private static TextBlock BuildBodyMessage(string message) => new()
    {
        Text = message,
        FontSize = SmallFontSize,
        Foreground = DisplayTokens.Brush(TreeSelectRegistration.TextMutedBrushKey),
        TextWrapping = TextWrapping.Wrap,
        TextAlignment = TextAlignment.Center,
        Padding = new Thickness(24),
        HorizontalAlignment = HorizontalAlignment.Stretch,
    };

    private static void AttachHover(Panel surface)
    {
        Brush hover = DisplayTokens.Brush("TsColorSurfaceGlassBrush");
        surface.PointerEntered += (_, _) => surface.Background = hover;
        surface.PointerExited += (_, _) => surface.Background = TransparentFill;
    }

    private void FocusRow(int index)
    {
        if (index < 0 || index >= _rowControls.Count)
        {
            return;
        }

        for (int i = 0; i < _rowControls.Count; i++)
        {
            _rowControls[i].IsTabStop = i == index;
        }

        _rowControls[index].Focus(FocusState.Programmatic);
    }

    private bool TreeHasFocus()
    {
        if (XamlRoot is null)
        {
            return false;
        }

        DependencyObject? focused = FocusManager.GetFocusedElement(XamlRoot) as DependencyObject;
        while (focused is not null)
        {
            if (ReferenceEquals(focused, _bodyBox))
            {
                return true;
            }

            focused = VisualTreeHelper.GetParent(focused);
        }

        return false;
    }

    private void StartSkeletonPulse(List<Border> bars)
    {
        if (_reduceMotion || bars.Count == 0)
        {
            return;
        }

        var storyboard = new Storyboard();
        foreach (Border bar in bars)
        {
            var fade = new DoubleAnimation
            {
                From = 1,
                To = 0.4,
                Duration = new Duration(TimeSpan.FromMilliseconds(800)),
                AutoReverse = true,
                RepeatBehavior = RepeatBehavior.Forever,
            };
            Storyboard.SetTarget(fade, bar);
            Storyboard.SetTargetProperty(fade, "Opacity");
            storyboard.Children.Add(fade);
        }

        _skeletonPulse = storyboard;
        storyboard.Begin();
    }

    private void StopSkeletonPulse()
    {
        _skeletonPulse?.Stop();
        _skeletonPulse = null;
    }

    private void Marshal(Action action)
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

    private static bool? ToIsChecked(TreeCheckState state) => state switch
    {
        TreeCheckState.Checked => true,
        TreeCheckState.Indeterminate => null,
        _ => false,
    };

    private static bool IsDescendantOf(DependencyObject? source, DependencyObject ancestor)
    {
        DependencyObject? current = source;
        while (current is not null)
        {
            if (ReferenceEquals(current, ancestor))
            {
                return true;
            }

            current = VisualTreeHelper.GetParent(current);
        }

        return false;
    }
}
