using System.ComponentModel;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Markup;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Forms;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 <c>SignalSelector</c> feature surface — a parity port of
/// web/src/features/telemetry/components/SignalSelector.tsx. The web component is a thin, <b>controlled</b>
/// wrapper over the shared <c>ComboboxMulti</c> specialised for signal names: a standard uppercase
/// <c>Signals (N / max)</c> label with an optional layer-help tooltip, a search-icon field that filters the
/// supplied signal names, monospace option rows, removable chips for the committed selection, and a hard cap
/// (default 5) that slices <c>onChange</c> so the chart stays legible. Its native counterpart is the Fluent
/// <see cref="AutoSuggestBox"/> — the same primitive the atomic <c>TsComboboxMulti</c> wraps and the same
/// mapping the sibling <c>AddressInput</c> / <c>SettingsSearch</c> surfaces chose — used directly here because
/// the atomic <c>TsComboboxMulti</c> is an <i>uncontrolled</i> picker with no parent-owned value, no cap and no
/// custom option rendering, and so cannot express the controlled-value + capped + monospace contract this
/// wrapper needs. All state flows through the WinUI-free <see cref="SignalSelectorViewModel"/>; the view never
/// owns the selection logic. The component performs no data fetch (its only web hook is <c>useTranslation</c>),
/// so every state it can be in is rendered — the populated picker, the chips, the "maximum reached" cap note and
/// the "no results" empty note — with no hidden surface and no loading / error / stale / offline branch. Every
/// string resolves through the i18n facade, the field and each chip's remove button carry a Narrator name, the
/// decorative search glyph is hidden from Narrator, and resting-state changes announce through a polite live
/// region. The surface adds no custom motion, so reduced-motion is honoured by construction.
/// </summary>
public sealed partial class SignalSelector : ContentControl, IDisposable
{
    private const double IconSize = 14; // web Search icon: h-3.5 w-3.5

    private readonly SignalSelectorViewModel _viewModel;
    private readonly SignalSelectorDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly StackPanel _root = new() { Spacing = 6 };
    private readonly StackPanel _labelRow = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = 4,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly Label _labelText = new();
    private readonly TsHelpTooltip _layerHelp = new();
    private readonly StackPanel _chips = new() { Orientation = Orientation.Horizontal, Spacing = 6 };
    private readonly ScrollViewer _chipsScroller;
    private readonly AutoSuggestBox _box = new();
    private readonly Caption _statusHint = new() { Visibility = Visibility.Collapsed };
    private readonly TextBlock _liveRegion;

    private string _query = string.Empty;
    private string? _announced;
    private bool _started;
    private bool _renderQueued;
    private bool _disposed;
    private bool _layerHelpAttached;

    /// <summary>Creates the surface over the i18n facade and an optional diagnostics sink.</summary>
    /// <param name="localizer">The i18n facade every string resolves through (P1/S10).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event (P1/S11).</param>
    public SignalSelector(ILocalizer localizer, SignalSelectorDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new SignalSelectorViewModel(localizer);
        _diagnostics = diagnostics ?? new SignalSelectorDiagnostics();
        _dispatcher = DispatcherQueue.GetForCurrentThread();
        _liveRegion = DisplayPrimitives.Caption();
        _chipsScroller = new ScrollViewer
        {
            Content = _chips,
            HorizontalScrollMode = ScrollMode.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Auto,
            VerticalScrollBarVisibility = ScrollBarVisibility.Disabled,
            Visibility = Visibility.Collapsed,
        };

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        AutomationProperties.SetAutomationId(this, SignalSelectorRegistration.Id);

        BuildChrome();

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        _viewModel.SelectionChanged += OnViewModelSelectionChanged;
        _box.TextChanged += OnBoxTextChanged;
        _box.SuggestionChosen += OnSuggestionChosen;
        _box.QuerySubmitted += OnQuerySubmitted;
        _box.KeyDown += OnBoxKeyDown;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render();
    }

    /// <summary>Raised whenever the committed selection changes (web <c>onChange</c>), carrying the new set.</summary>
    public event EventHandler<IReadOnlyList<string>>? SelectionChanged;

    /// <summary>The canonical surface id (<c>signal-selector</c>).</summary>
    public static string SurfaceId => SignalSelectorRegistration.Id;

