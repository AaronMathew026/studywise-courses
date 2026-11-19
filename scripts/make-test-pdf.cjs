// Builds tests/fixtures/photoelectric-lecture.pdf: 12 pages with tables and
// diagrams drawn as raster images (their labels exist only inside the images).
const { app, BrowserWindow } = require('electron')
const { writeFileSync, mkdirSync } = require('node:fs')
const { join } = require('node:path')

const pages = [
  ['The photoelectric effect', '<p>When light shines on a clean metal surface, electrons can be emitted. These are called <b>photoelectrons</b>. Hertz first noticed the effect in 1887 and Einstein explained it in 1905 using photons.</p><p>Key observation: emission only happens if the frequency of the light is above a minimum value, the <b>threshold frequency</b> f₀, which depends on the metal.</p>'],
  ['Photons', '<p>Light is made of packets of energy called photons. The energy of one photon is <b>E = hf</b>, where h is the Planck constant (6.63 × 10⁻³⁴ J s) and f is the frequency in Hz.</p><p>Equivalently E = hc/λ, where c = 3.00 × 10⁸ m s⁻¹.</p>'],
  ['Work function', '<p>The <b>work function φ</b> is the minimum energy needed to remove an electron from the surface of a metal. Typical values:</p><table><tr><th>Metal</th><th>φ / eV</th><th>Threshold f₀ / 10¹⁴ Hz</th></tr><tr><td>Caesium</td><td>2.1</td><td>5.1</td></tr><tr><td>Sodium</td><td>2.3</td><td>5.6</td></tr><tr><td>Zinc</td><td>4.3</td><td>10.4</td></tr><tr><td>Platinum</td><td>6.4</td><td>15.5</td></tr></table>'],
  ['Einstein\'s equation', '<p>Energy is conserved when one photon is absorbed by one electron:</p><p style="font-size:22px"><b>hf = φ + E<sub>k(max)</sub></b></p><p>E<sub>k(max)</sub> is the maximum kinetic energy of the emitted electrons. Electrons deeper in the metal need more energy to escape, so most have less than the maximum.</p>'],
  ['Graph: E<sub>k(max)</sub> against frequency', '<p>The graph below summarises the experiment. Read the labels carefully.</p>{{GRAPH}}'],
  ['Why intensity does not matter', '<ul><li>one photon is absorbed by one electron</li><li>a higher intensity means more photons per second, not more energetic photons</li><li>so increasing intensity increases the <b>number</b> of photoelectrons per second, not their maximum kinetic energy</li><li>below f₀ no electrons are emitted, however intense the light</li></ul>'],
  ['The stopping potential experiment', '<p>The apparatus is shown below.</p>{{APPARATUS}}<p>The potential is increased until the current just drops to zero. Then eV<sub>s</sub> = E<sub>k(max)</sub>.</p>'],
  ['The electronvolt', '<p>1 eV is the energy gained by an electron accelerated through a potential difference of 1 V.</p><p><b>1 eV = 1.60 × 10⁻¹⁹ J</b></p><table><tr><th>Convert</th><th>Do this</th></tr><tr><td>eV → J</td><td>multiply by 1.60 × 10⁻¹⁹</td></tr><tr><td>J → eV</td><td>divide by 1.60 × 10⁻¹⁹</td></tr></table>'],
  ['Worked example', '<p>Light of frequency 8.0 × 10¹⁴ Hz falls on sodium (φ = 2.3 eV).</p><ol><li>photon energy: hf = 6.63 × 10⁻³⁴ × 8.0 × 10¹⁴ = 5.3 × 10⁻¹⁹ J = 3.3 eV</li><li>E<sub>k(max)</sub> = 3.3 − 2.3 = 1.0 eV</li><li>stopping potential V<sub>s</sub> = 1.0 V</li></ol>'],
  ['Evidence for the particle model', '<table><tr><th>Observation</th><th>Wave model predicts</th><th>Photon model predicts</th></tr><tr><td>threshold frequency</td><td>no threshold</td><td>threshold exists</td></tr><tr><td>emission time</td><td>delay at low intensity</td><td>instantaneous</td></tr><tr><td>E<sub>k(max)</sub> vs intensity</td><td>increases</td><td>independent</td></tr></table>'],
  ['Energy levels (preview)', '<p>Electrons in atoms can only have certain discrete energies. The diagram shows the lowest levels of hydrogen.</p>{{LEVELS}}'],
  ['Summary', '<ul><li>E = hf</li><li>hf = φ + E<sub>k(max)</sub></li><li>threshold frequency f₀ = φ / h</li><li>intensity changes the number of electrons, frequency changes their energy</li></ul>']
]

