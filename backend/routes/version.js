/**
 * Sürüm bilgisi ve güncelleme kontrolü.
 *
 * Kurulu sürümün tek kaynağı kökteki package.json'dur. Güncelleme kontrolü
 * GitHub'daki yayın (release) etiketlerine bakar; ağ yoksa veya GitHub'a
 * ulaşılamıyorsa uygulama çalışmaya devam eder, yalnızca kontrol başarısız olur.
 */

import express from 'express';
import fs from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { stageUpdate, readStaged, discardStaged, launchApply } from '../services/UpdateService.js';

const router = express.Router();
const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '../..');

/** Güncellemelerin alınacağı depo. */
const REPO = process.env.UPDATE_REPO || 'UsalK/usalk-helper-setup';

/** GitHub API sınırı saatte 60 istek; sonucu bir süre elde tutuyoruz. */
const CHECK_CACHE_MS = 15 * 60 * 1000;
let checkCache = null; // { at, payload }

function readCurrentVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(join(PROJECT_ROOT, 'package.json'), 'utf8'));
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/**
 * Sürüm etiketini sayılara ayırır. 'v2.1.0', '2.1', '2.0.1' hepsi kabul edilir.
 * Ön sürüm ekleri (2.1.0-beta.1) karşılaştırmada yok sayılır.
 */
function parseVersion(raw) {
  const cleaned = String(raw || '').trim().replace(/^v/i, '').split(/[-+]/)[0];
  const parts = cleaned.split('.').map(n => parseInt(n, 10));
  if (!parts.length || parts.some(n => !Number.isFinite(n))) return null;
  while (parts.length < 3) parts.push(0);
  return parts.slice(0, 3);
}

/** a > b ise pozitif, eşitse 0, küçükse negatif. */
function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

async function fetchJson(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'usalk-helper'
      }
    });
    if (!res.ok) {
      const err = new Error(`GitHub ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** En son yayımlanmış sürümü bulur: önce release, yoksa etiket listesi. */
async function fetchLatest() {
  try {
    const release = await fetchJson(`https://api.github.com/repos/${REPO}/releases/latest`);
    return {
      version: release.tag_name,
      notes: release.body || '',
      url: release.html_url,
      publishedAt: release.published_at,
      source: 'release'
    };
  } catch (err) {
    // Henüz release yoksa GitHub 404 döner; etiketlere düşülür.
    if (err.status && err.status !== 404) throw err;
  }

  const tags = await fetchJson(`https://api.github.com/repos/${REPO}/tags?per_page=50`);
  if (!Array.isArray(tags) || tags.length === 0) return null;

  const newest = tags
    .filter(t => parseVersion(t.name))
    .sort((a, b) => compareVersions(b.name, a.name))[0];
  if (!newest) return null;

  return {
    version: newest.name,
    notes: '',
    url: `https://github.com/${REPO}/releases/tag/${newest.name}`,
    publishedAt: null,
    source: 'tag'
  };
}

/** Kurulu sürüm. */
router.get('/', (req, res) => {
  res.json({ version: readCurrentVersion(), repo: REPO });
});

/** Güncelleme kontrolü. ?force=1 önbelleği atlar. */
router.get('/check', async (req, res) => {
  const current = readCurrentVersion();
  const force = req.query.force === '1';

  if (!force && checkCache && Date.now() - checkCache.at < CHECK_CACHE_MS) {
    return res.json({ ...checkCache.payload, current, cached: true });
  }

  try {
    const latest = await fetchLatest();
    const payload = latest
      ? {
          ok: true,
          latest: latest.version,
          updateAvailable: compareVersions(latest.version, current) > 0,
          notes: latest.notes,
          url: latest.url,
          publishedAt: latest.publishedAt,
          source: latest.source
        }
      : { ok: true, latest: null, updateAvailable: false, notes: '', url: null };

    checkCache = { at: Date.now(), payload };
    res.json({ ...payload, current, cached: false });
  } catch (err) {
    // Ağ yoksa bu bir hata durumu değil; arayüz sessizce geçer.
    res.json({
      ok: false,
      current,
      latest: null,
      updateAvailable: false,
      error: err.name === 'AbortError' ? 'GitHub yanıt vermedi.' : err.message
    });
  }
});

/** Hazırlanmış (indirilmiş, doğrulanmış) güncelleme var mı? */
router.get('/staged', (req, res) => {
  res.json({ staged: readStaged() });
});

/**
 * Yeni sürümü indirir, açar ve doğrular. Kuruluma hiçbir şey yazmaz;
 * bu adımdan sonra kullanıcı hâlâ vazgeçebilir.
 */
router.post('/download', async (req, res, next) => {
  try {
    const current = readCurrentVersion();
    const latest = await fetchLatest();

    if (!latest) {
      return res.status(400).json({ error: 'Yayımlanmış bir sürüm bulunamadı.' });
    }
    if (compareVersions(latest.version, current) <= 0) {
      return res.status(400).json({ error: 'Zaten en güncel sürümü kullanıyorsunuz.' });
    }

    const staged = await stageUpdate({
      repo: REPO,
      tag: latest.version,
      expectedVersion: latest.version
    });
    res.json({ success: true, staged });
  } catch (err) {
    next(err);
  }
});

/**
 * Hazırlanan güncellemeyi uygular. Uygulama durdurulup dosyalar
 * değiştirileceği için yanıt gönderildikten sonra sunucu kapanır.
 */
router.post('/apply', (req, res, next) => {
  try {
    const staged = readStaged();
    if (!staged) {
      return res.status(400).json({ error: 'Uygulanacak hazır güncelleme yok.' });
    }

    launchApply({ restart: req.body?.restart !== false });
    res.json({ success: true, applying: staged.version });
  } catch (err) {
    next(err);
  }
});

/** İndirilmiş güncellemeden vazgeç. */
router.delete('/staged', async (req, res, next) => {
  try {
    await discardStaged();
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
