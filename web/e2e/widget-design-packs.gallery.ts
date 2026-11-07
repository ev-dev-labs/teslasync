import { writeFile } from 'node:fs/promises';
import { packNames } from './widget-design-packs.mock';
import type { PackId } from '../src/features/dashboard/widgets/designPacks/types';

export async function writePackReviewGallery(
  directory: string, widgets: readonly (readonly [string, string])[], captures: string[], includeStates = true,
) {
  const cards = widgets.map(([id, name]) => `<section><h2>${name}</h2><div class="comparison">
    <figure><figcaption>Classic</figcaption><a data-pack="classic" data-widget="${id}" target="_blank"><img data-pack="classic" data-widget="${id}" alt="Classic ${name}" loading="lazy"></a></figure>
    <figure><figcaption data-selected-name></figcaption><a data-pack="selected" data-widget="${id}" target="_blank"><img data-pack="selected" data-widget="${id}" alt="Selected ${name}" loading="lazy"></a></figure>
  </div></section>`).join('');
  const states = includeStates ? `<h2>Unknown and guarded states - Owner</h2><div class="states">
  ${['tire-pressure-visual', 'climate-status', 'security-status', 'command-quick-actions'].map(id => `<a href="unknown-${id}.png" target="_blank"><img src="unknown-${id}.png" alt="Unknown or guarded ${id}" loading="lazy"></a>`).join('')}
  </div><h2>Measured zero and partial observations - Owner and Pixel</h2><div class="states">
  ${['v4', 'v7'].flatMap(pack => ['battery-radial-gauge', 'regen-efficiency', 'battery-health-analytics', 'notification-stats'].map(id =>
    `<figure><figcaption>${packNames[pack as PackId]} - ${id}</figcaption><a href="partial-${pack}-${id}.png" target="_blank"><img src="partial-${pack}-${id}.png" alt="Partial ${id} in ${packNames[pack as PackId]}" loading="lazy"></a></figure>`)).join('')}
  </div><h2>Irregular signal history and explicit gaps - Pixel</h2><div class="states">
  ${['live-signals', 'live-signal-sparklines'].map(id =>
    `<a href="timed-${id}.png" target="_blank"><img src="timed-${id}.png" alt="Source-timed ${id} with gaps" loading="lazy"></a>`).join('')}
  </div>` : '';
  await writeFile(`${directory}index.html`, `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Widget implementation review</title><style>
  *{box-sizing:border-box}body{margin:0;background:#111827;color:#e5e7eb;font:16px/1.5 system-ui,sans-serif}
  header{position:sticky;top:0;z-index:1;background:#111827f5;border-bottom:1px solid #374151;padding:16px 24px}
  h1{font-size:22px;margin:0}p{margin:8px 0;color:#cbd5e1}label{display:inline-flex;gap:8px;align-items:center;margin:8px 20px 0 0}
  select{font:inherit;background:#1f2937;color:inherit;padding:8px;border:1px solid #64748b;border-radius:6px}
  main{max-width:1600px;margin:auto;padding:16px 24px}section{margin-bottom:40px}.comparison{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px;align-items:start}
  figure{margin:0;border:1px solid #374151;border-radius:12px;overflow:hidden}figcaption{padding:12px;background:#1f2937;font-weight:600}
  img{display:block;width:100%;height:auto}a{display:block}h2{font-size:20px}a:focus-visible,select:focus-visible{outline:3px solid #38bdf8}
  .states{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}.states img{max-width:600px}
  </style><header><h1>Widget implementation review</h1>
  <p>Actual React renders with synthetic data. ${widgets.length} implemented controllers; ${widgets.length === 132 && captures.length === 4224
    ? 'all 132 controllers are captured in this browser-review matrix; visual approval is still pending'
    : 'full 132-widget browser coverage is not complete'}. Existing vehicle imagery is preserved. This HTML is inert: no polling, SSE, storage writes or vehicle commands.</p>
  <label>Design<select id="pack">${Object.entries(packNames).filter(([id]) => id !== 'classic').map(([id, name]) => `<option value="${id}">${name}</option>`).join('')}</select></label>
  <label>Theme<select id="theme"><option>dark</option><option>light</option></select></label>
  <label>Viewport<select id="width"><option value="1440">Large - 1440px</option><option value="390">Small - 390px</option></select></label>
  <p>Click a screenshot to inspect its native resolution. Design approval is unchanged; this checkpoint checks implementation fidelity.</p></header>
  <main>${cards}${states}</main><script>
  function update(){const theme=document.getElementById('theme').value,width=document.getElementById('width').value,pack=document.getElementById('pack').value;
  document.querySelectorAll('[data-widget]').forEach(node=>{const selected=node.dataset.pack==='classic'?'classic':pack,file=theme+'-'+width+'-'+selected+'-'+node.dataset.widget+'.png';node[node.tagName==='IMG'?'src':'href']=file});
  document.querySelectorAll('[data-selected-name]').forEach(node=>{node.textContent=document.getElementById('pack').selectedOptions[0].textContent})}
  document.querySelectorAll('select').forEach(node=>node.addEventListener('change',update));update();
  </script></html>`);
  await writeFile(`${directory}captures.json`, JSON.stringify({
    captures, expected: widgets.length * 8 * 4 + (includeStates ? 14 : 0), actual: captures.length,
  }, null, 2));
}
