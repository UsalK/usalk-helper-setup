/**
 * apply-update.ps1 güvenlik testi.
 *
 * Sahte bir kurulum ve sahte bir güncelleme paketi hazırlar, betiği gerçekten
 * çalıştırır ve şunu doğrular: kod dosyaları güncellenir, kişisel dosyalar
 * (veritabanı, .env, storage, loglar) hiç değişmez — güncelleme paketi o
 * yollarda dosya içerse bile.
 *
 * Çalıştırma (proje kökünden):
 *   node backend/scripts/applyUpdate.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import fsp from 'fs/promises';
import os from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = join(PROJECT_ROOT, 'apply-update.ps1');

const write = async (root, rel, content) => {
  const target = join(root, rel);
  await fsp.mkdir(dirname(target), { recursive: true });
  await fsp.writeFile(target, content, 'utf8');
};

const read = (root, rel) => fs.readFileSync(join(root, rel), 'utf8');

test('güncelleme kodu değiştirir, kişisel dosyalara dokunmaz', async (t) => {
  if (process.platform !== 'win32') {
    t.skip('apply-update.ps1 yalnızca Windows üzerinde çalışır');
    return;
  }

  const sandbox = await fsp.mkdtemp(join(os.tmpdir(), 'usalk-update-test-'));
  const ready = join(sandbox, '.update-staging', 'ready');

  try {
    /* --- Kurulu sürüm: kod + kişisel dosyalar --- */
    await write(sandbox, 'package.json', '{"version":"2.0.0"}');
    await write(sandbox, 'backend/server.js', 'ESKI SUNUCU');
    await write(sandbox, 'backend/db/db.js', 'ESKI DB KODU');
    await write(sandbox, 'backend/db/schema.sql', 'ESKI SEMA');
    await write(sandbox, 'frontend/src/App.jsx', 'ESKI APP');
    await write(sandbox, 'backend/package-lock.json', '{"lock":1}');
    await write(sandbox, 'frontend/package-lock.json', '{"lock":1}');

    // Kişisel — hiçbiri değişmemeli
    await write(sandbox, 'backend/.env', 'ETSY_KEY=gizli-anahtar');
    await write(sandbox, 'backend/db/database.db', 'KULLANICI VERITABANI');
    await write(sandbox, 'backend/db/local-state/templates.json', '{"kisisel":true}');
    await write(sandbox, 'storage/usalkArtHouse/templates/sablon.png', 'GORSEL');
    await write(sandbox, 'logs/backend.out.log', 'LOG');
    await write(sandbox, 'backend/scratch/not.json', '{}');

    /* --- Güncelleme paketi --- */
    await write(ready, 'package.json', '{"version":"2.0.1"}');
    await write(ready, 'backend/server.js', 'YENI SUNUCU');
    await write(ready, 'backend/db/db.js', 'YENI DB KODU');
    await write(ready, 'backend/db/schema.sql', 'YENI SEMA');
    await write(ready, 'frontend/src/App.jsx', 'YENI APP');
    await write(ready, 'frontend/src/components/Yeni.jsx', 'YENI DOSYA');
    await write(ready, 'backend/package-lock.json', '{"lock":1}');
    await write(ready, 'frontend/package-lock.json', '{"lock":1}');

    // Pakete yanlışlıkla sızmış kişisel yollar — kullanıcınınki korunmalı
    await write(ready, 'backend/.env', 'ETSY_KEY=paketten-gelen');
    await write(ready, 'backend/db/database.db', 'PAKETTEN GELEN DB');
    await write(ready, 'storage/usalkArtHouse/templates/sablon.png', 'PAKETTEN GELEN GORSEL');

    /* --- Betiği çalıştır (durdurma/başlatma yok) --- */
    const { stdout } = await execFileAsync('powershell.exe', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT,
      '-ProjectRoot', sandbox, '-ParentPid', '0'
    ], { maxBuffer: 8 * 1024 * 1024 });

    assert.match(stdout, /Guncelleme tamamlandi/, 'betik başarıyla bitmeli');

    /* --- Kod güncellendi mi? --- */
    assert.equal(read(sandbox, 'backend/server.js'), 'YENI SUNUCU');
    assert.equal(read(sandbox, 'frontend/src/App.jsx'), 'YENI APP');
    assert.equal(read(sandbox, 'frontend/src/components/Yeni.jsx'), 'YENI DOSYA',
      'yeni eklenen dosya kuruluma gelmeli');
    assert.equal(JSON.parse(read(sandbox, 'package.json')).version, '2.0.1');

    // backend/db korunuyor ama bu ikisi uygulama kodu
    assert.equal(read(sandbox, 'backend/db/db.js'), 'YENI DB KODU');
    assert.equal(read(sandbox, 'backend/db/schema.sql'), 'YENI SEMA');

    /* --- Kişisel dosyalar el değmemiş mi? --- */
    assert.equal(read(sandbox, 'backend/.env'), 'ETSY_KEY=gizli-anahtar',
      '.env asla ezilmemeli');
    assert.equal(read(sandbox, 'backend/db/database.db'), 'KULLANICI VERITABANI',
      'veritabanı asla ezilmemeli');
    assert.equal(read(sandbox, 'backend/db/local-state/templates.json'), '{"kisisel":true}');
    assert.equal(read(sandbox, 'storage/usalkArtHouse/templates/sablon.png'), 'GORSEL',
      'storage asla ezilmemeli');
    assert.equal(read(sandbox, 'logs/backend.out.log'), 'LOG');
    assert.equal(read(sandbox, 'backend/scratch/not.json'), '{}');

    /* --- Geri dönüş için yedek alınmış mı? --- */
    const staging = join(sandbox, '.update-staging');
    const backups = (await fsp.readdir(staging)).filter(n => n.startsWith('backup-'));
    assert.equal(backups.length, 1, 'tek bir yedek klasörü oluşmalı');
    assert.equal(read(join(staging, backups[0]), 'backend/server.js'), 'ESKI SUNUCU',
      'değişen dosyanın eski hali yedeklenmeli');
  } finally {
    await fsp.rm(sandbox, { recursive: true, force: true });
  }
});
