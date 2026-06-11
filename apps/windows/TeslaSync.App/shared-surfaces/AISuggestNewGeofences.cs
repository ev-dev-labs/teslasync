using System.Net.Http;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Documents;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Auth;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 suggest-new-geofences card — a parity port of the web <c>AISuggestNewGeofences</c>
/// (web/src/components/ai/AISuggestNewGeofences.tsx) composed with its shared <c>AIFeatureCard</c> scaffold and
/// the <c>withAiFeature</c> gate. Inside a tokenized glass card it renders a header (title + "Helix" badge +
/// description), the universal "Ask Helix" action on its own right-aligned row (web <c>buttonPlacement="below"</c>;
/// disabled until a visited location is in scope, and showing "Helix is thinking…" with a ring while the SSE
/// stream is open), the optional "Current label: …" context line, the captured-proposal panel (proposed name,
/// rounded radius in metres, validator verdict and a propose-only "Apply to form" action), and the
/// streamed-output panel that renders a shimmering thinking skeleton before the first token (honouring
/// reduced-motion), the accumulating assistant text as it arrives, and a connectivity-aware error / offline
/// surface on failure (with the always-present action button as the retry affordance). The whole surface
/// renders nothing when the feature flag is off (the native analogue of <c>withAiFeature</c> returning
/// <see langword="null"/>). All data flows through the shared <see cref="AISuggestNewGeofencesViewModel"/>; the
/// view never performs HTTP and never writes the proposal — "Apply to form" hands the typed draft to the parent
/// via a callback (propose-only). Every string resolves through the i18n facade and every interactive element
/// carries a Narrator name; the surface emits the <c>view.opened</c> diagnostic once when it is shown.
/// </summary>
public sealed partial class AISuggestNewGeofences : ContentControl, IDisposable
{
    private const double CardPadding = 20;        // web p-5
    private const double SectionSpacing = 16;     // web space-y-4
    private const double TitleRowSpacing = 8;     // web gap-2
    private const double TextColumnSpacing = 6;   // web header column gap
    private const double DetailColumnSpacing = 4; // web space-y-1
    private const double DraftColumnSpacing = 12; // web gap-3
    private const double DraftPadding = 12;       // web p-3
    private const double BodyFontSize = 14;       // web text-sm
    private const double CaptionFontSize = 12;    // web text-xs
    private const double DescriptionMaxWidth = 680;
    private const string HelixGlyph = "\uE99A";   // Segoe Fluent "Robot" — the Helix mark.
    private const string ErrorGlyph = "\uEA39";   // Segoe Fluent "ErrorBadge".

    private readonly AISuggestNewGeofencesViewModel _viewModel;
    private readonly AISuggestNewGeofencesDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;
    private readonly StackPanel _root = new() { Spacing = SectionSpacing };

    private bool _opened;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its streaming transport, feature gate, localizer, scoped location, current label, apply callback and diagnostics.</summary>
    /// <param name="transport">The cache-free SSE draft transport (P1/S8 state-holder seam); the view never opens it directly.</param>
    /// <param name="gate">The AI feature gate (web <c>useAiEnabled</c>); off collapses the whole surface.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="locationId">The in-scope visited-location id; when unresolved the action stays disabled.</param>
    /// <param name="currentName">The current address label shown for the location; optional.</param>
    /// <param name="onApplyDraft">The propose-only handoff invoked when the user applies an accepted proposal.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public AISuggestNewGeofences(
        IAiGeofenceDraftStreamTransport transport,
        IAiFeatureGate gate,
        ILocalizer localizer,
        long? locationId = null,
        string? currentName = null,
        Action<GeofenceDraftApplication>? onApplyDraft = null,
        AISuggestNewGeofencesDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(transport);
        ArgumentNullException.ThrowIfNull(gate);
        ArgumentNullException.ThrowIfNull(localizer);

        _diagnostics = diagnostics ?? new AISuggestNewGeofencesDiagnostics();
        _viewModel = new AISuggestNewGeofencesViewModel(transport, gate, localizer, locationId, currentName, onApplyDraft);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Top;
        Content = _root;

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>The canonical surface slug (<c>AISuggestNewGeofences</c>).</summary>
    public static string Slug => AISuggestNewGeofencesRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public AISuggestNewGeofencesViewModel ViewModel => _viewModel;

