using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 <c>AddressInput</c> feature surface — a parity port of
/// web/src/features/driving/components/AddressInput.tsx. The web component is a thin wrapper over the shared
/// <c>Combobox</c> (@/components/forms) configured as an async geocode autocomplete: a leading map-pin glyph, a
/// debounced (400&#160;ms) free-text field whose raw text the parent owns via <c>value</c>/<c>onChange</c>, and a
/// suggestion list fed by <c>useGeocodeSearch(debouncedQuery)</c> (enabled only at three or more characters) whose
/// rows each render a map-pin and the two-line-clamped <c>display_name</c>; choosing one fires <c>onSelect</c> with
/// the resolved coordinates. The native counterpart of that <c>Combobox</c> is the Fluent
/// <see cref="AutoSuggestBox"/> (the same primitive the atomic <c>TsCombobox</c> wraps) — used directly here
/// because the atomic <c>TsCombobox</c> is a static, self-filtering, single-value picker and cannot express the
/// async, free-text, parent-owned-value contract this surface needs. All data flows through the shared
/// <see cref="AddressInputViewModel"/>; the view never performs HTTP. Every state the cache-then-network layer can
/// produce is rendered — the in-flight searching indicator, the no-matches hint, the stale and offline chips, and
/// the hard-error retry — so none is ever a hidden surface. Every string resolves through the i18n facade, the
/// field, retry control and chips carry a Narrator name, the decorative map-pins are hidden from Narrator, and
/// state changes announce through a polite live region. The surface adds no custom motion, so reduced-motion is
/// honoured by construction.
/// </summary>
public sealed partial class AddressInput : ContentControl, IDisposable
{
    private const string RetryGlyph = "\uE72C"; // Segoe Fluent — Refresh
    private const double IconSize = 16;

    private readonly AddressInputViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly AddressInputDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;
    private readonly DispatcherQueueTimer? _debounce;

