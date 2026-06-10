using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// One per-section row count returned by the backend reset endpoint — the native mirror of the web
/// <c>SettingsResetSectionResult</c> (web/src/api/hooks/useSettingsReset.ts) and the Go
/// <c>database.SettingsResetSectionResult</c>. <see cref="Section"/> is the canonical lower-snake-case section
/// id and <see cref="Reset"/> the number of rows that section deleted.
/// </summary>
public sealed record SettingsResetSectionResult(string Section, int Reset);

/// <summary>
/// The top-level reset receipt returned by <c>POST /settings/reset</c> — the native mirror of the web
/// <c>SettingsResetResult</c> and the Go <c>database.SettingsResetResult</c>. <see cref="Reset"/> is the sum of
/// the per-section counts and <see cref="Sections"/> lists each section in the order it ran.
/// </summary>
public sealed record SettingsResetResult(int Reset, IReadOnlyList<SettingsResetSectionResult> Sections)
{
    /// <summary>An empty receipt (nothing reset) used as the null-object fallback for a non-object response.</summary>
    public static SettingsResetResult Empty { get; } = new(0, Array.Empty<SettingsResetSectionResult>());
}

/// <summary>
/// Null-tolerant reader for the <c>POST /settings/reset</c> JSON body — the native analogue of the web
/// mutation's <c>SettingsResetResult</c> shape. Every field is read defensively (a missing / mistyped member
/// coalesces to zero / empty) so a partial or unexpected payload never throws. Free of WinUI types so the
/// parse is unit-tested without a UI host.
/// </summary>
public static class SettingsResetResultParser
{
    /// <summary>
    /// Read the reset receipt from <paramref name="element"/>. A non-object body yields
    /// <see cref="SettingsResetResult.Empty"/>; <c>reset</c> reads as an integer (0 when absent / non-numeric)
    /// and <c>sections</c> as the ordered list of <c>{ section, reset }</c> entries (object entries only).
    /// </summary>
    public static SettingsResetResult Parse(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return SettingsResetResult.Empty;
        }

        int reset = ReadInt(element, "reset");

        var sections = new List<SettingsResetSectionResult>();
        if (element.TryGetProperty("sections", out var list) && list.ValueKind == JsonValueKind.Array)
        {
            foreach (var entry in list.EnumerateArray())
            {
                if (entry.ValueKind != JsonValueKind.Object)
                {
                    continue;
                }

                string section = entry.TryGetProperty("section", out var s) && s.ValueKind == JsonValueKind.String
                    ? s.GetString() ?? string.Empty
                    : string.Empty;

                sections.Add(new SettingsResetSectionResult(section, ReadInt(entry, "reset")));
            }
        }

        return new SettingsResetResult(reset, sections);
    }

    private static int ReadInt(JsonElement element, string name) =>
        element.TryGetProperty(name, out var value)
        && value.ValueKind == JsonValueKind.Number
        && value.TryGetInt32(out var parsed)
            ? parsed
            : 0;
}

/// <summary>
/// A whitelisted, user-resettable section row — the native mirror of the web <c>SectionRow</c> in
/// <c>ResetSection.tsx</c> (<c>useSectionRows</c>). <see cref="Id"/> is the canonical lower-snake-case section
/// name POSTed to the backend; <see cref="Title"/> / <see cref="Description"/> are localized; <see cref="Glyph"/>
/// is the decorative Segoe Fluent icon standing in for the web Lucide icon.
/// </summary>
public sealed record ResetSectionRow(string Id, string Title, string Description, string Glyph);

/// <summary>
/// A section the Settings page cannot reset (the deny-list) — the native mirror of the web <c>DeniedRow</c>
/// (<c>useDeniedRows</c>). It is read-only: <see cref="Title"/> names the section and <see cref="Reason"/>
/// explains where the user should go instead.
/// </summary>
public sealed record ResetDeniedRow(string Id, string Title, string Reason);

