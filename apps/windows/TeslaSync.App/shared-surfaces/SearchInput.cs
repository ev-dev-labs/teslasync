using System.Globalization;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Automation.Provider;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using Windows.System;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 <c>SearchInput</c> shared surface — a parity port of the web <c>SearchInput</c>
/// (web/src/components/forms/SearchInput.tsx), the shared debounced search field used by list pages, the audit
/// log and other filterable surfaces. Like the web source it composes the shared input chrome (a tokenized
/// <see cref="Border"/> hosting a leading magnifier <see cref="FontIcon"/>, a borderless <see cref="TextBox"/>
/// and a trailing clear (×) <see cref="TsButton"/>) rather than wrapping a platform field, and — when a history
/// scope is supplied — anchors a recent-searches <see cref="Popup"/> under the field with a title, a scrollable
/// list of entries (each a select row plus a remove button) and a "Clear history" footer. It binds the
/// <see cref="SearchInputViewModel"/> over the history seam (<see cref="ISearchHistoryStore"/>) and the i18n
/// facade, drives the commit debounce through a <see cref="DispatcherQueueTimer"/>, and reproduces every state
/// the web source renders: the idle field, the clear affordance while text is present, and the recent-searches
/// dropdown with a keyboard-driven active descendant. The field carries the combobox Narrator semantics when
/// history is enabled and every interactive control has an accessible name. The view performs no storage I/O and
/// emits the <c>view.opened</c> diagnostic once when shown.
///
/// <para>
/// State coverage: the web source reads its history synchronously from a local store and performs no data
/// fetch, so it has no loading / error / stale / offline chrome to reproduce — a malformed store degrades to an
/// empty history rather than an error, there is no network round-trip and no query-freshness concept. The
/// states it actually has are reproduced in full (idle / typing / recent-searches dropdown). Reduced motion
/// needs no handling — the surface animates nothing — and the text honours the system font scale through its
/// text primitives.
/// </para>
/// </summary>
public sealed partial class SearchInput : ContentControl, IDisposable
{
    private const string SearchGlyph = "\uE721";   // Segoe Fluent "Search" — the web leading magnifier.
    private const string ClearGlyph = "\uE894";    // Segoe Fluent "Clear" — the web trailing × (clears the field).
    private const string RemoveGlyph = "\uE711";   // Segoe Fluent "ChromeClose" — the web per-row × (removes one entry).
    private const double FieldCornerRadius = 6;    // web rounded-md.
    private const double DropdownCornerRadius = 6; // web rounded-md.
    private const double DropdownMaxHeight = 256;  // web max-h-64.
    private const double RowPaddingX = 8;          // web px-2 inside the dropdown rows.
    private const double RowPaddingY = 6;          // web py-1.5.
    private const double IconSize = 16;            // web h-4 w-4 leading icon.
    private const double TitleFontSize = 11;       // web text-[11px] uppercase title.
    private const double OptionFontSize = 14;      // web text-sm entry rows.
    private const double FooterFontSize = 12;      // web text-xs footer.

    private readonly SearchInputViewModel _viewModel;
    private readonly SearchInputDiagnostics _diagnostics;
    // Fully qualified: Windows.System (imported for VirtualKey) also declares a DispatcherQueue / timer.
    private readonly Microsoft.UI.Dispatching.DispatcherQueue? _dispatcher;
    private readonly Microsoft.UI.Dispatching.DispatcherQueueTimer? _debounceTimer;

    private readonly Grid _root = new() { HorizontalAlignment = HorizontalAlignment.Stretch };
    private readonly Border _fieldBox = new()
    {
        CornerRadius = new CornerRadius(FieldCornerRadius),
        BorderThickness = new Thickness(1),
        Padding = new Thickness(8, 4, 4, 4),
        HorizontalAlignment = HorizontalAlignment.Stretch,
    };

    private readonly Grid _fieldGrid = new();
    private readonly FontIcon _searchIcon = new()
    {
        Glyph = SearchGlyph,
        FontFamily = new FontFamily("Segoe Fluent Icons"),
        FontSize = IconSize,
        VerticalAlignment = VerticalAlignment.Center,
        Margin = new Thickness(2, 0, 6, 0),
    };

