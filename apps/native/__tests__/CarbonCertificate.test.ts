import {
  computeCarbonStats,
  generateCarbonCertificate,
  nativeUnavailablePresenter,
  renderCarbonCertificateHtml,
  type CarbonCertificatePresenter,
} from '../src/web-parity/lib/certificate';

const baseData = {
  vehicleName: 'Model Y',
  totalKm: 10000,
  totalKwh: 2000,
};

describe('web-parity certificate (carbon offset)', () => {
  it('computes carbon stats with the web formulas', () => {
    // 10000 km => (10000/100)*8 = 800 L gas => 800*2.31 = 1848 kg CO2
    // trees = round(1848/22) = 84 ; gallons = round(800*0.264172) = 211
    expect(computeCarbonStats(baseData)).toEqual({
      gasEquivalentL: 800,
      co2SavedKg: 1848,
      treesEquivalent: 84,
      gallonsSaved: 211,
    });
  });

  it('renders the certificate heading and TeslaSync branding', () => {
    const html = renderCarbonCertificateHtml(baseData);
    expect(html).toContain('Carbon Offset Certificate');
    expect(html).toContain('Powered by TeslaSync');
  });

  it('embeds the computed values and vehicle name in the html', () => {
    const html = renderCarbonCertificateHtml(baseData);
    expect(html).toContain('Model Y');
    // toLocaleString output is engine/locale dependent — compare to the same call.
    expect(html).toContain((1848).toLocaleString());
    expect(html).toContain((10000).toLocaleString());
    expect(html).toContain('84'); // trees (plain number, no locale grouping)
    expect(html).toContain('211'); // gallons (plain number)
    expect(html).toContain('2000'); // kWh (Math.round, no locale grouping)
  });

  it('shows the owner name when provided', () => {
    expect(
      renderCarbonCertificateHtml({ ...baseData, ownerName: 'Alice' }),
    ).toContain('Alice');
  });

  it('falls back to "TeslaSync User" when no owner name (|| semantics)', () => {
    expect(renderCarbonCertificateHtml(baseData)).toContain('TeslaSync User');
    // Empty string must also fall back, matching the web `||` (not `??`).
    expect(
      renderCarbonCertificateHtml({ ...baseData, ownerName: '' }),
    ).toContain('TeslaSync User');
  });

  it('reports an explicit unavailable presentation by default (popup-blocked parity)', () => {
    const result = generateCarbonCertificate(baseData);
    expect(result.presentation).toEqual({
      presented: false,
      reason: 'unavailable',
    });
    expect(result.stats).toEqual(computeCarbonStats(baseData));
    expect(result.html).toBe(renderCarbonCertificateHtml(baseData));
  });

  it('routes the rendered html through a custom presenter', () => {
    let captured = '';
    const presenter: CarbonCertificatePresenter = html => {
      captured = html;
      return { presented: true };
    };

    const result = generateCarbonCertificate(baseData, presenter);
    expect(captured).toContain('Carbon Offset Certificate');
    expect(captured).toBe(result.html);
    expect(result.presentation).toEqual({ presented: true });
  });

  it('default presenter ignores html and stays unavailable', () => {
    expect(nativeUnavailablePresenter('<anything>')).toEqual({
      presented: false,
      reason: 'unavailable',
    });
  });
});
