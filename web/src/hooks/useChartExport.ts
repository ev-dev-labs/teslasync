import { useRef, useCallback, useState } from 'react';

export function useChartExport(filename?: string) {
  const chartRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);

  const exportPNG = useCallback(async () => {
    if (!chartRef.current || exporting) return;
    setExporting(true);
    try {
      const { default: html2canvas } = await import('html2canvas-pro');
      const canvas = await html2canvas(chartRef.current, {
        backgroundColor: '#0a0a0f',
        scale: 2,
        useCORS: true,
        logging: false,
      });
      const link = document.createElement('a');
      link.download = `${filename ?? 'chart'}-${new Date().toISOString().slice(0, 10)}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch (err) {
      console.error('Chart export failed:', err);
    } finally {
      setExporting(false);
    }
  }, [filename, exporting]);

  return { chartRef, exportPNG, exporting };
}
