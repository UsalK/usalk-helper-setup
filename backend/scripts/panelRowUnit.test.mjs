/**
 * pickPanelRow birim testi.
 *
 * Set sablonlarinda yan yana duran panel serisinin, alakasiz adaylarin
 * arasindan dogru secildigini ve hizasiz/farkli boyutlu/ust uste binen
 * adaylarin seri sayilmadigini dogrular.
 *
 * Kullanim (backend/ icinden):  node scripts/panelRowUnit.test.mjs
 */
import { join, resolve, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { pickPanelRow } = await import(
  pathToFileURL(join(ROOT, 'frontend/src/utils/panelRow.js')).href
);

const q = (x0,y0,x1,y1,score=5) => ({ score, corners:{ tl:{x:x0,y:y0}, tr:{x:x1,y:y0}, br:{x:x1,y:y1}, bl:{x:x0,y:y1} } });
const cx = p => (p.corners.tl.x + p.corners.tr.x)/2;

const t = (ad, adaylar, sayi, beklenen) => {
  const r = pickPanelRow(adaylar, sayi);
  const got = r ? r.panels.map(p=>cx(p).toFixed(2)).join(',') : 'YOK';
  const ok = got === beklenen;
  console.log((ok?'  ✓ ':'  ✗ ') + ad.padEnd(46) + ' -> ' + got + (ok?'':'  (beklenen: '+beklenen+')'));
  return ok;
};

let pass=0, total=0;
const run=(...a)=>{ total++; if(t(...a)) pass++; };

// 2'li: yan yana iki panel + alakasiz buyuk bir alan
run('2 panel + alakasiz aday',
  [ q(0.55,0.30,0.75,0.70), q(0.25,0.30,0.45,0.70), q(0.05,0.05,0.95,0.95,9) ], 2, '0.35,0.65');

// 3'lu: esit araliklarla uc panel + gurultu
run('3 panel esit aralik',
  [ q(0.62,0.30,0.78,0.70), q(0.12,0.30,0.28,0.70), q(0.37,0.30,0.53,0.70), q(0.10,0.80,0.30,0.95) ], 3, '0.20,0.45,0.70');

// Dikey hizasi bozuk olan seri secilmemeli
run('hizasiz aday elenir',
  [ q(0.25,0.30,0.45,0.70), q(0.55,0.55,0.75,0.95), q(0.55,0.30,0.75,0.70) ], 2, '0.35,0.65');

// Boyutu cok farkli olan seri secilmemeli
run('boyut farki elenir',
  [ q(0.25,0.30,0.45,0.70), q(0.55,0.40,0.62,0.60), q(0.55,0.30,0.75,0.70) ], 2, '0.35,0.65');

// Ust uste binen ikili seri sayilmaz
run('ust uste binenler seri degil',
  [ q(0.25,0.30,0.55,0.70), q(0.30,0.30,0.60,0.70) ], 2, 'YOK');

// Yetersiz aday
run('aday yetersiz', [ q(0.25,0.30,0.45,0.70) ], 2, 'YOK');

console.log(`\n${pass}/${total} gecti`);
process.exit(pass===total?0:1);
