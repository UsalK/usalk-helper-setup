import { spawn } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import { join, basename, extname, dirname } from 'path';
import { getActiveShop, getShopStorageName } from '../db/db.js';
import { PROJECT_ROOT } from './OrderSources.js';

/**
 * Siparişteki kaynak görseli büyütür.
 *
 * Motor değiştirilebilir (UPSCALE_ENGINE). Her motor yalnızca "hangi komut
 * çalışacak" ve "ilerleme satırı nasıl okunur" sorularını cevaplar; çıktı dosyası
 * motorun verdiği addan bağımsız olarak iş bitince standart ada taşınır:
 *   storage/etsy/<Mağaza>/upscaled/<kaynak>-upscale-<N>x.png
 * ("upscaled" Depolama Temizliği'nin korumalı klasörlerinden; bkz. routes/storage.js)
 *
 * GPU tek olduğu için işler sırayla çalışır. Her iş kendi geçici klasörüne yazar;
 * yalnızca başarıyla biterse çıktı yerine taşınır, yarım dosya "hazır" görünmez.
 * Çıktı Explorer'dan silinirse durum kendiliğinden "yok"a döner (her sorguda diske bakılır).
 */
export const SCALE = Number(process.env.UPSCALE_SCALE) || 6;

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.tif', '.tiff']);

const ENGINES = {
  // Real-ESRGAN tabanlı upscale.py: damalı desen filtresi -> 4xNomos2_hq_atd -> keskinleştirme -> N x
  realesrgan: {
    label: 'Real-ESRGAN (4xNomos2 hq atd)',
    configured: () => Boolean(process.env.UPSCALE_SCRIPT) && fs.existsSync(process.env.UPSCALE_SCRIPT),
    command: ({ input, outDir, scale }) => ({
      bin: process.env.UPSCALE_PYTHON || 'python',
      args: [process.env.UPSCALE_SCRIPT, input, '--scale', String(scale), '--out-dir', outDir, '--progress']
    }),
    progress: (line) => {
      const m = /^PROGRESS (\d+) (\S+)/.exec(line);
      return m ? { pct: Number(m[1]), stage: m[2] } : null;
    }
  },

  // Genel komut satırı motoru (ör. lisanslı Topaz tpai.exe). Şablon .env'de:
  //   UPSCALE_COMMAND="C:\...\tool.exe" "{input}" --scale {scale} --output "{outdir}"
  // Çıktı {outdir} klasörüne hangi adla yazılırsa yazılsın bulunur. İlerleme için
  // satırdaki ilk "%NN" / "NN%" okunur; yoksa çubuk belirsiz ilerler.
  command: {
    label: process.env.UPSCALE_ENGINE_LABEL || 'Özel komut',
    configured: () => Boolean(process.env.UPSCALE_COMMAND),
    command: ({ input, outDir, scale }) => ({
      shellLine: process.env.UPSCALE_COMMAND
        .replaceAll('{input}', input)
        .replaceAll('{outdir}', outDir)
        .replaceAll('{scale}', String(scale))
    }),
    progress: (line) => {
      const m = /(\d{1,3})\s*%|%\s*(\d{1,3})/.exec(line);
      return m ? { pct: Math.min(99, Number(m[1] || m[2])), stage: 'upscale' } : null;
    }
  }
};

const engineId = () => (ENGINES[process.env.UPSCALE_ENGINE] ? process.env.UPSCALE_ENGINE : 'realesrgan');
const engine = () => ENGINES[engineId()];

export function engineInfo() {
  return { engine: engineId(), engine_label: engine().label, enabled: engine().configured(), scale: SCALE };
}

export function isConfigured() {
  return engine().configured();
}

export function outputDirFor(shopId) {
  return join(PROJECT_ROOT, 'storage', 'etsy', getShopStorageName(shopId || getActiveShop().shop_id), 'upscaled');
}

export function outputPathFor(sourceAbs, shopId) {
  return join(outputDirFor(shopId), `${basename(sourceAbs, extname(sourceAbs))}-upscale-${SCALE}x.png`);
}

const jobs = new Map(); // çıktı dosya yolu -> iş (aynı ürün iki mağazada ayrı çıktı alır)
const queue = [];
let running = null;

function view(job) {
  return {
    status: job.status,           // queued | running | done | error
    progress: job.progress,
    stage: job.stage,
    error: job.error,
    output_name: basename(job.output),
    engine_label: job.engineLabel,
    elapsed_ms: job.startedAt ? (job.finishedAt || Date.now()) - job.startedAt : 0
  };
}