/// <summary>
/// Canonical metadata, section / deny-list ids, Segoe Fluent glyphs and i18n keys for the <c>ResetSection</c>
/// feature surface — the native mirror of <c>web/src/features/settings/components/ResetSection.tsx</c>. Every
/// localized string is keyed exactly as the web <c>t(...)</c> calls (with the same English fallbacks) so the
/// view and view-model stay free of literal copy. UI-free so every key is asserted in tests.
/// </summary>
public static class ResetSectionRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "ResetSection";

    /// <summary>The literal sentinel the danger-zone reset requires the user to type (web <c>requireTypedConfirmation</c>).</summary>
    public const string TypedConfirmationToken = "RESET";

    /// <summary>Segoe Fluent "Refresh" glyph standing in for the web <c>RotateCcw</c> header / action icon.</summary>
    public const string ResetGlyph = "\uE72C";

    /// <summary>Segoe Fluent "Shield" glyph standing in for the web <c>Shield</c> deny-list header icon.</summary>
    public const string ShieldGlyph = "\uEA18";

    /// <summary>Segoe Fluent "Warning" glyph standing in for the web <c>AlertOctagon</c> / <c>AlertTriangle</c> icons.</summary>
    public const string WarningGlyph = "\uE7BA";

    /// <summary>Segoe Fluent "CheckMark" glyph for the inline success line (the web success toast).</summary>
    public const string SuccessGlyph = "\uE73E";

    /// <summary>Segoe Fluent "Error" glyph for the inline failure line (the web error toast).</summary>
    public const string ErrorGlyph = "\uE783";

    // ── Section ids (the lower-snake-case names POSTed to the backend) ───────────────────────────────────

    /// <summary>The eight whitelisted section ids in web render order.</summary>
    public static IReadOnlyList<string> SectionIds { get; } =
    [
        "general",
        "appearance",
        "alert_rules",
        "geofences",
        "notification_channels",
        "dashboard_layout",
        "automations",
        "quiet_hours",
    ];

    /// <summary>The two deny-list section ids (web <c>tariffs</c> / <c>sound_prefs</c>).</summary>
    public static IReadOnlyList<string> DeniedIds { get; } = ["tariffs", "sound_prefs"];

    // ── Header (web settingsReset.title / settingsReset.subtitle) ────────────────────────────────────────

    /// <summary>By-section panel heading (web <c>settingsReset.title</c>).</summary>
    public static string Title(ILocalizer localizer) =>
        Require(localizer).GetString("settingsReset.title", "Reset to defaults");

    /// <summary>By-section panel subtitle (web <c>settingsReset.subtitle</c>).</summary>
    public static string Subtitle(ILocalizer localizer) =>
        Require(localizer).GetString(
            "settingsReset.subtitle",
            "Restore an individual section to its default state. Each reset is destructive and cannot be undone \u2014 export your settings first if you want a backup.");

    /// <summary>Per-row reset button label (web <c>settingsReset.actions.reset</c>).</summary>
    public static string ResetAction(ILocalizer localizer) =>
        Require(localizer).GetString("settingsReset.actions.reset", "Reset");

    // ── Deny-list panel (web settingsReset.denied* / settingsReset.denied.*) ─────────────────────────────

    /// <summary>Deny-list panel title (web <c>settingsReset.deniedTitle</c>).</summary>
    public static string DeniedTitle(ILocalizer localizer) =>
        Require(localizer).GetString("settingsReset.deniedTitle", "Sections that aren\u2019t user-resettable");

    /// <summary>Deny-list panel subtitle (web <c>settingsReset.deniedSubtitle</c>).</summary>
    public static string DeniedSubtitle(ILocalizer localizer) =>
        Require(localizer).GetString(
            "settingsReset.deniedSubtitle",
            "These sections live outside this server\u2019s preference store. The Settings page can\u2019t reset them, but the linked instructions tell you where to go.");

    // ── Danger zone (web settingsReset.dangerZone.*) ─────────────────────────────────────────────────────

    /// <summary>Danger-zone panel title (web <c>settingsReset.dangerZone.title</c>).</summary>
    public static string DangerZoneTitle(ILocalizer localizer) =>
        Require(localizer).GetString("settingsReset.dangerZone.title", "Danger zone");

    /// <summary>Danger-zone panel subtitle (web <c>settingsReset.dangerZone.subtitle</c>).</summary>
    public static string DangerZoneSubtitle(ILocalizer localizer) =>
        Require(localizer).GetString(
            "settingsReset.dangerZone.subtitle",
            "Wipe every user-discoverable preference at once. Alert rules, geofences, channels, automations, dashboard layouts, and your typed preference rows are all deleted in a single transaction.");

    /// <summary>Danger-zone helper line (web <c>settingsReset.dangerZone.help</c>).</summary>
    public static string DangerZoneHelp(ILocalizer localizer) =>
        Require(localizer).GetString("settingsReset.dangerZone.help", "You will be asked to type RESET to confirm.");

    /// <summary>Danger-zone CTA button (web <c>settingsReset.dangerZone.cta</c>).</summary>
    public static string DangerZoneCta(ILocalizer localizer) =>
        Require(localizer).GetString("settingsReset.dangerZone.cta", "Reset ALL settings");

    // ── Confirm dialogs (web settingsReset.confirm.*) ────────────────────────────────────────────────────

    /// <summary>Per-section confirm title template (web <c>settingsReset.confirm.sectionTitle</c>, <c>{{name}}</c>).</summary>
    public static string SectionConfirmTitleTemplate(ILocalizer localizer) =>
        Require(localizer).GetString("settingsReset.confirm.sectionTitle", "Reset {{name}}?");

    /// <summary>Per-section confirm message template (web <c>settingsReset.confirm.sectionMessage</c>, <c>{{description}}</c>).</summary>
    public static string SectionConfirmMessageTemplate(ILocalizer localizer) =>
        Require(localizer).GetString("settingsReset.confirm.sectionMessage", "{{description}} This action is permanent.");

    /// <summary>Per-section confirm primary label (web <c>settingsReset.confirm.confirmLabel</c>).</summary>
    public static string ConfirmLabel(ILocalizer localizer) =>
        Require(localizer).GetString("settingsReset.confirm.confirmLabel", "Reset");

    /// <summary>Shared cancel label (web <c>settingsReset.confirm.cancelLabel</c>).</summary>
    public static string CancelLabel(ILocalizer localizer) =>
        Require(localizer).GetString("settingsReset.confirm.cancelLabel", "Cancel");

    /// <summary>Danger-zone confirm title (web <c>settingsReset.confirm.allTitle</c>).</summary>
    public static string AllConfirmTitle(ILocalizer localizer) =>
        Require(localizer).GetString("settingsReset.confirm.allTitle", "Reset every user-discoverable setting?");

    /// <summary>Danger-zone confirm message (web <c>settingsReset.confirm.allMessage</c>).</summary>
    public static string AllConfirmMessage(ILocalizer localizer) =>
        Require(localizer).GetString(
            "settingsReset.confirm.allMessage",
            "Every alert rule, geofence, channel, automation, dashboard layout preset, and preference row will be permanently deleted. This cannot be undone.");

    /// <summary>Danger-zone confirm primary label (web <c>settingsReset.confirm.allConfirmLabel</c>).</summary>
    public static string AllConfirmLabel(ILocalizer localizer) =>
        Require(localizer).GetString("settingsReset.confirm.allConfirmLabel", "Reset everything");

    /// <summary>Danger-zone typed-confirmation field label (web <c>settingsReset.confirm.typedLabel</c>).</summary>
    public static string TypedConfirmationLabel(ILocalizer localizer) =>
        Require(localizer).GetString("settingsReset.confirm.typedLabel", "Type RESET to confirm");

    // ── Success / failure feedback (web settingsReset.toasts.* + the hook error toasts) ──────────────────

    /// <summary>Success line title (web <c>settingsReset.toasts.successTitle</c>).</summary>
    public static string SuccessTitle(ILocalizer localizer) =>
        Require(localizer).GetString("settingsReset.toasts.successTitle", "Settings reset");

    /// <summary>Success line detail template (web <c>settingsReset.toasts.successDetail</c>, <c>{{count}}</c> / <c>{{sections}}</c>).</summary>
    public static string SuccessDetailTemplate(ILocalizer localizer) =>
        Require(localizer).GetString(
            "settingsReset.toasts.successDetail",
            "{{count}} item(s) reset across {{sections}} section(s).");

    /// <summary>Per-section failure line (web <c>toast.settings.reset.error</c>).</summary>
    public static string SectionErrorMessage(ILocalizer localizer) =>
        Require(localizer).GetString("toast.settings.reset.error", "Failed to reset section");

    /// <summary>Danger-zone failure line (web <c>toast.settings.reset.allError</c>).</summary>
    public static string AllErrorMessage(ILocalizer localizer) =>
        Require(localizer).GetString("toast.settings.reset.allError", "Failed to reset all settings");

    // ── Section copy (web settingsReset.section.<camel>.title / .desc) ───────────────────────────────────

    /// <summary>The localized title for a section id (web <c>settingsReset.section.&lt;camel&gt;.title</c>).</summary>
    public static string SectionTitle(string id, ILocalizer localizer) => id switch
    {
        "general" => Require(localizer).GetString("settingsReset.section.general.title", "General preferences"),
        "appearance" => Require(localizer).GetString("settingsReset.section.appearance.title", "Appearance"),
        "alert_rules" => Require(localizer).GetString("settingsReset.section.alertRules.title", "Alert rules"),
        "geofences" => Require(localizer).GetString("settingsReset.section.geofences.title", "Geofences"),
        "notification_channels" => Require(localizer).GetString("settingsReset.section.notificationChannels.title", "Notification channels"),
        "dashboard_layout" => Require(localizer).GetString("settingsReset.section.dashboardLayout.title", "Dashboard layouts"),
        "automations" => Require(localizer).GetString("settingsReset.section.automations.title", "Automations"),
        "quiet_hours" => Require(localizer).GetString("settingsReset.section.quietHours.title", "Quiet hours"),
        _ => id,
    };

    /// <summary>The localized description for a section id (web <c>settingsReset.section.&lt;camel&gt;.desc</c>).</summary>
    public static string SectionDescription(string id, ILocalizer localizer) => id switch
    {
        "general" => Require(localizer).GetString(
            "settingsReset.section.general.desc",
            "Units, language, currency, timezone, and energy/gas pricing defaults."),
        "appearance" => Require(localizer).GetString(
            "settingsReset.section.appearance.desc",
            "Theme, density, chart palette, and notification badge / flash preferences."),
        "alert_rules" => Require(localizer).GetString(
            "settingsReset.section.alertRules.desc",
            "Delete every alert rule you have authored. Cannot be undone."),
        "geofences" => Require(localizer).GetString(
            "settingsReset.section.geofences.desc",
            "Delete every geofence and its electricity-rate overrides. Vehicle home assignments will be cleared."),
        "notification_channels" => Require(localizer).GetString(
            "settingsReset.section.notificationChannels.desc",
            "Delete every webhook, Discord, Slack, email, and push channel along with their delivery history."),
        "dashboard_layout" => Require(localizer).GetString(
            "settingsReset.section.dashboardLayout.desc",
            "Delete every saved dashboard layout preset."),
        "automations" => Require(localizer).GetString(
            "settingsReset.section.automations.desc",
            "Delete every automation, including its triggers, conditions, actions, variables, and run history."),
        "quiet_hours" => Require(localizer).GetString(
            "settingsReset.section.quietHours.desc",
            "Delete every quiet-hours window for your account."),
        _ => string.Empty,
    };

    /// <summary>The decorative Segoe Fluent glyph for a section id (the web Lucide icon stand-in).</summary>
    public static string SectionGlyph(string id) => id switch
    {
        "general" => "\uE713",                 // Setting (web Cog)
        "appearance" => "\uE790",              // Color (web Palette)
        "alert_rules" => "\uEA8F",             // Ringer (web Bell)
        "geofences" => "\uE707",               // Map / pin (web MapPin)
        "notification_channels" => "\uEA8F",   // Ringer (web Bell)
        "dashboard_layout" => "\uE8A9",        // ViewAll (web LayoutDashboard)
        "automations" => "\uE9F5",             // Flow (web Workflow)
        "quiet_hours" => "\uE787",             // Calendar (web Calendar)
        _ => "\uE713",
    };

    // ── Deny-list copy (web settingsReset.denied.<camel>.title / .reason) ────────────────────────────────

    /// <summary>The localized title for a deny-list section id (web <c>settingsReset.denied.&lt;camel&gt;.title</c>).</summary>
    public static string DeniedTitleFor(string id, ILocalizer localizer) => id switch
    {
        "tariffs" => Require(localizer).GetString("settingsReset.denied.tariffs.title", "Charge cost tariffs"),
        "sound_prefs" => Require(localizer).GetString("settingsReset.denied.soundPrefs.title", "Notification sound preferences"),
        _ => id,
    };

    /// <summary>The localized reason for a deny-list section id (web <c>settingsReset.denied.&lt;camel&gt;.reason</c>).</summary>
    public static string DeniedReasonFor(string id, ILocalizer localizer) => id switch
    {
        "tariffs" => Require(localizer).GetString(
            "settingsReset.denied.tariffs.reason",
            "Tariffs are stored per-vehicle. Reset the assignment from the Vehicle Settings page on the vehicle detail screen."),
        "sound_prefs" => Require(localizer).GetString(
            "settingsReset.denied.soundPrefs.reason",
            "Notification sound preferences are stored in your browser. Clear them via your browser\u2019s site-data controls."),
        _ => string.Empty,
    };

    private static ILocalizer Require(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer;
    }
}