function canvasScript() {
  return `
  function draw(id, fn){ const c=document.getElementById(id); const g=c.getContext('2d'); g.fillStyle='#fff'; g.fillRect(0,0,c.width,c.height); g.fillStyle='#111'; g.strokeStyle='#111'; g.lineWidth=3; g.font='22px Helvetica'; fn(g,c); const img=new Image(); img.src=c.toDataURL('image/png'); img.style.width=c.width/2+'px'; c.replaceWith(img) }
  draw('graph',(g)=>{ g.beginPath(); g.moveTo(80,40); g.lineTo(80,360); g.lineTo(640,360); g.stroke();
    g.fillText('E k(max) / eV',10,30); g.fillText('frequency f / 10^14 Hz',420,400);
    g.strokeStyle='#2346d4'; g.beginPath(); g.moveTo(260,360); g.lineTo(620,80); g.stroke();
    g.setLineDash([8,8]); g.strokeStyle='#999'; g.beginPath(); g.moveTo(260,360); g.lineTo(80,500); g.stroke(); g.setLineDash([]);
    g.fillStyle='#d1373f'; g.fillText('f0 = threshold frequency',190,345); g.fillStyle='#111'; g.fillText('gradient = h (Planck constant)',380,150);
    g.fillText('y-intercept = -phi (work function)',90,480) });
  draw('apparatus',(g)=>{ g.strokeRect(80,80,160,200); g.fillText('vacuum tube',95,70); g.fillText('photocell',100,190);
    g.beginPath(); g.moveTo(240,180); g.lineTo(460,180); g.stroke(); g.strokeRect(460,140,90,80); g.fillText('microammeter',430,250);
    g.beginPath(); g.arc(320,330,40,0,7); g.stroke(); g.fillText('variable voltage supply (reverse bias)',200,400);
    g.fillStyle='#b25e09'; for(let i=0;i<3;i++){ g.beginPath(); g.moveTo(10+i*20,10); g.lineTo(120+i*20,140); g.stroke() } g.fillText('UV light',10,160) });
  draw('levels',(g)=>{ const L=[['n=1  -13.6 eV',400],['n=2  -3.40 eV',220],['n=3  -1.51 eV',150],['n=4  -0.85 eV',110],['n=inf  0 eV',60]];
    for(const [t,y] of L){ g.beginPath(); g.moveTo(120,y); g.lineTo(520,y); g.stroke(); g.fillText(t,540,y+8) }
    g.strokeStyle='#2346d4'; g.beginPath(); g.moveTo(250,220); g.lineTo(250,400); g.stroke(); g.fillText('photon emitted: 10.2 eV',260,320) });
  `
}

app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  const body = pages
    .map(([h, b], i) => `<section><h1>${h}</h1>${b
      .replace('{{GRAPH}}', '<canvas id="graph" width="700" height="520"></canvas>')
      .replace('{{APPARATUS}}', '<canvas id="apparatus" width="700" height="430"></canvas>')
      .replace('{{LEVELS}}', '<canvas id="levels" width="760" height="440"></canvas>')}<footer>PHYS201 · Week 4 · page ${i + 1}</footer></section>`)
    .join('')
  const html = `<html><head><style>body{font-family:Helvetica;margin:0} section{height:250mm;padding:18mm;box-sizing:border-box;page-break-after:always;position:relative} h1{font-size:26px} p,li,td,th{font-size:15px;line-height:1.5} table{border-collapse:collapse;margin-top:10px} td,th{border:1px solid #444;padding:6px 10px} footer{position:absolute;bottom:12mm;font-size:11px;color:#777}</style></head><body>${body}<script>${canvasScript()}</script></body></html>`
  const win = new BrowserWindow({ show: false })
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
  await new Promise((r) => setTimeout(r, 500))
  const pdf = await win.webContents.printToPDF({ pageSize: 'A4', printBackground: true })
  mkdirSync(join(__dirname, '../tests/fixtures'), { recursive: true })
  writeFileSync(join(__dirname, '../tests/fixtures/photoelectric-lecture.pdf'), pdf)
  console.log('wrote tests/fixtures/photoelectric-lecture.pdf', pdf.length, 'bytes')
  app.quit()
})
