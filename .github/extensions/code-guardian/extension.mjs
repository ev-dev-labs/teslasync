import { joinSession } from "@github/copilot-sdk/extension";
import { readFileSync, existsSync } from "node:fs";
import { resolve, relative } from "node:path";
import { execFile } from "node:child_process";

/* ================================================================
 *  TeslaSync Code Guardian Extension
 *
 *  Provides:
 *  1. onPostToolUse hook — auto-audits .tsx/.ts files after edit/create
 *  2. onSessionStart hook — injects critical rules as context
 *  3. audit_code tool — full violations audit on a file or directory
 * ================================================================ */

const isWindows = process.platform === "win32";

// ── Violation patterns ──────────────────────────────────────────
// Each rule: { id, pattern (regex), message, fileGlob }
const RULES = [
  {
    id: "static-inline-style",
    // Matches style={{ ... var(-- ... }} but NOT dynamic patterns
    test: (line) => /style=\{\{/.test(line) && /var\(--/.test(line) && !/\?/.test(line) && !/\[/.test(line),
    message: "Static inline style with var(--*) — use Tailwind class instead",
    applies: (f) => f.endsWith(".tsx"),
  },
  {
    id: "raw-html-button",
    test: (line) => /<button\b/i.test(line) && !/<Button/i.test(line),
    message: "Raw <button> — use <Button> from @/components/ui",
    applies: (f) => f.endsWith(".tsx"),
  },
  {
    id: "raw-html-input",
    test: (line) => /<input\b/i.test(line) && !/<Input/i.test(line),
    message: "Raw <input> — use <Input> from @/components/ui",
    applies: (f) => f.endsWith(".tsx"),
  },
  {
    id: "raw-html-textarea",
    test: (line) => /<textarea\b/i.test(line) && !/<Textarea/i.test(line),
    message: "Raw <textarea> — use <Textarea> from @/components/ui",
    applies: (f) => f.endsWith(".tsx"),
  },
  {
    id: "raw-html-select",
    test: (line) => /<select\b/i.test(line) && !/<Select/i.test(line) && !/SelectOption/.test(line),
    message: "Raw <select> — use <Select> from @/components/ui",
    applies: (f) => f.endsWith(".tsx"),
  },
  {
    id: "raw-html-table",
    test: (line) => /<table\b/i.test(line) && !/<DataTable/i.test(line),
    message: "Raw <table> — use <DataTable> from @/components/ui",
    applies: (f) => f.endsWith(".tsx"),
  },
  {
    id: "direct-recharts-import",
    test: (line) => /from\s+['"]recharts['"]/.test(line),
    message: "Direct recharts import — use @/components/charts barrel instead",
    applies: (f) => f.endsWith(".tsx") || f.endsWith(".ts"),
  },
  {
    id: "direct-leaflet-import",
    test: (line) => /from\s+['"]react-leaflet['"]/.test(line),
    message: "Direct react-leaflet import — use @/components/maps barrel instead",
    applies: (f) => f.endsWith(".tsx") || f.endsWith(".ts"),
  },
  {
    id: "old-api-import",
    test: (line) => /from\s+['"]\.\.\/api['"]/.test(line) || /from\s+['"]\.\.\/\.\.\/api['"]/.test(line),
    message: "Old API import — use hooks from @/api/hooks/ instead",
    applies: (f) => f.endsWith(".tsx") || f.endsWith(".ts"),
  },
  {
    id: "double-prefix",
    test: (line) => /['"`]\/api\/v1\//.test(line),
    message: "URL includes /api/v1/ prefix — request() adds this automatically, remove it",
    applies: (f) => /hooks\/use/.test(f),
  },
  {
    id: "camelcase-param",
    test: (line) => /vehicleId=/.test(line) && !/vehicleId\s*[?:!=]/.test(line),
    message: "camelCase query param 'vehicleId=' — use snake_case 'vehicle_id='",
    applies: (f) => f.endsWith(".tsx") || f.endsWith(".ts"),
  },
];

// Paths within the components/ directory are exempt from some rules
// (they ARE the shared components, so they can use raw elements)
function isSharedComponent(filePath) {
  const rel = filePath.replace(/\\/g, "/");
  return rel.includes("/components/ui/") ||
    rel.includes("/components/charts/") ||
    rel.includes("/components/maps/") ||
    rel.includes("/components/forms/") ||
    rel.includes("/components/data-display/") ||
    rel.includes("/components/feedback/") ||
    rel.includes("/components/layout/") ||
    rel.includes("/components/motion/");
}

// ── Audit a single file ─────────────────────────────────────────
function auditFile(filePath) {
  if (!existsSync(filePath)) return [];
  const isComponent = isSharedComponent(filePath);

  let content;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch {
    return [];
  }

  // Skip files > 100KB to avoid perf issues
  if (content.length > 100_000) return [];

  const lines = content.split("\n");
  const violations = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const rule of RULES) {
      // Skip raw-html checks inside shared component directories
      if (isComponent && rule.id.startsWith("raw-html")) continue;
      // Skip recharts/leaflet checks inside charts/maps barrels
      if (isComponent && (rule.id === "direct-recharts-import" || rule.id === "direct-leaflet-import")) continue;

      if (rule.applies(filePath) && rule.test(line)) {
        violations.push({
          line: i + 1,
          rule: rule.id,
          message: rule.message,
          code: line.trim().substring(0, 120),
        });
      }
    }
  }

  return violations;
}

// ── Format violations for agent context ─────────────────────────
function formatViolations(filePath, violations) {
  if (violations.length === 0) return null;
  const rel = relative(process.cwd(), filePath).replace(/\\/g, "/");
  const lines = violations.map(
    (v) => `  Line ${v.line}: [${v.rule}] ${v.message}\n    → ${v.code}`
  );
  return `⚠️ CODE GUARDIAN: ${violations.length} violation(s) in ${rel}:\n${lines.join("\n")}\n\nFix these violations before proceeding.`;
}

// ── Run grep-based audit on a directory ─────────────────────────
function runDirectoryAudit(dirPath) {
  return new Promise((resolve) => {
    const shell = isWindows ? "powershell" : "bash";
    const cmd = isWindows
      ? `Get-ChildItem -Path "${dirPath}" -Recurse -Include *.tsx,*.ts | ForEach-Object { $_.FullName }`
      : `find "${dirPath}" -name "*.tsx" -o -name "*.ts" | head -200`;
    const args = isWindows
      ? ["-NoProfile", "-Command", cmd]
      : ["-c", cmd];

    execFile(shell, args, { maxBuffer: 1024 * 1024 }, (err, stdout) => {
      if (err) {
        resolve({ error: err.message, files: 0, violations: [] });
        return;
      }
      const files = stdout.trim().split("\n").filter(Boolean);
      const allViolations = [];
      for (const f of files) {
        const violations = auditFile(f.trim());
        if (violations.length > 0) {
          const rel = relative(process.cwd(), f.trim()).replace(/\\/g, "/");
          allViolations.push({ file: rel, violations });
        }
      }
      resolve({ files: files.length, violations: allViolations });
    });
  });
}

// ── Join session ────────────────────────────────────────────────
const session = await joinSession({
  hooks: {
    // Inject rules reminder at session start
    onSessionStart: async () => {
      await session.log("🛡️ Code Guardian active — monitoring for violations");
      return {
        additionalContext: [
          "IMPORTANT: This project has a code-guardian extension that auto-audits files after edits.",
          "Key rules: No inline style={{}} with static var(--*), no raw HTML elements (use shared components),",
          "no direct recharts/leaflet imports (use @/components/charts or /maps barrels),",
          "no /api/v1/ prefix in hook URLs (request() adds it), snake_case query params only.",
          "Run the audit_code tool if you want to check a file or directory for violations.",
        ].join(" "),
      };
    },

    // Inject anti-shortcut reminders on every user prompt
    onUserPromptSubmitted: async (input) => {
      const prompt = (input.prompt || "").toLowerCase();
      const isPageTask = /page|restore|rebuild|create.*page|fix.*page|gutted/.test(prompt);
      const isAuditTask = /audit|check|verify|violations/.test(prompt);

      const rules = [
        "INTEGRITY: Do NOT claim checks pass without running them. Paste actual command output.",
        "INTEGRITY: Do NOT stub or gut pages. Implement ALL sections the original had.",
        "INTEGRITY: Do NOT gate all content behind a single empty/data check. Each section handles its own state.",
        "ANTI-REVERT: Do NOT revert to old code to fix bugs. Fix the NEW code using NEW architecture (hooks, shared components, Tailwind). Never re-import from old ../api or old pages/ paths.",
      ];

      if (isPageTask) {
        rules.push(
          "PAGE TASK: Compare line count against original (must be ≥70%). Count sections with grep.",
          "PAGE TASK: Every section always renders — use EmptyState for missing data, never hide panels.",
          "PAGE TASK: Verify every hook URL matches a route in internal/api/router.go before using it.",
        );
      }

      if (isAuditTask) {
        rules.push(
          "AUDIT TASK: Run actual grep commands and show raw output. Do not summarize from memory.",
          "AUDIT TASK: Check inline styles, raw HTML, direct imports, old API, double prefix, camelCase params, TypeScript.",
        );
      }

      return { additionalContext: rules.join("\n") };
    },

    // Auto-audit after file edits
    onPostToolUse: async (input) => {
      const toolName = input.toolName;
      if (toolName !== "edit" && toolName !== "create") return;

      const filePath = String(input.toolArgs?.path || "");
      if (!filePath) return;
      if (!filePath.endsWith(".tsx") && !filePath.endsWith(".ts")) return;

      // Only audit web/ files
      const normalized = filePath.replace(/\\/g, "/");
      if (!normalized.includes("/web/")) return;

      const violations = auditFile(filePath);
      const msg = formatViolations(filePath, violations);

      if (msg) {
        await session.log(`⚠️ ${violations.length} violation(s) found`, { level: "warning" });
        return { additionalContext: msg };
      }
    },
  },

  tools: [
    {
      name: "audit_code",
      description:
        "Audit a file or directory for TeslaSync engineering guideline violations. " +
        "Checks for: inline styles with var(--*), raw HTML elements, direct recharts/leaflet imports, " +
        "old API imports, double /api/v1/ prefix, camelCase query params. " +
        "Returns violation locations with rule IDs and suggested fixes.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description:
              "Absolute path to a file or directory to audit. " +
              "For a file: returns line-by-line violations. " +
              "For a directory: scans all .tsx/.ts files recursively.",
          },
        },
        required: ["path"],
      },
      handler: async (args) => {
        const targetPath = resolve(args.path);

        if (!existsSync(targetPath)) {
          return `Error: Path does not exist: ${args.path}`;
        }

        // Check if it's a file
        try {
          const stat = readFileSync(targetPath); // will throw for dirs
          // It's a file
          const violations = auditFile(targetPath);
          const rel = relative(process.cwd(), targetPath).replace(/\\/g, "/");
          if (violations.length === 0) {
            return `✅ ${rel}: No violations found.`;
          }
          const lines = violations.map(
            (v) => `  Line ${v.line}: [${v.rule}] ${v.message}\n    Code: ${v.code}`
          );
          return `❌ ${rel}: ${violations.length} violation(s)\n\n${lines.join("\n\n")}`;
        } catch {
          // It's a directory
          const result = await runDirectoryAudit(targetPath);
          if (result.error) {
            return `Error scanning directory: ${result.error}`;
          }
          if (result.violations.length === 0) {
            return `✅ Scanned ${result.files} files: No violations found.`;
          }
          const totalV = result.violations.reduce((s, f) => s + f.violations.length, 0);
          const sections = result.violations.map((f) => {
            const lines = f.violations.map(
              (v) => `    Line ${v.line}: [${v.rule}] ${v.message}`
            );
            return `  ${f.file} (${f.violations.length}):\n${lines.join("\n")}`;
          });
          return `❌ Scanned ${result.files} files: ${totalV} violation(s) in ${result.violations.length} file(s)\n\n${sections.join("\n\n")}`;
        }
      },
    },
  ],
});