    /// <summary>The in-scope visited-location id; reassigning re-evaluates the action and clears any stale proposal.</summary>
    public long? LocationId
    {
        get => _viewModel.LocationId;
        set => _viewModel.LocationId = value;
    }

    /// <summary>The current address label shown next to the proposal; reassigning re-renders the context line.</summary>
    public string CurrentName
    {
        get => _viewModel.CurrentName;
        set => _viewModel.CurrentName = value;
    }

    /// <summary>
    /// Convenience factory that wires the production <see cref="HttpAiGeofenceDraftStreamTransport"/> from the
    /// shared networking dependencies (the host's P2-core seam) — the native analogue of the web component
    /// constructing its <c>useAiStream</c> over <c>fetch</c>.
    /// </summary>
    public static AISuggestNewGeofences Create(
        HttpClient http,
        ApiClientOptions options,
        ITokenProvider tokenProvider,
        IAiFeatureGate gate,
        ILocalizer localizer,
        long? locationId = null,
        string? currentName = null,
        Action<GeofenceDraftApplication>? onApplyDraft = null,
        AISuggestNewGeofencesDiagnostics? diagnostics = null)
    {
        var transport = new HttpAiGeofenceDraftStreamTransport(http, options, tokenProvider);
        return new AISuggestNewGeofences(transport, gate, localizer, locationId, currentName, onApplyDraft, diagnostics);
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
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new SuggestGeofencesAutomationPeer(this);

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        // Mirror the web component mounting: the surface only exists when the gate is open, so record the
        // view.opened diagnostic once and only when it is actually shown.
        if (_opened || !_viewModel.IsGateOpen)
        {
            return;
        }

        _opened = true;
        _diagnostics.RecordViewOpened();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
        ScheduleRender();

    private void ScheduleRender()
    {
        if (_renderQueued)
        {
            return;
        }

        _renderQueued = true;

        // A delta/terminal frame can be raised from the stream's background continuation; rebuild on the UI thread.
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
        _root.Children.Clear();

        // web withAiFeature: when the feature is off the wrapped component returns null. The native analogue is
        // a collapsed, automation-raw container that contributes no visible or accessible node and carries no
        // automation id (the off-mode invariant test finds no root element).
        if (!_viewModel.IsGateOpen)
        {
            Visibility = Visibility.Collapsed;
            AutomationProperties.SetAutomationId(this, string.Empty);
            AutomationProperties.SetAccessibilityView(this, AccessibilityView.Raw);
            return;
        }

        Visibility = Visibility.Visible;
        AutomationProperties.SetAutomationId(this, AISuggestNewGeofencesRegistration.RootAutomationId);
        AutomationProperties.SetAccessibilityView(this, AccessibilityView.Content);
        AutomationProperties.SetName(this, _viewModel.Title);
        _root.Children.Add(BuildPanel());
    }

    private TsGlassPanel BuildPanel()
    {
        var column = new StackPanel { Spacing = SectionSpacing };
        column.Children.Add(BuildHeader());
        column.Children.Add(BuildActionRow());

        if (_viewModel.HasCurrentName)
        {
            column.Children.Add(BuildCurrentName());
        }

        if (_viewModel.HasDraft)
        {
            column.Children.Add(BuildDraft());
        }

        var output = BuildOutput();
        if (output is not null)
        {
            column.Children.Add(output);
        }

        return new TsGlassPanel
        {
            Padding = new Thickness(CardPadding),
            Content = column,
        };
    }

    private StackPanel BuildHeader()
    {
        var titleRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = TitleRowSpacing };
        titleRow.Children.Add(new PanelTitle { Value = _viewModel.Title, VerticalAlignment = VerticalAlignment.Center });
        titleRow.Children.Add(BuildBadge());

        var lead = new StackPanel { Spacing = TextColumnSpacing };
        lead.Children.Add(titleRow);
        lead.Children.Add(new Subhead
        {
            Value = _viewModel.Description,
            MaxWidth = DescriptionMaxWidth,
            HorizontalAlignment = HorizontalAlignment.Left,
        });
        return lead;
    }

