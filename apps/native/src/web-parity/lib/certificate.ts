// Native parity port of web/src/lib/certificate.ts.
//
// Web behaviour: from drive/charge totals it computes carbon-offset stats, then
// `window.open('', '_blank')` opens a popup, `document.write` injects a styled
// HTML certificate, `document.close()` finalises it and `print()` triggers the
// browser print dialog. The math + content are platform-agnostic; the
// popup -> document.write -> print pipeline is DOM-only and has no equivalent in
// the current bare React Native dependency set (no expo-print / WebView print
// bridge is installed).
//
// Web -> native (conversion contract rule 7):
//   * The pure calculation (`computeCarbonStats`) is ported verbatim — same
//     constants, same `Math.round` calls, same order (web L7-L10).
//   * The exact certificate markup is reproduced by `renderCarbonCertificateHtml`
//     (web L15-L63) so a future native print/share transport (a WebView or
//     react-native-print) can emit a byte-identical certificate, preserving the
//     visual intent. Branding strings, the `toLocaleString()` number formatting,
//     and the `ownerName || 'TeslaSync User'` fallback are kept unchanged.
//   * The browser-only present step (`window.open`/`document.write`/`print`,
//     web L12-L13/L64-L65) is modelled as a pluggable presenter. The default
//     native presenter reports an explicit `{ presented: false }` /
//     `reason: 'unavailable'` state — the parity of web's
//     `if (!printWindow) return` popup-blocked early return — instead of
//     silently pretending to print. `generateCarbonCertificate` always returns
//     the computed stats + html so callers (or a future native screen) can
//     render or share them.
//
// Note: `toLocaleString()` / `toLocaleDateString()` formatting follows the host
// JS engine's Intl support exactly as the web did (full-ICU Node under the test
// gate; Hermes per its Intl build at runtime).

export interface CarbonCertificateData {
  vehicleName: string;
  totalKm: number;
  totalKwh: number;
  ownerName?: string;
}

export interface CarbonCertificateStats {
  gasEquivalentL: number;
  co2SavedKg: number;
  treesEquivalent: number;
  gallonsSaved: number;
}

/** Result of attempting to present (print/share) the certificate. */
export interface CarbonCertificatePresentation {
  presented: boolean;
  reason?: 'unavailable';
}

/**
 * Pluggable side-effect target — the native analogue of the web's mockable
 * `window.open(...).document.write(...)` print pipeline. Receives the rendered
 * HTML and reports whether it could present it.
 */
export type CarbonCertificatePresenter = (
  html: string,
) => CarbonCertificatePresentation;

export interface CarbonCertificateResult {
  stats: CarbonCertificateStats;
  html: string;
  presentation: CarbonCertificatePresentation;
}

/**
 * Default native presenter: bare React Native has no `window.open` /
 * `document.write` / `print` pipeline, so presentation is explicitly
 * unavailable — mirroring web's `if (!printWindow) return` popup-blocked path.
 */
export const nativeUnavailablePresenter: CarbonCertificatePresenter = () => ({
  presented: false,
  reason: 'unavailable',
});

/** Pure carbon-offset math ported verbatim from web/src/lib/certificate.ts L7-L10. */
export function computeCarbonStats(
  data: CarbonCertificateData,
): CarbonCertificateStats {
  const gasEquivalentL = (data.totalKm / 100) * 8; // 8L/100km avg gas car
  const co2SavedKg = gasEquivalentL * 2.31; // kg CO2 per liter
  const treesEquivalent = Math.round(co2SavedKg / 22); // ~22kg CO2 per tree/year
  const gallonsSaved = Math.round(gasEquivalentL * 0.264172);
  return { gasEquivalentL, co2SavedKg, treesEquivalent, gallonsSaved };
}

/**
 * Reproduces the exact certificate markup the web wrote (web L15-L63). Returned
 * as a string so a native WebView / print bridge can render it later without
 * importing any DOM module.
 */
