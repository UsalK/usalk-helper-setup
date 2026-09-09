/**
 * Güncelleme indirme ve hazırlama.
 *
 * Akış iki parçaya ayrılmıştır çünkü çalışan uygulama kendi dosyalarının
 * üzerine Windows'ta güvenilir biçimde yazamaz:
 *
 *   1. Bu servis yeni sürümü indirir, açar ve doğrular (`.update-staging/`).
 *   2. `apply-update.ps1` uygulamayı durdurur, dosyaları kopyalar ve yeniden
 *      başlatır. Kişisel yolları hiç ellemez.
 *
 * Hazırlama adımı geri alınabilir: doğrulama başarısız olursa hiçbir şey
 * kopyalanmaz, kurulu sürüm olduğu gibi kalır.
 */

import fs from 'fs';
import fsp from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn, execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = join(__dirname, '../..');

const STAGING_DIR = join(PROJECT_ROOT, '.update-staging');

/**
 * Güncellemenin ASLA dokunmayacağı yollar.
 *
 * Kopyalama bu listeyi atlar; ayrıca yeni sürüm bu yolları içeriyorsa bile
 * (yanlışlıkla depoya girmiş olabilir) kullanıcının dosyası korunur.
 */
export const PROTECTED_PATHS = [
  'backend/.env',
  'backend/db',            // database.db, -wal, -shm, local-state/, agent-seo/
  'storage',
  'backups',
  'logs',
  'backend/scratch',
  'node_modules',
  'backend/node_modules',
  'frontend/node_modules',
  '.update-staging',
  '.git'
];

/**
 * `backend/db` tamamen korunuyor ama içindeki uygulama kodu güncellenmeli.
 * Bu iki dosya kişisel veri değil, şema ve erişim katmanı.
 */
export const DB_CODE_FILES = ['backend/db/db.js', 'backend/db/schema.sql'];

const isWindows = process.platform === 'win32';

function readVersionFrom(root) {
  try {
    return JSON.parse(fs.readFileSync(join(root, 'package.json'), 'utf8')).version || null;
  } catch {
    return null;
  }
}

export function currentVersion() {
  return readVersionFrom(PROJECT_ROOT) || '0.0.0';
}

/** Depodaki etiketin zip arşivini indirir. */
async function downloadZip(repo, tag, destFile) {
  const url = `https://api.github.com/repos/${repo}/zipball/${encodeURIComponent(tag)}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'usalk-helper', 'Accept': 'application/vnd.github+json' },
    redirect: 'follow'
  });
  if (!res.ok) throw new Error(`Arşiv indirilemedi (HTTP ${res.status}).`);

  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length < 1024) throw new Error('İndirilen arşiv beklenenden küçük.');
  await fsp.writeFile(destFile, buffer);
  return buffer.length;
}

/** Zip'i açar. Windows'ta Expand-Archive, diğer sistemlerde `unzip`. */
async function extractZip(zipFile, destDir) {
  await fsp.mkdir(destDir, { recursive: true });
  if (isWindows) {
    await execFileAsync('powershell.exe', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
      `Expand-Archive -LiteralPath '${zipFile}' -DestinationPath '${destDir}' -Force`
    ], { maxBuffer: 32 * 1024 * 1024 });
  } else {
    await execFileAsync('unzip', ['-q', '-o', zipFile, '-d', destDir]);
  }

  // GitHub arşivi tek bir üst klasör içerir: <sahip>-<repo>-<sha>/
  const entries = await fsp.readdir(destDir, { withFileTypes: true });
  const dirs = entries.filter(e => e.isDirectory());
  if (dirs.length !== 1) {
    throw new Error(`Arşiv yapısı beklenmedik (${dirs.length} klasör).`);
  }
  return join(destDir, dirs[0].name);
}

/**
 * Açılan ağacın gerçekten bu uygulama olduğunu ve beklenen sürümü taşıdığını
 * doğrular. Yanlış veya bozuk bir arşivin kuruluma kopyalanmasını engeller.
 */
async function verifyPayload(root, expectedVersion) {
  const required = ['package.json', 'backend/package.json', 'frontend/package.json', 'backend/server.js'];
  for (const rel of required) {
    if (!fs.existsSync(join(root, rel))) {
      throw new Error(`Arşivde ${rel} yok; güncelleme paketi geçersiz.`);
    }
  }

  const version = readVersionFrom(root);
  if (!version) throw new Error('Arşivdeki package.json sürüm içermiyor.');

  const norm = (v) => String(v).replace(/^v/i, '');
  if (expectedVersion && norm(version) !== norm(expectedVersion)) {
    throw new Error(
      `Arşivdeki sürüm (${version}) beklenen sürümle (${expectedVersion}) uyuşmuyor.`
    );
  }
  return version;
}

/**
 * Yeni sürümü indirir, açar, doğrular ve uygulanmaya hazır hale getirir.
 * Kuruluma hiçbir şey yazmaz.
 *
 * @returns {Promise<{version: string, stagedAt: string, bytes: number}>}
 */
export async function stageUpdate({ repo, tag, expectedVersion }) {
  await fsp.rm(STAGING_DIR, { recursive: true, force: true });
  await fsp.mkdir(STAGING_DIR, { recursive: true });

  const zipFile = join(STAGING_DIR, 'update.zip');
  const bytes = await downloadZip(repo, tag, zipFile);

  const extractRoot = join(STAGING_DIR, 'extract');
  const payloadRoot = await extractZip(zipFile, extractRoot);
  const version = await verifyPayload(payloadRoot, expectedVersion);

  // Uygulanacak ağacı sabit bir konuma taşı; PowerShell betiği burayı okur.
  const readyDir = join(STAGING_DIR, 'ready');
  await fsp.rm(readyDir, { recursive: true, force: true });
  await fsp.rename(payloadRoot, readyDir);
  await fsp.rm(zipFile, { force: true });
  await fsp.rm(extractRoot, { recursive: true, force: true });

  const meta = {
    version,
    tag,
    repo,
    stagedAt: new Date().toISOString(),
    from: currentVersion()
  };
  await fsp.writeFile(join(STAGING_DIR, 'staged.json'), JSON.stringify(meta, null, 2));

  return { ...meta, bytes };
}

/** Hazırlanmış bir güncelleme var mı? */
export function readStaged() {
  try {
    const meta = JSON.parse(fs.readFileSync(join(STAGING_DIR, 'staged.json'), 'utf8'));
    if (!fs.existsSync(join(STAGING_DIR, 'ready', 'package.json'))) return null;
    return meta;
  } catch {
    return null;
  }
}

export async function discardStaged() {
  await fsp.rm(STAGING_DIR, { recursive: true, force: true });
}

/**
 * Hazırlanan güncellemeyi uygulayacak betiği ayrı bir süreçte başlatır.
 * Betik uygulamayı durduracağı için bu çağrı döndükten kısa süre sonra
 * sunucu kapanır.
 */
export function launchApply({ restart = true } = {}) {
  if (!isWindows) {
    throw new Error('Otomatik güncelleme şu an yalnızca Windows üzerinde destekleniyor.');
  }
  const script = join(PROJECT_ROOT, 'apply-update.ps1');
  if (!fs.existsSync(script)) {
    throw new Error('apply-update.ps1 bulunamadı.');
  }

  const child = spawn('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
    '-File', script,
    '-ProjectRoot', PROJECT_ROOT,
    '-ParentPid', String(process.pid),
    ...(restart ? ['-Restart'] : [])
  ], { detached: true, stdio: 'ignore' });

  child.unref();
  return true;
}
