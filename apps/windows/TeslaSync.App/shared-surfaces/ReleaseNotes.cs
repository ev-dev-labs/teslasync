using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Shapes;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.ModalsDialogs;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 <c>ReleaseNotes</c> shared surface — a parity port of the web <c>ReleaseNotes</c> export
/// (web/src/components/feedback/ReleaseNotes.tsx). It is the compact, embeddable "what's new" card list: the
/// newest <c>limit</c> releases (default 3) rendered as single-expansion disclosure cards. Each card's header
/// carries a badge-tinted Segoe Fluent "Gift" glyph (the native stand-in for the web Lucide <c>Gift</c>), the
/// <c>v{version}</c> label, a <see cref="TsBadge"/> (latest / stable / beta), and the release date; its expanded
/// body repeats the localized "What's New" heading over the release's flat, author-ordered change list, each line
/// prefixed by a <see cref="ChangelogChangeType"/>-coloured dot. The disclosure is single-expansion (web
/// <c>expanded</c>): opening one card collapses the others, and the newest release is open by default. It binds
/// the <see cref="ReleaseNotesViewModel"/> over the shared P1/S8 <see cref="IChangelogSource"/> so the view does
/// no I/O, renders every state from the shared seam (loading skeleton, loaded list, empty surface, retryable
/// error, plus stale / offline freshness chips), resolves every string through the i18n facade, names every
/// interactive element for Narrator (the <see cref="TsAccordion"/> exposes the ExpandCollapse pattern), and emits
/// the <c>view.opened</c> diagnostic once when shown.
/// </summary>
public sealed partial class ReleaseNotes : ContentControl, IDisposable
{
    private const double GiftGlyphSize = 16;     // web Gift h-4 w-4
    private const double VersionFontSize = 14;   // web text-sm font-semibold
    private const double HeadingFontSize = 12;   // web text-xs uppercase tracking-wider
    private const double ChangeFontSize = 14;    // web text-sm
    private const double DotSize = 6;            // web h-1.5 w-1.5
    private const double DotTopMargin = 6;       // web mt-1.5
    private const double ListSpacing = 12;       // web space-y-3
    private const double HeaderSpacing = 10;     // web header gap-3
    private const double BodySpacing = 6;        // web space-y-1.5
    private const double HeadingCharacterSpacing = 80; // web tracking-wider
    private const double SkeletonBlockHeight = 64;
    private const int SkeletonRowCount = 3;

    private readonly ReleaseNotesViewModel _viewModel;
    private readonly ReleaseNotesDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;
    private readonly bool _reduceMotion;

    private readonly StackPanel _root = new()
    {
        Spacing = ListSpacing,
        HorizontalAlignment = HorizontalAlignment.Stretch,
    };

    private readonly List<(string Version, TsAccordion Accordion)> _accordions = new();

    private bool _coordinating;
    private bool _opened;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>
    /// Creates the surface with no composition root (the designer / parameterless host entry point): it binds the
    /// real production seam — a <see cref="ChangelogSource"/> over the embedded <see cref="ChangelogCatalog"/>
    /// (the native analogue of the web generated <c>CHANGELOG</c>) — so the card list reflects the genuine
    /// shipped release history. Supply an explicit <see cref="ILocalizer"/> and source via the other constructors
    /// to drive i18n and the catalog from the composition root.
    /// </summary>
    public ReleaseNotes()
        : this(PassthroughLocalizer.Instance, CreateDefaultSource(), ReleaseNotesRegistration.DefaultLimit)
    {
    }

