namespace TeslaSync.App.FeatureViews.ClientUtilities;

/// <summary>
/// The source of the surface's client-utility entries (P1/S8 state-holder seam). The web
/// <c>ClientUtilitiesSection</c> hard-codes its catalog in the <c>useToolList</c> hook
/// (web/src/features/admin/components/devtools/ClientUtilitiesSection.tsx) rather than reading the network —
/// but routing the list through a seam keeps the view-model free of literals and lets a test substitute an
/// empty or alternate catalog to exercise the empty branch.
/// </summary>
public interface IClientUtilityToolSource
{
    /// <summary>The ordered client-utility entries to project into cards.</summary>
    IReadOnlyList<ClientUtilityTool> GetTools();
}

/// <summary>
/// The canonical <see cref="IClientUtilityToolSource"/> — the fifteen developer utilities the web
/// <c>useToolList</c> hook registers, in the same order (VIN decoder, JWT decoder, timestamp, Base64, URL
/// encoder, JSON formatter, UUID generator, hash calculator, byte-size converter, colour converter, cron
/// parser, HTTP status, Tesla API reference, regex tester, Unix permission). Each entry carries the web
/// tool <c>id</c>, the Segoe Fluent glyph standing in for the web Lucide icon, the web i18n key + English
/// fallback for the name and description, and the semantic accent token mapped from the web Tailwind neon
/// colour (web <c>ICON_COLOR_MAP</c>). Headless and immutable, so the catalog is asserted in unit tests.
/// </summary>
public sealed class ClientUtilityToolSource : IClientUtilityToolSource
{
    // Segoe Fluent Icons / MDL2 code points — the platform glyph standing in for each web Lucide icon.
    private const string CarGlyph = "\uE804";          // web Car — VIN decoder
    private const string KeyGlyph = "\uE192";          // web Key — JWT decoder (Permissions)
    private const string ClockGlyph = "\uE823";        // web Clock — timestamp (Recent)
    private const string CodeGlyph = "\uE943";         // web Braces — Base64 / JSON (Code)
    private const string LinkGlyph = "\uE71B";         // web Link — URL encoder
    private const string DocumentGlyph = "\uE8A5";     // web Braces — JSON formatter (Document)
    private const string FingerprintGlyph = "\uE8D7";  // web Fingerprint — UUID generator
    private const string HashGlyph = "\uE8EF";         // web Hash — hash calculator
    private const string DriveGlyph = "\uEDA2";        // web HardDrive — byte-size converter
    private const string ColorGlyph = "\uE790";        // web Palette — colour converter
    private const string CalendarGlyph = "\uE787";     // web Timer — cron parser (Calendar)
    private const string NetworkGlyph = "\uE774";      // web Network — HTTP status (Globe)
    private const string BookGlyph = "\uE82D";         // web BookOpen — Tesla API reference (Library)
    private const string RegexGlyph = "\uE946";        // web Regex — regex tester (Info)
    private const string LockGlyph = "\uE72E";         // web Lock — Unix permission

    // Semantic accent tokens (web Tailwind neon ICON_COLOR_MAP -> nearest design token; no ad-hoc hex).
    private const string Cyan = "TsColorInfoBrush";       // web neon-cyan
    private const string Green = "TsColorSuccessBrush";   // web neon-green
    private const string Purple = "TsColorAccentBrush";   // web neon-purple
    private const string Amber = "TsColorWarningBrush";   // web neon-amber
    private const string Red = "TsColorDangerBrush";      // web neon-red

    /// <summary>The canonical, ordered tool catalog (web <c>useToolList</c>).</summary>
    public static IReadOnlyList<ClientUtilityTool> Canonical { get; } = new[]
    {
        new ClientUtilityTool("vin", CarGlyph, "Vin Decoder", "Vin Decoder", "Vin Decoder Desc", "Vin Decoder Desc", Cyan),
        new ClientUtilityTool("jwt", KeyGlyph, "Jwt Decoder", "Jwt Decoder", "Jwt Decoder Desc", "Jwt Decoder Desc", Purple),
        new ClientUtilityTool("timestamp", ClockGlyph, "Timestamp", "Timestamp", "Timestamp Desc", "Timestamp Desc", Green),
        new ClientUtilityTool("base64", CodeGlyph, "devtools.utils.base64", "Base64", "devtools.utils.base64Desc", "Base64Desc", Amber),
        new ClientUtilityTool("url", LinkGlyph, "Url Encoder", "Url Encoder", "Url Encoder Desc", "Url Encoder Desc", Cyan),
        new ClientUtilityTool("json", DocumentGlyph, "Json Formatter", "Json Formatter", "Json Formatter Desc", "Json Formatter Desc", Green),
        new ClientUtilityTool("uuid", FingerprintGlyph, "Uuid Generator", "Uuid Generator", "Uuid Generator Desc", "Uuid Generator Desc", Purple),
        new ClientUtilityTool("hash", HashGlyph, "Hash Calculator", "Hash Calculator", "Hash Calculator Desc", "Hash Calculator Desc", Red),
        new ClientUtilityTool("bytes", DriveGlyph, "Byte Size", "Byte Size", "Byte Size Desc", "Byte Size Desc", Cyan),
        new ClientUtilityTool("color", ColorGlyph, "Color Converter", "Color Converter", "Color Converter Desc", "Color Converter Desc", Purple),
        new ClientUtilityTool("cron", CalendarGlyph, "Cron Parser", "Cron Parser", "Cron Parser Desc", "Cron Parser Desc", Green),
        new ClientUtilityTool("http", NetworkGlyph, "Http Status", "Http Status", "Http Status Desc", "Http Status Desc", Amber),
        new ClientUtilityTool("tesla-api", BookGlyph, "Tesla Api Ref", "Tesla Api Ref", "Tesla Api Ref Desc", "Tesla Api Ref Desc", Cyan),
        new ClientUtilityTool("regex", RegexGlyph, "Regex Tester", "Regex Tester", "Regex Tester Desc", "Regex Tester Desc", Red),
        new ClientUtilityTool("unix-perm", LockGlyph, "Unix Perm", "Unix Perm", "Unix Perm Desc", "Unix Perm Desc", Green),
    };

    /// <inheritdoc />
    public IReadOnlyList<ClientUtilityTool> GetTools() => Canonical;
}