    /// <summary>The diagnostics surface slug this view registers under (<c>SignalSelector</c>).</summary>
    public static string Slug => SignalSelectorRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics).</summary>
    public SignalSelectorViewModel ViewModel => _viewModel;

    /// <summary>The committed selection in pick order (web <c>value</c>); never null.</summary>
    public IReadOnlyList<string> SelectedValues => _viewModel.SelectedValues;

    /// <summary>The hard chip cap (web <c>max</c>, default 5); <c>null</c> means uncapped.</summary>
    public int? Max
    {
        get => _viewModel.Max;
        set => _viewModel.SetMax(value);
    }

    /// <summary>Whether the layer-help tooltip shows next to the label (web <c>showLayerHelp</c>, default true).</summary>
    public bool ShowLayerHelp
    {
        get => _viewModel.ShowLayerHelp;
        set => _viewModel.SetShowLayerHelp(value);
    }

    /// <summary>An explicit label overriding the computed <c>Signals (N / max)</c> text (web <c>labelOverride</c>).</summary>
    public string? LabelOverride
    {
        get => _viewModel.LabelOverride;
        set => _viewModel.SetLabelOverride(value);
    }

    /// <summary>Replace the available signals (web <c>options</c>).</summary>
    public void SetSignals(IReadOnlyList<string>? signals) => _viewModel.SetOptions(signals);

    /// <summary>Replace the committed selection (web <c>value</c>), enforcing the cap.</summary>
    public void SetSelected(IReadOnlyList<string>? values) => _viewModel.SetSelected(values);

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _viewModel.SelectionChanged -= OnViewModelSelectionChanged;
        _box.TextChanged -= OnBoxTextChanged;
        _box.SuggestionChosen -= OnSuggestionChosen;
        _box.QuerySubmitted -= OnQuerySubmitted;
        _box.KeyDown -= OnBoxKeyDown;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        GC.SuppressFinalize(this);
    }

    private void BuildChrome()
    {
        _box.QueryIcon = new FontIcon { Glyph = SignalSelectorRegistration.SearchGlyph, FontSize = IconSize };
        _box.TextMemberPath = nameof(ComboOption.Label);
        _box.UpdateTextOnSelect = false; // keep the typed filter while arrowing; chosen rows are added, not echoed
        _box.ItemTemplate = BuildOptionTemplate();
        _box.HorizontalAlignment = HorizontalAlignment.Stretch;
        AutomationProperties.SetName(_box, _viewModel.SignalsWord);

        _labelRow.Children.Add(_labelText);

        _liveRegion.Visibility = Visibility.Collapsed;
        LiveRegion.Configure(_liveRegion);

        _root.Children.Add(_labelRow);
        _root.Children.Add(_chipsScroller);
        _root.Children.Add(_box);
        _root.Children.Add(_statusHint);
        _root.Children.Add(_liveRegion);

        Content = _root;
    }

    private static DataTemplate BuildOptionTemplate()
    {
        // web renderOption: <span className="font-mono text-xs">{signal}</span>
        const string xaml = """
            <DataTemplate xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation">
                <TextBlock Text="{Binding Label}" FontFamily="{ThemeResource TsTypeFontFamilyMono}"
                           FontSize="12" Padding="2" TextWrapping="NoWrap"
                           TextTrimming="CharacterEllipsis" />
            </DataTemplate>
            """;
        return (DataTemplate)XamlReader.Load(xaml);
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

    private void OnViewModelSelectionChanged(object? sender, IReadOnlyList<string> selection) =>
        SelectionChanged?.Invoke(this, selection);

    private void OnBoxTextChanged(AutoSuggestBox sender, AutoSuggestBoxTextChangedEventArgs args)
    {
        if (args.Reason != AutoSuggestionBoxTextChangeReason.UserInput)
        {
            return;
        }

        _query = sender.Text;
        RefreshSuggestions();
    }

    private void OnSuggestionChosen(AutoSuggestBox sender, AutoSuggestBoxSuggestionChosenEventArgs args)
    {
        if (args.SelectedItem is ComboOption option)
        {
            CommitAdd(option.Value);
        }
    }

    private void OnQuerySubmitted(AutoSuggestBox sender, AutoSuggestBoxQuerySubmittedEventArgs args)
    {
        // Enter on a highlighted suggestion adds it; a free-text submit adds nothing (web only adds real options).
        if (args.ChosenSuggestion is ComboOption option)
        {
            CommitAdd(option.Value);
        }
    }

    private void OnBoxKeyDown(object sender, KeyRoutedEventArgs e)
    {
        // web: Backspace at an empty input removes the trailing chip — a keyboard-only discoverability win.
        if (e.Key == Windows.System.VirtualKey.Back && string.IsNullOrEmpty(_box.Text) && _viewModel.SelectedCount > 0)
        {
            _viewModel.RemoveLast();
            e.Handled = true;
        }
    }

    private void CommitAdd(string value)
    {
        _viewModel.Add(value);
        _query = string.Empty;
        _box.Text = string.Empty; // programmatic — raises TextChanged with a non-UserInput reason (ignored)
        _box.IsSuggestionListOpen = false;
    }

    private void OnViewModelPropertyChanged(object? sender, PropertyChangedEventArgs e) => ScheduleRender();

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
        _labelText.Value = _viewModel.Label;
        _box.PlaceholderText = _viewModel.IsAtMax ? _viewModel.MaxReachedText : _viewModel.SearchPrompt; // parity:allow PlaceholderText is the WinUI hint API

        ApplyLayerHelp();
        RefreshSuggestions();
        RenderChips();
        UpdateStatusHint();
        UpdateLiveRegion();
    }

    private void ApplyLayerHelp()
    {
        if (_viewModel.ShowLayerHelp)
        {
            _layerHelp.Hint = _viewModel.LayerHelpHint;
            AutomationProperties.SetName(_layerHelp, _viewModel.LayerHelpAria);
            if (!_layerHelpAttached)
            {
                _labelRow.Children.Add(_layerHelp);
                _layerHelpAttached = true;
            }
        }
        else if (_layerHelpAttached)
        {
            _labelRow.Children.Remove(_layerHelp);
            _layerHelpAttached = false;
        }
    }

    private void RefreshSuggestions()
    {
        // web: defaultFilter then hide already-selected rows. AvailableOptions already excludes the selection.
        _box.ItemsSource = ComboboxFilter.Filter(_viewModel.AvailableOptions, _query);
    }

    private void RenderChips()
    {
        _chips.Children.Clear();
        foreach (string value in _viewModel.SelectedValues)
        {
            string captured = value;
            var remove = new TsButton { Variant = ButtonVariant.Icon, IconGlyph = SignalSelectorRegistration.RemoveGlyph };
            AutomationProperties.SetName(remove, _viewModel.RemoveChipLabel(value));
            remove.Click += (_, _) =>
            {
                _viewModel.Remove(captured);
                _ = _box.Focus(FocusState.Programmatic);
            };

            var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 4 };
            row.Children.Add(new Code { Value = value, VerticalAlignment = VerticalAlignment.Center });
            row.Children.Add(remove);
            _chips.Children.Add(new Border
            {
                Child = row,
                CornerRadius = new CornerRadius(999),
                BorderBrush = TypographyTokens.Brush("TsColorBorderBrush"),
                BorderThickness = new Thickness(1),
                Padding = new Thickness(8, 2, 4, 2),
            });
        }

        _chipsScroller.Visibility = _viewModel.SelectedCount > 0 ? Visibility.Visible : Visibility.Collapsed;
    }

    private void UpdateStatusHint()
    {
        // Never a blank field: an empty option set shows the "no results" note; a full selection shows the cap note.
        string? hint = _viewModel.State == SignalSelectorState.Empty
            ? _viewModel.NoResultsText
            : _viewModel.IsAtMax ? _viewModel.MaxReachedText : null;

        if (string.IsNullOrEmpty(hint))
        {
            _statusHint.Visibility = Visibility.Collapsed;
        }
        else
        {
            _statusHint.Value = hint;
            _statusHint.Visibility = Visibility.Visible;
        }
    }

    private void UpdateLiveRegion()
    {
        string? message = _viewModel.StatusAnnouncement;
        if (string.IsNullOrEmpty(message))
        {
            _liveRegion.Visibility = Visibility.Collapsed;
            _announced = null;
            return;
        }

        _liveRegion.Text = message;
        _liveRegion.Visibility = Visibility.Visible;
        AutomationProperties.SetName(_liveRegion, message);

        if (!string.Equals(_announced, message, StringComparison.Ordinal))
        {
            _announced = message;
            LiveRegion.Announce(_liveRegion);
        }
    }
}
