using System.ComponentModel;
using System.Globalization;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="UuidGenerator"/> view — the native port of the
/// web <c>UuidGeneratorTool</c>'s hook composition
/// (web/src/features/admin/components/devtools/tools/UuidGenerator.tsx). It owns the newest-first
/// <see cref="Uuids"/> history (the web <c>useState&lt;string[]&gt;([])</c>) and, on each
/// <see cref="Generate"/> (the web <c>generate</c> callback), draws a value from the injected
/// <see cref="IUuidFactory"/> and folds it through <see cref="UuidHistory"/> so the view is a thin renderer.
/// Every one of the component's labels (web <c>t('Uuid Generator')</c>, <c>t('Uuid Generator Desc')</c>,
/// <c>t('Generate')</c> and the shared <c>CopyButton</c> labels) resolves through the i18n facade;
/// generation is synchronous and cannot fault, so there is no asynchronous machinery. Drive it from one
/// confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class UuidGeneratorViewModel : INotifyPropertyChanged
{
    private readonly ILocalizer _localizer;
    private readonly IUuidFactory _factory;

    private IReadOnlyList<string> _uuids = Array.Empty<string>();
    private string? _lastAnnouncement;

    /// <summary>Creates the holder over its localizer and (optional) generation seam.</summary>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="factory">The UUID generation seam; defaults to <see cref="GuidUuidFactory"/>.</param>
    public UuidGeneratorViewModel(ILocalizer localizer, IUuidFactory? factory = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        _localizer = localizer;
        _factory = factory ?? GuidUuidFactory.Instance;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The newest-first, capped history of generated UUIDs (the web <c>uuids</c> state).</summary>
    public IReadOnlyList<string> Uuids => _uuids;

    /// <summary>The current mutually-exclusive surface state (the result list vs the friendly empty surface).</summary>
    public UuidGeneratorState State =>
        _uuids.Count > 0 ? UuidGeneratorState.Ready : UuidGeneratorState.Empty;

    /// <summary>True when at least one UUID has been generated (web <c>uuids.length &gt; 0</c>).</summary>
    public bool HasResults => _uuids.Count > 0;

    /// <summary>The most recent generation surfaced to the accessibility live region, or <c>null</c> when none.</summary>
    public string? LastAnnouncement
    {
        get => _lastAnnouncement;
        private set
        {
            if (string.Equals(_lastAnnouncement, value, StringComparison.Ordinal))
            {
                return;
            }

            _lastAnnouncement = value;
            Raise(nameof(LastAnnouncement));
        }
    }

    /// <summary>Localized card title (web <c>t('Uuid Generator')</c>).</summary>
    public string Title => _localizer.GetString("Uuid Generator", "Uuid Generator");

    /// <summary>Localized card description (web <c>t('Uuid Generator Desc')</c>).</summary>
    public string Description => _localizer.GetString("Uuid Generator Desc", "Uuid Generator Desc");

    /// <summary>Localized generate-button label (web <c>t('Generate')</c>).</summary>
    public string GenerateLabel => _localizer.GetString("Generate", "Generate");

    /// <summary>Localized copy affordance idle label (web shared <c>CopyButton</c>).</summary>
    public string CopyLabel => _localizer.GetString("common.copyButton.copy", "Copy");

    /// <summary>Localized copy affordance confirmation label (web shared <c>CopyButton</c>).</summary>
    public string CopiedLabel => _localizer.GetString("common.copyButton.copied", "Copied");

    /// <summary>Localized empty-surface message shown before the first generate (web renders nothing).</summary>
    public string EmptyMessage =>
        _localizer.GetString("devtools.uuidGenerator.empty", "Generate a UUID to see results");

    /// <summary>Localized Narrator name for the generate button (richer than the bare visible label).</summary>
    public string GenerateAccessibleName =>
        _localizer.GetString("devtools.uuidGenerator.generateName", "Generate a new UUID");

    /// <summary>Localized Narrator name for a row's copy button, scoped to the row's value.</summary>
    /// <param name="uuid">The UUID the copy affordance places on the clipboard.</param>
    public string CopyName(string uuid)
    {
        ArgumentNullException.ThrowIfNull(uuid);
        return string.Format(
            CultureInfo.CurrentCulture,
            _localizer.GetString("devtools.uuidGenerator.copyName", "Copy UUID {0}"),
            uuid);
    }

    /// <summary>
    /// Generate one UUID and fold it into the capped, newest-first history — the web <c>generate</c>
    /// callback (<c>setUuids((prev) =&gt; [uuid, ...prev].slice(0, 10))</c>). Raises <see cref="Uuids"/>
    /// every time, and <see cref="State"/> / <see cref="HasResults"/> only on the empty → ready transition.
    /// </summary>
    public void Generate()
    {
        string uuid = _factory.NewUuid();
        bool hadResults = HasResults;

        _uuids = UuidHistory.Prepend(_uuids, uuid, UuidGeneratorRegistration.MaxHistory);
        Raise(nameof(Uuids));

        if (hadResults != HasResults)
        {
            Raise(nameof(State));
            Raise(nameof(HasResults));
        }

        LastAnnouncement = string.Format(
            CultureInfo.CurrentCulture,
            _localizer.GetString("devtools.uuidGenerator.announce", "Generated {0}"),
            uuid);
    }

    private void Raise([CallerMemberName] string? name = null) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
