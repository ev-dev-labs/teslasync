using System.Text;

namespace TeslaSync.TokenGen;

/// <summary>
/// CLI entry point. Resolves the repository's <c>apps/design/tokens.json</c>
/// and writes the generated Fluent token dictionary to
/// <c>apps/design/generated/windows/Tokens.xaml</c>.
///
/// Usage:
///   TeslaSync.TokenGen                 generate (write the dictionary)
///   TeslaSync.TokenGen --check         fail (exit 2) if the committed file drifted
///   TeslaSync.TokenGen &lt;in&gt; &lt;out&gt;       explicit input/output paths
/// </summary>
internal static class Program
{
    private const string TokensRelative = "apps/design/tokens.json";
    private const string OutputRelative = "apps/design/generated/windows/Tokens.xaml";

    private static int Main(string[] args)
    {
        bool check = args.Contains("--check", StringComparer.OrdinalIgnoreCase);
        string[] positional = args.Where(a => !a.StartsWith("--", StringComparison.Ordinal)).ToArray();

        string repoRoot = FindRepoRoot();
        string tokensPath = positional.Length > 0 ? positional[0] : Path.Combine(repoRoot, TokensRelative);
        string outputPath = positional.Length > 1 ? positional[1] : Path.Combine(repoRoot, OutputRelative);

        if (!File.Exists(tokensPath))
        {
            Console.Error.WriteLine($"tokens.json not found at: {tokensPath}");
            return 1;
        }

        string json = File.ReadAllText(tokensPath);
        string generated = TokenGenerator.Generate(json);

        if (check)
        {
            string existing = File.Exists(outputPath) ? File.ReadAllText(outputPath) : string.Empty;
            if (!string.Equals(Normalize(existing), Normalize(generated), StringComparison.Ordinal))
            {
                Console.Error.WriteLine($"DRIFT: {outputPath} does not match generator output. Re-run TeslaSync.TokenGen.");
                return 2;
            }

            Console.WriteLine($"OK: {outputPath} is in sync with {Path.GetFileName(tokensPath)}.");
            return 0;
        }

        Directory.CreateDirectory(Path.GetDirectoryName(outputPath)!);
        File.WriteAllText(outputPath, generated, new UTF8Encoding(false));
        Console.WriteLine($"Wrote {outputPath} ({generated.Length} chars) from {tokensPath}.");
        return 0;
    }

    private static string Normalize(string value)
        => value.Replace("\r\n", "\n", StringComparison.Ordinal);

    private static string FindRepoRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null)
        {
            if (File.Exists(Path.Combine(dir.FullName, TokensRelative)))
            {
                return dir.FullName;
            }

            dir = dir.Parent;
        }

        return Directory.GetCurrentDirectory();
    }
}
