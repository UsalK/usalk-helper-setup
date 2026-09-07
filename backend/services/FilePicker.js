/**
 * Yerel Windows dosya seçici.
 *
 * Tarayıcı güvenlik nedeniyle gerçek dosya yolunu vermez, bu yüzden uygulama
 * içi bir klasör gezgini yazmak zorunda kalmıştık — kullanımı zahmetliydi.
 * Uygulama zaten yalnızca yerelde çalıştığı için, sunucu tarafından gerçek
 * Windows Gezgini penceresini açıp seçilen yolları geri alıyoruz.
 *
 * Son kullanılan klasör settings tablosunda saklanır ve bir sonraki açılışta
 * başlangıç konumu olarak kullanılır.
 */

import { spawn } from 'child_process';
import { dirname } from 'path';
import fs from 'fs';
import db, { getActiveShop } from '../db/db.js';

const LAST_DIR_KEY = 'last_picker_dir';

function getLastDir() {
  try {
    const shopId = getActiveShop().shop_id;
    const row = db.prepare('SELECT value FROM settings WHERE shop_id = ? AND key = ?')
      .get(shopId, LAST_DIR_KEY);
    if (row) {
      const dir = JSON.parse(row.value);
      if (dir && fs.existsSync(dir)) return dir;
    }
  } catch { /* yoksa varsayılana düş */ }
  return null;
}

function setLastDir(dir) {
  try {
    const shopId = getActiveShop().shop_id;
    const val = JSON.stringify(dir);
    db.prepare(
      'INSERT INTO settings (shop_id, key, value) VALUES (?, ?, ?) ON CONFLICT(shop_id, key) DO UPDATE SET value = ?'
    ).run(shopId, LAST_DIR_KEY, val, val);
  } catch (err) {
    console.warn('[FilePicker] Son klasör kaydedilemedi:', err.message);
  }
}

/**
 * PowerShell'i STA modunda çalıştırır — WinForms diyalogları bunu gerektirir.
 * Çıktı satır satır dosya yollarıdır; kullanıcı iptal ederse boş döner.
 */
function runPowerShell(script) {
  return new Promise((resolve, reject) => {
    const ps = spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-STA', '-Command', script
    ], { windowsHide: false });

    let out = '';
    let err = '';
    ps.stdout.on('data', d => { out += d.toString(); });
    ps.stderr.on('data', d => { err += d.toString(); });

    ps.on('error', reject);
    ps.on('close', (code) => {
      if (code !== 0 && !out.trim()) {
        return reject(new Error(err.trim() || `Seçici kapandı (kod ${code})`));
      }
      resolve(out);
    });
  });
}

function parsePaths(stdout) {
  return stdout
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(s => s.length > 0 && fs.existsSync(s));
}

/**
 * Görsel dosyası seçtirir (çoklu seçim). Gerçek Explorer penceresi açılır.
 * @returns {Promise<{files: string[], folder: string|null, cancelled: boolean}>}
 */
export async function pickImages() {
  const initial = getLastDir() || [process.env.USERPROFILE, 'Pictures'].filter(Boolean).join('\\');

  // Diyaloğun diğer pencerelerin arkasında kalmaması için geçici bir
  // topmost sahip pencere oluşturulur.
  const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$owner = New-Object System.Windows.Forms.Form
$owner.TopMost = $true
$owner.ShowInTaskbar = $false
$owner.Opacity = 0
$owner.Size = New-Object System.Drawing.Size(1,1)
$owner.StartPosition = 'CenterScreen'
$owner.Show()
$dlg = New-Object System.Windows.Forms.OpenFileDialog
$dlg.Title = 'Yuklenecek urun gorsellerini secin'
$dlg.Filter = 'Gorseller (*.png;*.jpg;*.jpeg;*.webp)|*.png;*.jpg;*.jpeg;*.webp|Tum dosyalar (*.*)|*.*'
$dlg.Multiselect = $true
$dlg.InitialDirectory = '${initial.replace(/'/g, "''")}'
$res = $dlg.ShowDialog($owner)
$owner.Close()
if ($res -eq [System.Windows.Forms.DialogResult]::OK) { $dlg.FileNames | ForEach-Object { $_ } }
`.trim();

  const stdout = await runPowerShell(script);
  const files = parsePaths(stdout);

  if (files.length === 0) {
    return { files: [], folder: null, cancelled: true };
  }

  const folder = dirname(files[0]);
  setLastDir(folder);
  return { files, folder, cancelled: false };
}

/**
 * Klasör seçtirir. Klasördeki tüm görseller işe alınır.
 * @returns {Promise<{folder: string|null, imageCount: number, cancelled: boolean}>}
 */
export async function pickFolder() {
  const initial = getLastDir() || process.env.USERPROFILE || 'C:\\';

  // Vista+ stili klasör seçici: OpenFileDialog'un klasör modu kullanılır,
  // eski FolderBrowserDialog'un ağaç görünümüne göre çok daha kullanışlıdır.
  const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$owner = New-Object System.Windows.Forms.Form
$owner.TopMost = $true
$owner.ShowInTaskbar = $false
$owner.Opacity = 0
$owner.Size = New-Object System.Drawing.Size(1,1)
$owner.StartPosition = 'CenterScreen'
$owner.Show()
$dlg = New-Object System.Windows.Forms.FolderBrowserDialog
$dlg.Description = 'Urun gorsellerinin bulundugu klasoru secin'
$dlg.SelectedPath = '${initial.replace(/'/g, "''")}'
$dlg.ShowNewFolderButton = $false
$res = $dlg.ShowDialog($owner)
$owner.Close()
if ($res -eq [System.Windows.Forms.DialogResult]::OK) { $dlg.SelectedPath }
`.trim();

  const stdout = await runPowerShell(script);
  const paths = parsePaths(stdout);

  if (paths.length === 0) {
    return { folder: null, imageCount: 0, cancelled: true };
  }

  const folder = paths[0];
  setLastDir(folder);

  const IMAGE_EXT = ['.jpg', '.jpeg', '.png', '.webp'];
  let imageCount = 0;
  try {
    imageCount = fs.readdirSync(folder).filter(f => {
      const lower = f.toLowerCase();
      return IMAGE_EXT.some(e => lower.endsWith(e));
    }).length;
  } catch { /* okunamazsa 0 kalsın */ }

  return { folder, imageCount, cancelled: false };
}

export { getLastDir };