    private readonly StackPanel _root = new() { Spacing = 6 };
    private readonly Label _labelText = new();
    private readonly AutoSuggestBox _box = new();
    private readonly FontIcon _leadingIcon = new()
    {
        Glyph = AddressInputRegistration.MapPinGlyph,
        FontSize = IconSize,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly StackPanel _statusRow = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = 8,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly ProgressRing _spinner = new()
    {
        Width = IconSize,
        Height = IconSize,
        IsActive = false,
        Visibility = Visibility.Collapsed,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly Caption _statusCaption = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly TsButton _retryButton = new();
    private readonly TextBlock _liveRegion;

    private IReadOnlyList<GeocodeSuggestion> _renderedSuggestions = Array.Empty<GeocodeSuggestion>();
    private string? _announced;
    private bool _started;
    private bool _renderQueued;
    private bool _disposed;
    private bool _syncingFromBox;
    private bool _suppressSearch;

    /// <summary>The text the field currently holds (web <c>value</c>); the parent owns it via two-way binding.</summary>
    public static readonly DependencyProperty ValueProperty = DependencyProperty.Register(
        nameof(Value), typeof(string), typeof(AddressInput),
        new PropertyMetadata(string.Empty, OnValuePropertyChanged));

    /// <summary>The optional visible field label (web <c>label</c>); hidden when null (web <c>hideLabel</c>).</summary>
    public static readonly DependencyProperty LabelProperty = DependencyProperty.Register(
        nameof(Label), typeof(string), typeof(AddressInput),
        new PropertyMetadata(null, OnLabelPropertyChanged));

    /// <summary>Optional empty-field prompt text (the web component's prompt prop).</summary>
    public static readonly DependencyProperty PromptTextProperty = DependencyProperty.Register(
        nameof(PromptText), typeof(string), typeof(AddressInput),
        new PropertyMetadata(null, OnPromptTextPropertyChanged));

    /// <summary>Creates the surface over its data source, localizer and (optional) diagnostics.</summary>
    public AddressInput(
        IAddressGeocodeSource source, ILocalizer localizer, AddressInputDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new AddressInputDiagnostics();
        _viewModel = new AddressInputViewModel(source, localizer);
        _dispatcher = DispatcherQueue.GetForCurrentThread();
        _liveRegion = DisplayPrimitives.Caption();

        if (_dispatcher is { } dispatcher)
        {
            _debounce = dispatcher.CreateTimer();
            _debounce.Interval = TimeSpan.FromMilliseconds(AddressInputRegistration.DebounceMilliseconds);
            _debounce.IsRepeating = false;
            _debounce.Tick += OnDebounceTick;
        }

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;

        BuildChrome();
        ApplyLabel();
        ApplyPromptText();

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        _box.TextChanged += OnBoxTextChanged;
        _box.QuerySubmitted += OnQuerySubmitted;
        _retryButton.Click += OnRetryClick;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render();
    }

    /// <summary>Raised whenever the raw text changes (web <c>onChange</c>).</summary>
    public event EventHandler<string>? ValueChanged;

    /// <summary>Raised when a suggestion is chosen, carrying its coordinates (web <c>onSelect</c>).</summary>
    public event EventHandler<AddressSelection>? LocationSelected;

    /// <summary>The canonical surface id (<c>address-input</c>).</summary>
    public static string SurfaceId => AddressInputRegistration.Id;

    /// <summary>The diagnostics surface slug this view registers under (<c>AddressInput</c>).</summary>
    public static string Slug => AddressInputRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting/diagnostics).</summary>
    public AddressInputViewModel ViewModel => _viewModel;

    /// <summary>The raw field text (web <c>value</c>).</summary>
    public string Value
    {
        get => (string)GetValue(ValueProperty);
        set => SetValue(ValueProperty, value);
    }

    /// <summary>The optional visible field label (web <c>label</c>).</summary>
    public string? Label
    {
        get => (string?)GetValue(LabelProperty);
        set => SetValue(LabelProperty, value);
    }

    /// <summary>Optional empty-field prompt text (the web component's prompt prop).</summary>
    public string? PromptText
    {
        get => (string?)GetValue(PromptTextProperty);
        set => SetValue(PromptTextProperty, value);
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="AddressGeocodeSource"/> from the shared
    /// data layer (the host's P2-core dependencies).
    /// </summary>
    public static AddressInput Create(
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        AddressInputDiagnostics? diagnostics = null)
    {
        var source = new AddressGeocodeSource(api, engine, options);
        return new AddressInput(source, localizer, diagnostics);
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _box.TextChanged -= OnBoxTextChanged;
        _box.QuerySubmitted -= OnQuerySubmitted;
        _retryButton.Click -= OnRetryClick;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;

        if (_debounce is { } debounce)
        {
            debounce.Stop();
            debounce.Tick -= OnDebounceTick;
        }

        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    private void BuildChrome()
    {
        _box.TextMemberPath = nameof(GeocodeSuggestion.DisplayName);
        _box.ItemTemplate = BuildSuggestionTemplate();
        _box.HorizontalAlignment = HorizontalAlignment.Stretch;
        AutomationProperties.SetAccessibilityView(_leadingIcon, AccessibilityView.Raw);

        var field = new Grid { ColumnSpacing = 8 };
        field.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        field.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        Grid.SetColumn(_leadingIcon, 0);
        Grid.SetColumn(_box, 1);
        field.Children.Add(_leadingIcon);
        field.Children.Add(_box);

        _retryButton.Text = _viewModel.RetryLabel;
        _retryButton.Variant = ButtonVariant.Secondary;
        _retryButton.Size = ControlSize.Small;
        _retryButton.IconGlyph = RetryGlyph;
        _retryButton.Visibility = Visibility.Collapsed;
        AutomationProperties.SetName(_retryButton, _viewModel.RetryLabel);

        _statusCaption.Visibility = Visibility.Collapsed;
        _statusRow.Children.Add(_spinner);
        _statusRow.Children.Add(_statusCaption);
        _statusRow.Children.Add(_retryButton);

        _liveRegion.Visibility = Visibility.Collapsed;
        LiveRegion.Configure(_liveRegion);

        _root.Children.Add(_labelText);
        _root.Children.Add(field);
        _root.Children.Add(_statusRow);
        _root.Children.Add(_liveRegion);

        Content = _root;
    }

    private static DataTemplate BuildSuggestionTemplate()
    {
        // web renderOption: <span className="flex items-start gap-2"><MapPin/><span className="line-clamp-2">…
        const string xaml = """
            <DataTemplate xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation">
                <StackPanel Orientation="Horizontal" Spacing="8" Padding="2">
                    <FontIcon Glyph="&#xE707;" FontSize="16" VerticalAlignment="Top"
                              AutomationProperties.AccessibilityView="Raw" />
                    <TextBlock Text="{Binding DisplayName}" TextWrapping="Wrap" MaxLines="2"
                               TextTrimming="CharacterEllipsis" />
                </StackPanel>
            </DataTemplate>
            """;
        return (DataTemplate)Microsoft.UI.Xaml.Markup.XamlReader.Load(xaml);
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

    private void OnRetryClick(object sender, RoutedEventArgs e) => _ = _viewModel.RetryAsync();

    private void OnBoxTextChanged(AutoSuggestBox sender, AutoSuggestBoxTextChangedEventArgs args)
    {
        if (args.Reason != AutoSuggestionBoxTextChangeReason.UserInput)
        {
            return;
        }

        _syncingFromBox = true;
        Value = sender.Text;
        _syncingFromBox = false;

        ValueChanged?.Invoke(this, sender.Text);
        RestartDebounce();
    }

    private void OnQuerySubmitted(AutoSuggestBox sender, AutoSuggestBoxQuerySubmittedEventArgs args)
    {
        // Choosing a suggestion (tap or arrow+Enter) commits its coordinates; a free-text submit keeps the
        // typed value (web allowFreeText) and fires nothing further.
        if (args.ChosenSuggestion is GeocodeSuggestion suggestion)
        {
            CommitSelection(suggestion);
        }
    }

    private void CommitSelection(GeocodeSuggestion suggestion)
    {
        _debounce?.Stop();
        _suppressSearch = true;
        Value = suggestion.DisplayName;
        _suppressSearch = false;

        if (_box.Text != suggestion.DisplayName)
        {
            _box.Text = suggestion.DisplayName;
        }

        _box.IsSuggestionListOpen = false;
        ValueChanged?.Invoke(this, suggestion.DisplayName);
        LocationSelected?.Invoke(this, new AddressSelection(suggestion.Lat, suggestion.Lng, suggestion.DisplayName));
    }

    private void OnDebounceTick(DispatcherQueueTimer sender, object args)
    {
        sender.Stop();
        _ = _viewModel.SetQueryAsync(Value);
    }

    private void RestartDebounce()
    {
        if (_debounce is { } debounce)
        {
            debounce.Stop();
            debounce.Start();
        }
        else
        {
            _ = _viewModel.SetQueryAsync(Value);
        }
    }

    private static void OnValuePropertyChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        var view = (AddressInput)d;
        if (view._syncingFromBox)
        {
            return; // The change originated from the box itself; it is already in sync.
        }

        var value = (string)(e.NewValue ?? string.Empty);
        if (view._box.Text != value)
        {
            view._box.Text = value; // Programmatic — raises TextChanged with a non-UserInput reason (ignored).
        }

        if (!view._suppressSearch)
        {
            view.RestartDebounce(); // An external value set searches too (web debounced effect on `value`).
        }
    }

    private static void OnLabelPropertyChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((AddressInput)d).ApplyLabel();

    private static void OnPromptTextPropertyChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((AddressInput)d).ApplyPromptText();

    private void ApplyLabel()
    {
        // web: label={label ?? t('addressInput.label','Address')}, hideLabel={!label}. The accessible name is
        // always set; the visible label only shows when an explicit label was supplied.
        string accessibleLabel = string.IsNullOrEmpty(Label) ? _viewModel.LabelText : Label!;
        AutomationProperties.SetName(_box, accessibleLabel);

        if (string.IsNullOrEmpty(Label))
        {
            _labelText.Visibility = Visibility.Collapsed;
        }
        else
        {
            _labelText.Value = Label!;
            _labelText.Visibility = Visibility.Visible;
        }
    }

    private void ApplyPromptText() =>
        _box.PlaceholderText = PromptText ?? string.Empty; // parity:allow PlaceholderText is the WinUI hint API

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
        if (!ReferenceEquals(_renderedSuggestions, _viewModel.Suggestions))
        {
            _renderedSuggestions = _viewModel.Suggestions;
            _box.ItemsSource = _renderedSuggestions;
            if (_renderedSuggestions.Count > 0 && _box.FocusState != FocusState.Unfocused)
            {
                _box.IsSuggestionListOpen = true;
            }
        }

        BuildStatusRow();
        UpdateLiveRegion();
    }

    private void BuildStatusRow()
    {
        bool busy = _viewModel.State == AddressInputState.Loading || _viewModel.IsFetching;
        _spinner.IsActive = busy;
        _spinner.Visibility = busy ? Visibility.Visible : Visibility.Collapsed;

        _retryButton.Visibility = _viewModel.State == AddressInputState.Error
            ? Visibility.Visible
            : Visibility.Collapsed;

        string? caption = _viewModel.State switch
        {
            AddressInputState.Loading => _viewModel.SearchingLabel,
            AddressInputState.Empty => _viewModel.NoMatchesLabel,
            AddressInputState.Stale => _viewModel.StaleLabel,
            AddressInputState.Offline => _viewModel.OfflineLabel,
            AddressInputState.Error => _viewModel.ErrorMessage ?? AddressInputRegistration.ErrorText(_localizer),
            _ => busy ? _viewModel.SearchingLabel : null,
        };

        if (string.IsNullOrEmpty(caption))
        {
            _statusCaption.Visibility = Visibility.Collapsed;
        }
        else
        {
            _statusCaption.Value = caption!;
            _statusCaption.Visibility = Visibility.Visible;
            ApplyStatusAccent(_viewModel.State);
        }
    }

    private void ApplyStatusAccent(AddressInputState state)
    {
        var key = state switch
        {
            AddressInputState.Stale => StatusResources.AccentBrushKey(StatusKind.Warning),
            AddressInputState.Offline => StatusResources.AccentBrushKey(StatusKind.Danger),
            AddressInputState.Error => StatusResources.AccentBrushKey(StatusKind.Danger),
            _ => "TsColorTextMutedBrush",
        };
        if (Application.Current.Resources.TryGetValue(key, out var brush) &&
            brush is Microsoft.UI.Xaml.Media.Brush accent)
        {
            _statusCaption.Foreground = accent;
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