export function getJob(sourceAbs, shopId) {
  const output = outputPathFor(sourceAbs, shopId);
  const job = jobs.get(output);
  if (job && job.status !== 'done') return view(job);
  // "done" her sorguda diskten doğrulanır: dosya elle silindiyse iş yok sayılır.
  if (fs.existsSync(output)) {
    return { status: 'done', progress: 100, stage: 'bitti', error: null, output_name: basename(output), engine_label: job?.engineLabel || null, elapsed_ms: job ? view(job).elapsed_ms : 0 };
  }
  return { status: 'idle', progress: 0, stage: null, error: null, output_name: basename(output), engine_label: null, elapsed_ms: 0 };
}

/** force: çıktı zaten varsa da yeniden üret (eskisi yenisi hazır olunca değiştirilir). */
export function startJob(sourceAbs, shopId, { force = false } = {}) {
  const current = getJob(sourceAbs, shopId);
  if (current.status === 'queued' || current.status === 'running') return current;
  if (current.status === 'done' && !force) return current;

  const job = {
    id: crypto.randomBytes(6).toString('hex'),
    source: sourceAbs,
    output: outputPathFor(sourceAbs, shopId),
    engineLabel: engine().label,
    status: 'queued', progress: 0, stage: 'sırada', error: null,
    startedAt: null, finishedAt: null
  };
  jobs.set(job.output, job);
  queue.push(job);
  pump();
  return view(job);
}

function newestImage(dir) {
  const files = fs.readdirSync(dir)
    .filter(f => IMAGE_EXT.has(extname(f).toLowerCase()))
    .map(f => ({ f, t: fs.statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  return files[0] ? join(dir, files[0].f) : null;
}

function pump() {
  if (running || queue.length === 0) return;
  const job = queue.shift();
  running = job;
  job.status = 'running';
  job.stage = 'başlatılıyor';
  job.progress = 1;
  job.startedAt = Date.now();

  const eng = engine();
  const tmpDir = join(dirname(job.output), '.tmp', job.id);
  let stderrTail = '';
  let settled = false;

  const finish = (err) => {
    if (settled) return;
    settled = true;
    job.finishedAt = Date.now();
    try {
      if (!err) {
        const produced = newestImage(tmpDir);
        if (!produced) throw new Error('Motor çıktı dosyası üretmedi.');
        fs.mkdirSync(dirname(job.output), { recursive: true });
        fs.rmSync(job.output, { force: true });        // "yine de upscale et": eskisini değiştir
        fs.renameSync(produced, job.output);
        job.status = 'done';
        job.progress = 100;
        job.stage = 'bitti';
        console.log(`[Upscale] Hazır (${eng.label}): ${basename(job.output)} (${Math.round((job.finishedAt - job.startedAt) / 1000)} sn)`);
      }
    } catch (e) {
      err = e.message;
    }
    if (err) {
      job.status = 'error';
      job.error = err;
      console.error(`[Upscale] Hata (${basename(job.source)}): ${err}`);
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
    running = null;
    pump();
  };

  let child;
  try {
    fs.mkdirSync(tmpDir, { recursive: true });
    const cmd = eng.command({ input: job.source, outDir: tmpDir, scale: SCALE });
    const opts = { windowsHide: true, env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' } };
    child = cmd.shellLine ? spawn(cmd.shellLine, { ...opts, shell: true }) : spawn(cmd.bin, cmd.args, opts);
  } catch (e) {
    return finish(`Motor başlatılamadı: ${e.message}`);
  }

  let buf = '';
  const onLine = (line) => {
    const p = eng.progress(line);
    if (p) {
      job.progress = Math.max(job.progress, p.pct);
      job.stage = p.stage;
    }
  };
  child.stdout.on('data', (chunk) => {
    buf += chunk.toString();
    const lines = buf.split(/\r?\n|\r/);
    buf = lines.pop();
    lines.forEach(onLine);
  });
  child.stderr.on('data', (chunk) => { stderrTail = (stderrTail + chunk.toString()).slice(-4000); });
  child.on('error', (e) => finish(`Motor başlatılamadı (${eng.label}): ${e.message}`));
  child.on('close', (code) => {
    if (code === 0) return finish(null);
    // Anlamlı son satırı göster (torch uyarılarını atla)
    const last = stderrTail.split(/\r?\n/).filter(l => l.trim() && !/warn/i.test(l)).pop();
    finish(last || `upscale motoru ${code} koduyla çıktı`);
  });
}