export function renderCarbonCertificateHtml(
  data: CarbonCertificateData,
): string {
  const { gasEquivalentL, co2SavedKg, treesEquivalent, gallonsSaved } =
    computeCarbonStats(data);

  return `<!DOCTYPE html><html><head>
    <title>Carbon Offset Certificate — TeslaSync</title>
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600;700;900&display=swap');
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body { font-family: 'Inter', sans-serif; background: #0a0a1a; color: #e4e4ef; display: flex; justify-content: center; padding: 40px; }
      .cert { width: 700px; border: 2px solid #00f0ff; border-radius: 24px; padding: 48px; position: relative; overflow: hidden; }
      .cert::before { content: ''; position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: radial-gradient(circle at 30% 20%, rgba(0,240,255,0.06), transparent 60%), radial-gradient(circle at 70% 80%, rgba(16,185,129,0.04), transparent 60%); }
      .content { position: relative; z-index: 1; }
      h1 { text-align: center; font-size: 28px; font-weight: 900; background: linear-gradient(135deg, #00f0ff, #10b981); -webkit-background-clip: text; -webkit-text-fill-color: transparent; margin-bottom: 8px; }
      .subtitle { text-align: center; font-size: 12px; color: #6b7280; letter-spacing: 3px; text-transform: uppercase; margin-bottom: 32px; }
      .hero { text-align: center; margin: 32px 0; }
      .hero-number { font-size: 64px; font-weight: 900; color: #10b981; }
      .hero-unit { font-size: 18px; color: #6b7280; }
      .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin: 32px 0; }
      .stat { text-align: center; padding: 16px; border: 1px solid rgba(0,240,255,0.15); border-radius: 12px; }
      .stat-value { font-size: 24px; font-weight: 700; color: #00f0ff; }
      .stat-label { font-size: 10px; color: #6b7280; margin-top: 4px; text-transform: uppercase; }
      .owner { text-align: center; margin-top: 32px; padding-top: 24px; border-top: 1px solid rgba(255,255,255,0.1); }
      .owner-name { font-size: 20px; font-weight: 600; color: #e4e4ef; }
      .date { text-align: center; font-size: 11px; color: #4b5563; margin-top: 16px; }
      .footer { text-align: center; margin-top: 24px; font-size: 10px; color: #374151; }
      @media print { body { background: white; } .cert { border-color: #10b981; } h1 { color: #0077b6; } .hero-number { color: #059669; } .stat-value { color: #0077b6; } .owner-name, .content { color: #111827; } }
    </style>
  </head><body>
    <div class="cert"><div class="content">
      <h1>\u{1f30d} Carbon Offset Certificate</h1>
      <div class="subtitle">Powered by TeslaSync</div>
      <div class="hero">
        <div class="hero-number">${Math.round(
          co2SavedKg,
        ).toLocaleString()}</div>
        <div class="hero-unit">kg CO\u{2082} Avoided</div>
      </div>
      <div class="stats">
        <div class="stat"><div class="stat-value">${Math.round(
          data.totalKm,
        ).toLocaleString()}</div><div class="stat-label">km Driven Electric</div></div>
        <div class="stat"><div class="stat-value">${treesEquivalent}</div><div class="stat-label">Trees Equivalent</div></div>
        <div class="stat"><div class="stat-value">${gallonsSaved}</div><div class="stat-label">Gallons Saved</div></div>
      </div>
      <div class="stats">
        <div class="stat"><div class="stat-value">${Math.round(
          data.totalKwh,
        )}</div><div class="stat-label">kWh Clean Energy</div></div>
        <div class="stat"><div class="stat-value">${Math.round(
          gasEquivalentL,
        )}</div><div class="stat-label">Liters Gas Avoided</div></div>
        <div class="stat"><div class="stat-value">${
          data.vehicleName
        }</div><div class="stat-label">Vehicle</div></div>
      </div>
      <div class="owner">
        <div class="owner-name">${data.ownerName || 'TeslaSync User'}</div>
      </div>
      <div class="date">Generated on ${new Date().toLocaleDateString(
        undefined,
        {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        },
      )}</div>
      <div class="footer">This certificate is generated by TeslaSync based on actual driving data. Not an official carbon offset.</div>
    </div></div>
  </body></html>`;
}

/**
 * Native parity entry point for web's `generateCarbonCertificate`. Computes the
 * carbon stats, renders the certificate HTML, and hands it to a presenter.
 *
 * The default presenter reports an explicit unavailable state (no DOM print
 * pipeline in bare RN); pass a custom presenter to wire a WebView / print /
 * share transport. The computed stats and html are always returned so a native
 * screen can render them regardless of presentation availability.
 */
export function generateCarbonCertificate(
  data: CarbonCertificateData,
  present: CarbonCertificatePresenter = nativeUnavailablePresenter,
): CarbonCertificateResult {
  const stats = computeCarbonStats(data);
  const html = renderCarbonCertificateHtml(data);
  const presentation = present(html);
  return { stats, html, presentation };
}