    private readonly TextBox _input = new()
    {
        BorderThickness = new Thickness(0),
        Background = new SolidColorBrush(Microsoft.UI.Colors.Transparent),
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly TsButton _clear = new() { Variant = ButtonVariant.Icon, Size = ControlSize.Small, IconGlyph = ClearGlyph };

    private readonly Popup _popup = new() { DesiredPlacement = PopupPlacementMode.BottomEdgeAlignedLeft };
    private readonly Border _dropdown = new()
    {
        CornerRadius = new CornerRadius(DropdownCornerRadius),
        BorderThickness = new Thickness(1),
    };

    private readonly StackPanel _dropdownRoot = new() { Orientation = Orientation.Vertical };
    private readonly TextBlock _title = new()
    {
        FontSize = TitleFontSize,
        CharacterSpacing = 80,
        Margin = new Thickness(12, 6, 12, 4),
    };

    private readonly ScrollViewer _scroll = new()
    {
        MaxHeight = DropdownMaxHeight,
        VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
        HorizontalScrollMode = ScrollMode.Disabled,
    };

    private readonly StackPanel _list = new() { Orientation = Orientation.Vertical, Padding = new Thickness(4) };
    private readonly Border _footer = new() { BorderThickness = new Thickness(0, 1, 0, 0), Padding = new Thickness(4, 2, 4, 2) };
    private readonly TsButton _clearHistory = new()
    {
        Variant = ButtonVariant.Subtle,
        Size = ControlSize.Small,
        FontSize = FooterFontSize,
        HorizontalAlignment = HorizontalAlignment.Stretch,
        HorizontalContentAlignment = HorizontalAlignment.Left,
    };

    private string? _hint;
    private int _debounceMs = SearchInputRegistration.DefaultDebounceMs;
    private bool _autoFocus;
    private bool _suppressTextChanged;
    private bool _opened;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>
    /// Creates a headless-safe surface over an in-memory history store and the passthrough localizer with no
    /// history scope — the native analogue of mounting the web component in an isolated gallery host. It renders
    /// the idle, history-less field. Production callers use the seam constructor.
    /// </summary>
    public SearchInput()
        : this(PassthroughLocalizer.Instance, store: null, historyScope: null, diagnostics: null)
    {
    }

    /// <summary>Creates the surface over the i18n facade, the history seam and the optional history configuration.</summary>
    /// <param name="localizer">The i18n facade every label resolves through (P1/S10).</param>
    /// <param name="store">The recent-search history seam (P1/S8); defaults to an in-memory-backed store.</param>
    /// <param name="historyScope">The history storage scope (web <c>historyScope</c>); null/blank keeps the field history-less.</param>
    /// <param name="showHistoryOnFocus">Whether focusing the empty field shows the dropdown (web <c>showHistoryOnFocus</c>).</param>
    /// <param name="maxHistory">Maximum entries rendered in the dropdown (web <c>maxHistory</c>).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public SearchInput(
        ILocalizer localizer,
        ISearchHistoryStore? store = null,
        string? historyScope = null,
        bool showHistoryOnFocus = true,
        int maxHistory = SearchInputRegistration.DefaultMaxHistory,
        SearchInputDiagnostics? diagnostics = null)
        : this(
            new SearchInputViewModel(localizer, store, historyScope, showHistoryOnFocus, maxHistory),
            diagnostics)
    {
    }

    /// <summary>Creates the surface over an explicit state holder (tests / headless hosts) and diagnostics.</summary>
    /// <param name="viewModel">The backing state holder.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public SearchInput(SearchInputViewModel viewModel, SearchInputDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(viewModel);

        _viewModel = viewModel;
        _diagnostics = diagnostics ?? new SearchInputDiagnostics();
        _dispatcher = Microsoft.UI.Dispatching.DispatcherQueue.GetForCurrentThread();
        _debounceTimer = _dispatcher?.CreateTimer();

        IsTabStop = false;
        HorizontalAlignment = HorizontalAlignment.Stretch;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;

        BuildLayout();

        if (_debounceTimer is { } timer)
        {
            timer.IsRepeating = false;
            timer.Tick += OnDebounceTick;
        }