/// <summary>
/// Pure projections for the <c>ResetSection</c> surface — the native analogue of the web component's
/// <c>useSectionRows</c> / <c>useDeniedRows</c> memos and its inline confirm-copy / success-detail
/// interpolation. Every user-visible string flows through the i18n facade so the projection is unit-tested
/// headlessly and the view-model never resolves a literal.
/// </summary>
public static class ResetSectionProjection
{
    /// <summary>The eight whitelisted, user-resettable section rows in web render order (web <c>useSectionRows</c>).</summary>
    public static IReadOnlyList<ResetSectionRow> Sections(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        var rows = new List<ResetSectionRow>(ResetSectionRegistration.SectionIds.Count);
        foreach (var id in ResetSectionRegistration.SectionIds)
        {
            rows.Add(new ResetSectionRow(
                id,
                ResetSectionRegistration.SectionTitle(id, localizer),
                ResetSectionRegistration.SectionDescription(id, localizer),
                ResetSectionRegistration.SectionGlyph(id)));
        }

        return rows;
    }

    /// <summary>The two read-only deny-list rows (web <c>useDeniedRows</c>).</summary>
    public static IReadOnlyList<ResetDeniedRow> DeniedRows(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        var rows = new List<ResetDeniedRow>(ResetSectionRegistration.DeniedIds.Count);
        foreach (var id in ResetSectionRegistration.DeniedIds)
        {
            rows.Add(new ResetDeniedRow(
                id,
                ResetSectionRegistration.DeniedTitleFor(id, localizer),
                ResetSectionRegistration.DeniedReasonFor(id, localizer)));
        }

        return rows;
    }