    /// <summary>Creates the surface over the i18n facade, the shared changelog seam and the release cap.</summary>
    /// <param name="localizer">The i18n facade the heading / badge / state strings resolve through.</param>
    /// <param name="source">The shared cache-then-network changelog source (web generated <c>CHANGELOG</c>).</param>
    /// <param name="limit">The maximum number of releases to render (web <c>limit</c>, default 3).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public ReleaseNotes(
        ILocalizer localizer,
        IChangelogSource source,
        int limit = ReleaseNotesRegistration.DefaultLimit,
        ReleaseNotesDiagnostics? diagnostics = null)
        : this(new ReleaseNotesViewModel(source, localizer, limit), diagnostics)
    {
    }

    /// <summary>Creates the surface over an explicit state holder (tests / headless hosts) and diagnostics.</summary>
    /// <param name="viewModel">The backing state holder.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public ReleaseNotes(ReleaseNotesViewModel viewModel, ReleaseNotesDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(viewModel);

        _viewModel = viewModel;
        _diagnostics = diagnostics ?? new ReleaseNotesDiagnostics();
        _dispatcher = DispatcherQueue.GetForCurrentThread();
        _reduceMotion = MotionPreference.ReduceMotion;

        HorizontalAlignment = HorizontalAlignment.Stretch;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalAlignment = VerticalAlignment.Top;

        AutomationProperties.SetAutomationId(this, ReleaseNotesRegistration.ListAutomationId);
        AutomationProperties.SetName(this, _viewModel.Heading);

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Content = _root;
        Render();
    }

    /// <summary>The canonical surface slug (<c>ReleaseNotes</c>).</summary>
    public static string Slug => ReleaseNotesRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public ReleaseNotesViewModel ViewModel => _viewModel;

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        ClearAccordions();
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    private static ChangelogSource CreateDefaultSource() =>
        new(new InMemoryChangelogAcknowledgementStore());

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_opened)
        {
            return;
        }

        _opened = true;

        // Mirror the web component mount: emit the view.opened diagnostic exactly once, then load the catalog.
        _diagnostics.RecordViewOpened();
        _ = _viewModel.LoadAsync();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e)
    {
        // The expanded-version change is reflected directly by the Expander the user toggled; rebuilding would
        // fight the in-flight expand/collapse animation, so only state / content changes trigger a re-render.
        if (e.PropertyName == nameof(ReleaseNotesViewModel.ExpandedVersion))
        {
            return;
        }

        ScheduleRender();
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
        ClearAccordions();
        _root.Children.Clear();
        AutomationProperties.SetName(this, _viewModel.Heading);

        switch (_viewModel.State)
        {
            case ReleaseNotesState.Loading:
                _root.Children.Add(BuildLoading());
                break;

            case ReleaseNotesState.Empty:
                _root.Children.Add(BuildEmpty());
                break;

            case ReleaseNotesState.Error:
                _root.Children.Add(BuildError());
                break;

            default:
                BuildList();
                break;
        }
    }

    private StackPanel BuildLoading()
    {
        var column = new StackPanel { Spacing = ListSpacing, HorizontalAlignment = HorizontalAlignment.Stretch };
        for (int i = 0; i < SkeletonRowCount; i++)
        {
            column.Children.Add(new TsSkeleton { BlockHeight = SkeletonBlockHeight, ReduceMotion = _reduceMotion });
        }

        AutomationProperties.SetName(column, _viewModel.LoadingText);
        LiveRegion.Configure(column);
        LiveRegion.Announce(column);
        return column;
    }

    private TsEmptyState BuildEmpty() => new()
    {
        IconGlyph = ReleaseNotesRegistration.GiftGlyph,
        Message = _viewModel.EmptyMessage,
    };

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.ErrorMessage ?? _viewModel.EmptyMessage,
            ActionText = _viewModel.RetryText,
            AttemptCount = _viewModel.Attempts,
        };
        error.ActionInvoked += OnErrorRetry;
        return error;
    }

    private void OnErrorRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    private void BuildList()
    {
        var display = _viewModel.Display;

        var chip = BuildFreshnessChip();
        if (chip is not null)
        {
            _root.Children.Add(chip);
        }

        foreach (var entry in display?.Entries ?? [])
        {
            _root.Children.Add(BuildEntry(entry, display!.Heading));
        }
    }

    // Native addition over the web (which reads static data): surface the cache freshness through a chip so the
    // stale / offline states never render a silently degraded list.
    private TsBadge? BuildFreshnessChip()
    {
        return _viewModel.State switch
        {
            ReleaseNotesState.Offline => MakeChip(_viewModel.OfflineText, StatusKind.Neutral),
            ReleaseNotesState.Stale => MakeChip(_viewModel.StaleText, StatusKind.Warning),
            _ => null,
        };
    }

    private static TsBadge MakeChip(string text, StatusKind status)
    {
        var chip = new TsBadge
        {
            Status = status,
            Content = text,
            Dot = true,
            HorizontalAlignment = HorizontalAlignment.Left,
        };
        AutomationProperties.SetName(chip, text);
        return chip;
    }

    private TsGlassPanel BuildEntry(ReleaseNotesEntryDisplay entry, string heading)
    {
        var accentBrush = DisplayTokens.Brush(StatusResources.AccentBrushKey(entry.BadgeStatus));

        var header = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = HeaderSpacing,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var gift = new FontIcon
        {
            Glyph = ReleaseNotesRegistration.GiftGlyph,
            FontSize = GiftGlyphSize,
            Foreground = accentBrush,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(gift, AccessibilityView.Raw);
        header.Children.Add(gift);

        header.Children.Add(new TextBlock
        {
            Text = entry.VersionLabel,
            FontSize = VersionFontSize,
            FontWeight = FontWeights.SemiBold,
            Foreground = DisplayTokens.TextPrimary,
            VerticalAlignment = VerticalAlignment.Center,
        });

        var badge = new TsBadge
        {
            Status = entry.BadgeStatus,
            Content = entry.BadgeLabel,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(badge, entry.BadgeLabel);
        header.Children.Add(badge);

        header.Children.Add(new Caption { Value = entry.Date, VerticalAlignment = VerticalAlignment.Center });

        var body = new StackPanel { Spacing = BodySpacing, HorizontalAlignment = HorizontalAlignment.Stretch };
        body.Children.Add(new TextBlock
        {
            Text = heading,
            FontSize = HeadingFontSize,
            FontWeight = FontWeights.Medium,
            Foreground = DisplayTokens.TextMuted,
            CharacterSpacing = (int)HeadingCharacterSpacing,
        });

        var changeList = new StackPanel { Spacing = BodySpacing, HorizontalAlignment = HorizontalAlignment.Stretch };
        foreach (var change in entry.Changes)
        {
            changeList.Children.Add(BuildChange(change));
        }

        body.Children.Add(changeList);

        var accordion = new TsAccordion
        {
            Header = header,
            Content = body,
            IsExpanded = _viewModel.IsExpanded(entry.Version),
        };
        AutomationProperties.SetName(accordion, entry.AutomationName);
        accordion.Expanding += OnAccordionExpanding;
        accordion.Collapsed += OnAccordionCollapsed;
        _accordions.Add((entry.Version, accordion));

        return new TsGlassPanel { Content = accordion };
    }

    private static StackPanel BuildChange(ReleaseNotesChangeDisplay change)
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            HorizontalAlignment = HorizontalAlignment.Stretch,
        };

        row.Children.Add(new Ellipse
        {
            Width = DotSize,
            Height = DotSize,
            Fill = DisplayTokens.Brush(StatusResources.AccentBrushKey(change.DotStatus)),
            VerticalAlignment = VerticalAlignment.Top,
            Margin = new Thickness(0, DotTopMargin, 0, 0),
        });

        row.Children.Add(new TextBlock
        {
            Text = change.Text,
            FontSize = ChangeFontSize,
            Foreground = DisplayTokens.TextSecondary,
            TextWrapping = TextWrapping.Wrap,
            VerticalAlignment = VerticalAlignment.Top,
        });

        return row;
    }

    // Single-expansion accordion (web `expanded` single-value state): opening one card collapses the rest.
    private void OnAccordionExpanding(Expander sender, ExpanderExpandingEventArgs args)
    {
        if (_coordinating)
        {
            return;
        }

        var version = VersionOf(sender);
        if (version is null)
        {
            return;
        }

        _coordinating = true;
        foreach (var (other, accordion) in _accordions)
        {
            if (!string.Equals(other, version, StringComparison.Ordinal))
            {
                accordion.IsExpanded = false;
            }
        }

        _coordinating = false;
        _viewModel.SetExpanded(version);
    }

    private void OnAccordionCollapsed(Expander sender, ExpanderCollapsedEventArgs args)
    {
        if (_coordinating)
        {
            return;
        }

        var version = VersionOf(sender);
        if (version is not null && _viewModel.IsExpanded(version))
        {
            _viewModel.SetExpanded(null);
        }
    }

    private string? VersionOf(Expander sender)
    {
        foreach (var (version, accordion) in _accordions)
        {
            if (ReferenceEquals(accordion, sender))
            {
                return version;
            }
        }

        return null;
    }

    private void ClearAccordions()
    {
        foreach (var (_, accordion) in _accordions)
        {
            accordion.Expanding -= OnAccordionExpanding;
            accordion.Collapsed -= OnAccordionCollapsed;
        }

        _accordions.Clear();
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new ReleaseNotesAutomationPeer(this);

    private sealed class ReleaseNotesAutomationPeer : FrameworkElementAutomationPeer
    {
        public ReleaseNotesAutomationPeer(ReleaseNotes owner)
            : base(owner)
        {
        }

        private ReleaseNotes Surface => (ReleaseNotes)Owner;

        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            var name = base.GetNameCore();
            return string.IsNullOrEmpty(name) ? Surface._viewModel.Heading : name;
        }
    }
}
