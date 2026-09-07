/**
 * Mockup render worker'ı.
 *
 * Her worker kendi thread'inde tek bir ürünün mockup'larını üretir. Skia
 * çağrıları yerel (native) ve senkron olduğu için ana thread'de çalıştıkça
 * sunucuyu ve dolaylı olarak makineyi kilitliyordu; worker_threads ile hem
 * gerçek paralellik hem de ana thread'in responsive kalması sağlanır.
 */

import { parentPort, workerData } from 'worker_threads';
import { generateMockupsForProduct, setCacheBudget } from './MockupRenderer.js';

if (workerData?.cacheBudgetPixels) {
  setCacheBudget(workerData.cacheBudgetPixels);
}

parentPort.on('message', async (msg) => {
  if (msg?.type !== 'render') return;

  try {
    const generated = await generateMockupsForProduct(msg.product, {
      onProgress: (p) => parentPort.postMessage({ type: 'progress', taskId: msg.taskId, ...p })
    });
    parentPort.postMessage({ type: 'done', taskId: msg.taskId, generated });
  } catch (err) {
    parentPort.postMessage({ type: 'error', taskId: msg.taskId, error: err.message });
  }
});