        _input.TextChanged += OnInputTextChanged;
        _input.GotFocus += OnInputGotFocus;
        _input.KeyDown += OnInputKeyDown;
        _clear.Click += OnClearClicked;
        _clearHistory.Click += OnClearHistoryClicked;
        LosingFocus += OnLosingFocus;
        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        _viewModel.LocalTextChanged += OnLocalTextChanged;
        _viewModel.FocusRequested += OnFocusRequested;
        _viewModel.ValueCommitted += OnValueCommitted;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render();
    }

    /// <summary>Raised when the committed search value changes (web <c>onChange</c>) — after debounce, on clear, or on selection.</summary>
    public event EventHandler<string>? ValueChanged;

    /// <summary>The canonical surface slug (<c>SearchInput</c>).</summary>
    public static string Slug => SearchInputRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public SearchInputViewModel ViewModel => _viewModel;

    /// <summary>The committed (controlled) search value (web <c>value</c>).</summary>
    public string Value
    {
        get => _viewModel.Value;
        set => _viewModel.Value = value;
    }

    /// <summary>The text shown while the field is empty — the web empty-field prompt text.</summary>
    public string? Hint
    {
        get => _hint;
        set
        {
            _hint = value;
            _input.PlaceholderText = value ?? string.Empty; // parity:allow PlaceholderText is the WinUI empty-field hint API
            string name = string.IsNullOrEmpty(value) ? SearchInputRegistration.HistoryTitleFallback : value;
            AutomationProperties.SetName(_input, name);
        }
    }

    /// <summary>The debounce window in milliseconds before the committed value is emitted (web <c>debounceMs</c>).</summary>
    public int DebounceMs
    {
        get => _debounceMs;
        set => _debounceMs = Math.Max(0, value);
    }

    /// <summary>Whether the field auto-focuses on first load (web <c>autoFocus</c>).</summary>
    public bool AutoFocus
    {
        get => _autoFocus;
        set => _autoFocus = value;
    }

    /// <summary>The history storage scope (web <c>historyScope</c>); null keeps the field history-less.</summary>
    public string? HistoryScope
    {
        get => _viewModel.HistoryScope;
        set => _viewModel.HistoryScope = value;
    }

    /// <summary>Optional override for the clear button's accessible name (web <c>clearLabel</c>).</summary>
    public string? ClearLabel
    {
        get => _viewModel.ClearLabelOverride;
        set => _viewModel.ClearLabelOverride = value;
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        if (_debounceTimer is { } timer)
        {
            timer.Stop();
            timer.Tick -= OnDebounceTick;
        }

        _input.TextChanged -= OnInputTextChanged;
        _input.GotFocus -= OnInputGotFocus;
        _input.KeyDown -= OnInputKeyDown;
        _clear.Click -= OnClearClicked;
        _clearHistory.Click -= OnClearHistoryClicked;
        LosingFocus -= OnLosingFocus;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _viewModel.LocalTextChanged -= OnLocalTextChanged;
        _viewModel.FocusRequested -= OnFocusRequested;
        _viewModel.ValueCommitted -= OnValueCommitted;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        _popup.IsOpen = false;
        GC.SuppressFinalize(this);
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new SearchInputAutomationPeer(this);

    private void BuildLayout()
    {
        _fieldGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        _fieldGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        _fieldGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        Grid.SetColumn(_searchIcon, 0);
        Grid.SetColumn(_input, 1);
        Grid.SetColumn(_clear, 2);
        _fieldGrid.Children.Add(_searchIcon);
        _fieldGrid.Children.Add(_input);
        _fieldGrid.Children.Add(_clear);
        _fieldBox.Child = _fieldGrid;

        _scroll.Content = _list;
        _footer.Child = _clearHistory;
        _dropdownRoot.Children.Add(_title);
        _dropdownRoot.Children.Add(_scroll);
        _dropdownRoot.Children.Add(_footer);
        _dropdown.Child = _dropdownRoot;
        _popup.Child = _dropdown;

        _root.Children.Add(_fieldBox);
        _root.Children.Add(_popup);
        Content = _root;

        _searchIcon.Foreground = DisplayTokens.TextMuted;
        _input.Foreground = DisplayTokens.TextPrimary;
        _fieldBox.BorderBrush = DisplayTokens.Border;
        _dropdown.Background = DisplayTokens.Surface;
        _dropdown.BorderBrush = DisplayTokens.Border;
        _title.Foreground = DisplayTokens.TextMuted;
        _footer.BorderBrush = DisplayTokens.Border;

        AutomationProperties.SetName(_input, SearchInputRegistration.HistoryTitleFallback);
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        _popup.XamlRoot = XamlRoot;
        _popup.PlacementTarget = _fieldBox;

        if (!_opened)
        {
            _opened = true;

            // Mirror the web component mount: emit the view.opened diagnostic exactly once.
            _diagnostics.RecordViewOpened();
        }

        if (_autoFocus)
        {
            _input.Focus(FocusState.Programmatic);
        }

        Render();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
        ScheduleRender();

    private void OnLocalTextChanged(object? sender, EventArgs e) => RestartDebounce();

    private void OnFocusRequested(object? sender, EventArgs e) =>
        Marshal(() => _input.Focus(FocusState.Programmatic));

    private void OnValueCommitted(object? sender, string value) => ValueChanged?.Invoke(this, value);

    private void OnDebounceTick(Microsoft.UI.Dispatching.DispatcherQueueTimer sender, object args)
    {
        sender.Stop();
        _viewModel.FlushDebounced();
    }

    private void OnInputTextChanged(object sender, TextChangedEventArgs e)
    {
        if (_suppressTextChanged)
        {
            return;
        }

        _viewModel.Type(_input.Text);
    }

    private void OnInputGotFocus(object sender, RoutedEventArgs e) => _viewModel.Focus();

    private void OnLosingFocus(UIElement sender, LosingFocusEventArgs args)
    {
        if (!_viewModel.HistoryEnabled)
        {
            return;
        }

        // web handleWrapperBlur: only treat focus leaving the entire surface (field + dropdown) as a blur. A
        // click on a dropdown row keeps focus inside the popup content (and re-focuses the field afterwards),
        // so those transitions are ignored here exactly as the web preventDefault keeps the input focused.
        if (args.NewFocusedElement is DependencyObject node && IsInsideSurface(node))
        {
            return;
        }

        _viewModel.Blur();
    }

    private void OnInputKeyDown(object sender, KeyRoutedEventArgs e)
    {
        switch (e.Key)
        {
            case VirtualKey.Down:
                e.Handled = _viewModel.MoveActiveDown();
                break;
            case VirtualKey.Up:
                e.Handled = _viewModel.MoveActiveUp();
                break;
            case VirtualKey.Enter:
                e.Handled = _viewModel.CommitActiveOrRecord();
                break;
            case VirtualKey.Escape:
                e.Handled = _viewModel.Escape();
                break;
            default:
                break;
        }
    }

    private void OnClearClicked(object sender, RoutedEventArgs e)
    {
        _viewModel.Clear();
        _input.Focus(FocusState.Programmatic);
    }

    private void OnClearHistoryClicked(object sender, RoutedEventArgs e) => _viewModel.ClearAll();

    private void RestartDebounce()
    {
        if (_debounceTimer is not { } timer)
        {
            // No UI dispatcher (headless host): commit synchronously so the value is never lost.
            _viewModel.FlushDebounced();
            return;
        }

        timer.Stop();
        if (_debounceMs <= 0)
        {
            _viewModel.FlushDebounced();
            return;
        }

        timer.Interval = TimeSpan.FromMilliseconds(_debounceMs);
        timer.Start();
    }

    private void ScheduleRender()
    {
        if (_renderQueued)
        {
            return;
        }

        _renderQueued = true;
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
        // Keep the field text in sync without clobbering the caret while the user types (the view-model's text
        // already equals what the user typed, so this only fires on commit / clear / external set).
        if (_input.Text != _viewModel.LocalText)
        {
            _suppressTextChanged = true;
            _input.Text = _viewModel.LocalText;
            _input.SelectionStart = _input.Text.Length;
            _suppressTextChanged = false;
        }

        // Clear (×) button — web suffix renders only when there is text.
        _clear.Visibility = _viewModel.ShowClear ? Visibility.Visible : Visibility.Collapsed;
        AutomationProperties.SetName(_clear, _viewModel.ClearLabel);

        RenderDropdown();

        _dropdown.MinWidth = _fieldBox.ActualWidth;
        _popup.IsOpen = _viewModel.DropdownVisible && IsLoaded;
    }

    private void RenderDropdown()
    {
        _title.Text = _viewModel.HistoryTitle.ToUpper(CultureInfo.CurrentCulture);
        AutomationProperties.SetAccessibilityView(_title, AccessibilityView.Raw);
        AutomationProperties.SetName(_list, _viewModel.HistoryTitle);

        _clearHistory.Text = _viewModel.ClearHistoryLabel;
        AutomationProperties.SetName(_clearHistory, _viewModel.ClearHistoryLabel);

        _list.Children.Clear();
        var entries = _viewModel.Entries;
        for (int i = 0; i < entries.Count; i++)
        {
            _list.Children.Add(BuildEntryRow(entries[i], i));
        }
    }

    private Grid BuildEntryRow(string entry, int index)
    {
        bool isActive = index == _viewModel.ActiveIndex;

        var rowIcon = new FontIcon
        {
            Glyph = SearchGlyph,
            FontFamily = new FontFamily("Segoe Fluent Icons"),
            FontSize = 14,
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Center,
            Margin = new Thickness(0, 0, 8, 0),
        };

        var label = new TextBlock
        {
            Text = entry,
            FontSize = OptionFontSize,
            Foreground = DisplayTokens.TextPrimary,
            VerticalAlignment = VerticalAlignment.Center,
            TextTrimming = TextTrimming.CharacterEllipsis,
        };

        var selectContent = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            VerticalAlignment = VerticalAlignment.Center,
        };
        selectContent.Children.Add(rowIcon);
        selectContent.Children.Add(label);

        var select = new Border
        {
            Child = selectContent,
            Padding = new Thickness(RowPaddingX, RowPaddingY, RowPaddingX, RowPaddingY),
            CornerRadius = new CornerRadius(4),
            Background = isActive ? DisplayTokens.Brush("TsColorSurfaceGlassBrush") : null,
            HorizontalAlignment = HorizontalAlignment.Stretch,
        };
        AutomationProperties.SetName(select, entry);
        AutomationProperties.SetAccessibilityView(label, AccessibilityView.Raw);

        string current = entry;
        int captured = index;
        select.PointerEntered += (_, _) => SetActive(captured);
        select.Tapped += (_, e) =>
        {
            e.Handled = true;
            _viewModel.SelectEntry(current);
        };

        var remove = new TsButton
        {
            Variant = ButtonVariant.Icon,
            Size = ControlSize.Small,
            IconGlyph = RemoveGlyph,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(remove, _viewModel.RemoveAriaFor(entry));
        remove.Click += (_, _) => _viewModel.RemoveEntry(current);

        var row = new Grid { Margin = new Thickness(2, 0, 2, 0) };
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(select, 0);
        Grid.SetColumn(remove, 1);
        row.Children.Add(select);
        row.Children.Add(remove);
        return row;
    }

    private void SetActive(int index)
    {
        if (index == _viewModel.ActiveIndex || index < 0 || index >= _viewModel.Entries.Count)
        {
            return;
        }

        // Pointer hover mirrors the web onMouseEnter -> setActiveIdx: walk the keyboard cursor to the row.
        int delta = index - _viewModel.ActiveIndex;
        for (int i = 0; i < Math.Abs(delta); i++)
        {
            if (delta > 0)
            {
                _viewModel.MoveActiveDown();
            }
            else
            {
                _viewModel.MoveActiveUp();
            }
        }
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

    private bool IsInsideSurface(DependencyObject? node)
    {
        while (node is not null)
        {
            if (ReferenceEquals(node, this) || ReferenceEquals(node, _dropdown))
            {
                return true;
            }

            node = VisualTreeHelper.GetParent(node);
        }

        return false;
    }

    /// <summary>
    /// Exposes the surface as a combobox when history is enabled (web <c>role="combobox"</c> with
    /// <c>aria-expanded</c> tracking the recent-searches dropdown), so Narrator reports the field and its
    /// expand/collapse state; a history-less field reports as a plain edit control.
    /// </summary>
    private sealed class SearchInputAutomationPeer : FrameworkElementAutomationPeer, IExpandCollapseProvider
    {
        public SearchInputAutomationPeer(SearchInput owner)
            : base(owner)
        {
        }

        private SearchInput Surface => (SearchInput)Owner;

        public ExpandCollapseState ExpandCollapseState =>
            Surface.ViewModel.DropdownVisible ? ExpandCollapseState.Expanded : ExpandCollapseState.Collapsed;

        public void Expand() => Surface.ViewModel.Focus();

        public void Collapse() => Surface.ViewModel.Escape();

        protected override AutomationControlType GetAutomationControlTypeCore() =>
            Surface.ViewModel.HistoryEnabled ? AutomationControlType.ComboBox : AutomationControlType.Edit;

        protected override object? GetPatternCore(PatternInterface patternInterface) =>
            patternInterface == PatternInterface.ExpandCollapse && Surface.ViewModel.HistoryEnabled
                ? this
                : base.GetPatternCore(patternInterface);

        protected override string GetNameCore()
        {
            string name = base.GetNameCore();
            return string.IsNullOrEmpty(name) ? Surface._hint ?? string.Empty : name;
        }
    }
}
