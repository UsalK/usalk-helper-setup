/**
 * Mockup render worker havuzu.
 *
 * Birden çok ürünün mockup'ları paralel üretilir. Çekirdek sayısına göre
 * boyutlanır ama makineyi tamamen doldurmaz: kullanıcı çalışırken bilgisayarın
 * responsive kalması, son bir-iki saniyelik hızdan daha önemli.
 */

import { Worker } from 'worker_threads';
import os from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKER_PATH = join(__dirname, 'mockupWorker.js');

// Fiziksel çekirdeklerin bir kısmını boş bırak; 8 çekirdekte 4 worker.
const CPU_COUNT = os.cpus().length;
const DEFAULT_CONCURRENCY = Math.max(1, Math.min(4, Math.floor(CPU_COUNT / 2) - 1 || 1));

/**
 * Worker başına şablon önbelleği bütçesi (piksel).
 *
 * Tek bir en-boy oranının şablon takımı ~95 MP tutuyor (16 şablon, bazıları
 * 3000x3000). Bütçe bunun altında kalırsa worker her üründe aynı şablonları
 * baştan decode ediyor ve önbellek hiçbir işe yaramıyor — ölçümde ısınmış
 * önbellekle soğuk arasında fark çıkmamasının sebebi buydu.
 *
 * 120 MP ≈ 480 MB RGBA; bir oranın tamamı sığar, üstüne pay kalır.
 */
const CACHE_PIXELS_PER_WORKER = 120_000_000;

class MockupPool {
  constructor(size = Number(process.env.MOCKUP_WORKERS) || DEFAULT_CONCURRENCY) {
    this.size = size;
    this.workers = [];
    this.idle = [];
    this.queue = [];
    this.tasks = new Map();
    this.nextTaskId = 1;
  }

  _spawn() {
    const worker = new Worker(WORKER_PATH, {
      workerData: { cacheBudgetPixels: CACHE_PIXELS_PER_WORKER }
    });

    worker.on('message', (msg) => {
      const task = this.tasks.get(msg.taskId);
      if (!task) return;

      if (msg.type === 'progress') {
        task.onProgress?.(msg);
        return;
      }

      this.tasks.delete(msg.taskId);
      this.idle.push(worker);

      if (msg.type === 'done') task.resolve(msg.generated);
      else task.reject(new Error(msg.error || 'Mockup üretimi başarısız'));

      this._drain();
    });

    worker.on('error', (err) => {
      console.error('[MockupPool] Worker hatası:', err.message);
      // Bu worker'a bağlı işi reddet ve worker'ı yenile
      for (const [id, task] of this.tasks) {
        if (task.worker === worker) {
          this.tasks.delete(id);
          task.reject(err);
        }
      }
      this.workers = this.workers.filter(w => w !== worker);
      this.idle = this.idle.filter(w => w !== worker);
      this._drain();
    });

    this.workers.push(worker);
    return worker;
  }

  _drain() {
    while (this.queue.length > 0) {
      let worker = this.idle.pop();
      if (!worker) {
        if (this.workers.length < this.size) worker = this._spawn();
        else return;
      }

      const job = this.queue.shift();
      const taskId = this.nextTaskId++;
      this.tasks.set(taskId, { ...job, worker });
      worker.postMessage({ type: 'render', taskId, product: job.product });
    }
  }

  /** Bir ürünün mockup'larını havuzda üretir. */
  render(product, { onProgress } = {}) {
    return new Promise((resolve, reject) => {
      this.queue.push({ product, onProgress, resolve, reject });
      this._drain();
    });
  }

  async destroy() {
    await Promise.all(this.workers.map(w => w.terminate()));
    this.workers = [];
    this.idle = [];
  }
}

let pool = null;

export function getMockupPool() {
  if (!pool) {
    pool = new MockupPool();
    console.log(`[MockupPool] ${pool.size} paralel render worker'ı (${CPU_COUNT} mantıksal çekirdek).`);
  }
  return pool;
}

export { DEFAULT_CONCURRENCY };