    private TsBadge BuildBadge()
    {
        var content = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 6,
            VerticalAlignment = VerticalAlignment.Center,
        };
        var mark = new FontIcon
        {
            Glyph = HelixGlyph,
            FontSize = CaptionFontSize,
            Foreground = DisplayTokens.Accent,
        };
        AutomationProperties.SetAccessibilityView(mark, AccessibilityView.Raw);
        content.Children.Add(mark);
        content.Children.Add(new Caption { Value = _viewModel.BadgeLabel });

        var badge = new TsBadge
        {
            Status = StatusKind.Info,
            Content = content,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(badge, _viewModel.BadgeLabel);
        return badge;
    }

    private StackPanel BuildActionRow()
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            HorizontalAlignment = HorizontalAlignment.Right,
        };
        row.Children.Add(BuildAction());
        return row;
    }

    private TsButton BuildAction()
    {
        var button = new TsButton
        {
            Variant = ButtonVariant.Outline,
            Size = ControlSize.Small,
            Text = _viewModel.ActionLabel,
            IconGlyph = HelixGlyph,
            IsLoading = _viewModel.IsStreaming,
            VerticalAlignment = VerticalAlignment.Top,
            HorizontalAlignment = HorizontalAlignment.Right,
        };

        // web AIFeatureCard: the visible label is the universal CTA, but the accessible name carries the
        // per-feature verb ("Ask Helix · Suggest geofence") and the verb is the hover tooltip. While streaming,
        // IsLoading already forces the button disabled; otherwise apply the computed enabled state (canStart).
        if (!_viewModel.IsStreaming)
        {
            button.IsEnabled = _viewModel.IsActionEnabled;
        }

        AutomationProperties.SetName(button, _viewModel.ActionAutomationName);
        ToolTipService.SetToolTip(button, _viewModel.SuggestButtonLabel);
        button.Click += OnSuggestClick;
        return button;
    }

    private TextBlock BuildCurrentName()
    {
        // web: <p class="text-xs text-muted">Current label: <span class="text-secondary">{currentName}</span></p>
        var text = new TextBlock
        {
            FontSize = CaptionFontSize,
            TextWrapping = TextWrapping.Wrap,
            HorizontalAlignment = HorizontalAlignment.Left,
        };
        text.Inlines.Add(new Run
        {
            Text = string.Concat(_viewModel.CurrentLabel, ": "),
            Foreground = DisplayTokens.TextMuted,
        });
        text.Inlines.Add(new Run
        {
            Text = _viewModel.CurrentName,
            Foreground = DisplayTokens.TextSecondary,
        });
        AutomationProperties.SetName(text, string.Concat(_viewModel.CurrentLabel, ": ", _viewModel.CurrentName));
        return text;
    }

    private Border BuildDraft()
    {
        var grid = new Grid { ColumnSpacing = DraftColumnSpacing };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var details = new StackPanel { Spacing = DetailColumnSpacing };
        var accent = DisplayTokens.Brush(StatusResources.AccentBrushKey(StatusKind.Info));

        details.Children.Add(new TextBlock
        {
            Text = _viewModel.ProposalLabel.ToUpperInvariant(),
            FontSize = CaptionFontSize,
            CharacterSpacing = 60,
            Foreground = accent,
        });

        details.Children.Add(new TextBlock
        {
            Text = _viewModel.DraftName,
            FontSize = BodyFontSize,
            FontWeight = FontWeights.SemiBold,
            TextWrapping = TextWrapping.Wrap,
            Foreground = DisplayTokens.TextPrimary,
        });

        details.Children.Add(new TextBlock
        {
            Text = _viewModel.DraftRadiusText,
            FontSize = CaptionFontSize,
            TextWrapping = TextWrapping.Wrap,
            Foreground = DisplayTokens.TextSecondary,
        });

        if (_viewModel.HasDraftValidationError)
        {
            details.Children.Add(new TextBlock
            {
                Text = _viewModel.DraftValidationError,
                FontSize = CaptionFontSize,
                TextWrapping = TextWrapping.Wrap,
                Foreground = DisplayTokens.TextSecondary,
            });
        }

        if (_viewModel.IsDraftRejected)
        {
            details.Children.Add(new TextBlock
            {
                Text = _viewModel.RejectedLabel,
                FontSize = CaptionFontSize,
                TextWrapping = TextWrapping.Wrap,
                Foreground = DisplayTokens.Brush("TsColorDangerBrush"),
            });
        }

        Grid.SetColumn(details, 0);
        grid.Children.Add(details);

        var apply = new TsButton
        {
            Variant = ButtonVariant.Outline,
            Size = ControlSize.Small,
            Text = _viewModel.ApplyButtonLabel,
            VerticalAlignment = VerticalAlignment.Top,
            IsEnabled = _viewModel.IsApplyEnabled,
        };
        AutomationProperties.SetName(apply, _viewModel.ApplyButtonLabel);
        apply.Click += OnApplyClick;
        Grid.SetColumn(apply, 1);
        grid.Children.Add(apply);

        var host = new Border
        {
            Padding = new Thickness(DraftPadding),
            CornerRadius = DisplayTokens.Radius("TsRadiusMd", 8),
            BorderThickness = new Thickness(1),
            Background = DisplayTokens.Brush("TsColorSurfaceGlassBrush"),
            BorderBrush = accent,
            Child = grid,
        };
        LiveRegion.Configure(host);
        LiveRegion.Announce(host);
        return host;
    }

    private FrameworkElement? BuildOutput()
    {
        // web AiOutputPanel render order: a shimmering thinking skeleton while streaming with no text yet, the
        // accumulating narrative once any token has arrived, and the inline error surface on failure.
        if (_viewModel.IsThinking)
        {
            return BuildThinking();
        }

        if (_viewModel.AssistantText.Length > 0)
        {
            return BuildText();
        }

        if (_viewModel.IsError)
        {
            return BuildError();
        }

        // Idle / done-without-narration: the card still shows the header, action and any captured proposal —
        // never a blank box.
        return null;
    }

    private StackPanel BuildThinking()
    {
        bool reduceMotion = MotionPreference.ReduceMotion;
        var column = new StackPanel { Spacing = 8 };
        double[] widths = [320, 280, 220];
        foreach (double width in widths)
        {
            column.Children.Add(new TsSkeleton
            {
                BlockWidth = width,
                BlockHeight = 12,
                Radius = 4,
                ReduceMotion = reduceMotion,
                HorizontalAlignment = HorizontalAlignment.Left,
            });
        }

        AutomationProperties.SetName(column, _viewModel.ThinkingLabel);
        LiveRegion.Configure(column);
        LiveRegion.Announce(column);
        return column;
    }

    private Text BuildText()
    {
        var text = new Text
        {
            Value = _viewModel.AssistantText,
            Foreground = DisplayTokens.TextSecondary,
            HorizontalAlignment = HorizontalAlignment.Left,
        };
        LiveRegion.Configure(text);
        LiveRegion.Announce(text);
        return text;
    }

    private StackPanel BuildError()
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = TitleRowSpacing,
        };

        var danger = DisplayTokens.Brush("TsColorDangerBrush");
        row.Children.Add(new FontIcon
        {
            Glyph = ErrorGlyph,
            FontSize = 16,
            Foreground = danger,
            VerticalAlignment = VerticalAlignment.Top,
        });
        row.Children.Add(new TextBlock
        {
            Text = _viewModel.DisplayErrorText,
            TextWrapping = TextWrapping.Wrap,
            FontSize = BodyFontSize,
            Foreground = danger,
        });

        AutomationProperties.SetName(row, _viewModel.DisplayErrorText);
        LiveRegion.Configure(row, assertive: true);
        LiveRegion.Announce(row);
        return row;
    }

    private void OnSuggestClick(object sender, RoutedEventArgs e) => _viewModel.Start();

    private void OnApplyClick(object sender, RoutedEventArgs e) => _viewModel.Apply();

    private sealed class SuggestGeofencesAutomationPeer : FrameworkElementAutomationPeer
    {
        public SuggestGeofencesAutomationPeer(AISuggestNewGeofences owner)
            : base(owner)
        {
        }

        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            var name = base.GetNameCore();
            return string.IsNullOrEmpty(name)
                ? ((AISuggestNewGeofences)Owner).ViewModel.Title
                : name;
        }
    }
}