    /// <summary>The per-section confirm title with the section name filled in (web <c>{{name}}</c>).</summary>
    public static string SectionConfirmTitle(ResetSectionRow row, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(row);
        return Fill(ResetSectionRegistration.SectionConfirmTitleTemplate(localizer), "name", row.Title);
    }

    /// <summary>The per-section confirm message with the section description filled in (web <c>{{description}}</c>).</summary>
    public static string SectionConfirmMessage(ResetSectionRow row, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(row);
        return Fill(ResetSectionRegistration.SectionConfirmMessageTemplate(localizer), "description", row.Description);
    }

    /// <summary>
    /// The localized success detail (web <c>settingsReset.toasts.successDetail</c>) with the reset count and the
    /// number of affected sections filled in.
    /// </summary>
    public static string SuccessDetail(int resetCount, int sectionCount, ILocalizer localizer)
    {
        string template = ResetSectionRegistration.SuccessDetailTemplate(localizer);
        string withCount = Fill(template, "count", Math.Max(0, resetCount).ToString(CultureInfo.CurrentCulture));
        return Fill(withCount, "sections", Math.Max(0, sectionCount).ToString(CultureInfo.CurrentCulture));
    }

    /// <summary>
    /// True when <paramref name="input"/> exactly matches the required confirmation sentinel (web
    /// <c>requireTypedConfirmation="RESET"</c>): a case-sensitive, ordinal comparison so <c>reset</c> does not
    /// satisfy it.
    /// </summary>
    public static bool IsTypedConfirmationSatisfied(string? input) =>
        string.Equals(input, ResetSectionRegistration.TypedConfirmationToken, StringComparison.Ordinal);

    private static string Fill(string template, string token, string value) =>
        template.Replace("{{" + token + "}}", value, StringComparison.Ordinal);
}

/// <summary>
/// PII-safe diagnostics for the <c>ResetSection</c> surface (P1/S11 diagnostics contract). Records only
/// operational counters with the surface slug — never which section was reset — so a diagnostics line can
/// never leak what a user wiped. Thread-safe.
/// </summary>
public sealed class ResetSectionDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;
    private long _sectionResets;
    private long _allResets;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public ResetSectionDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Number of single-section resets that completed.</summary>
    public long SectionResets => Interlocked.Read(ref _sectionResets);

    /// <summary>Number of global "reset everything" operations that completed.</summary>
    public long AllResets => Interlocked.Read(ref _allResets);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=ResetSection</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={ResetSectionRegistration.Slug}");
    }

    /// <summary>Record that a single-section reset completed (the section id is never logged).</summary>
    public void RecordSectionReset()
    {
        Interlocked.Increment(ref _sectionResets);
        _sink?.Invoke($"settings.reset.section slug={ResetSectionRegistration.Slug}");
    }

    /// <summary>Record that the global reset completed.</summary>
    public void RecordAllReset()
    {
        Interlocked.Increment(ref _allResets);
        _sink?.Invoke($"settings.reset.all slug={ResetSectionRegistration.Slug}");
    }
}
