import express from 'express';
import cors from 'cors';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import 'dotenv/config';

// Import routes
import templatesRouter from './routes/templates.js';
import variationsRouter from './routes/variations.js';
import settingsRouter from './routes/settings.js';
import aiRouter from './routes/ai.js';
import etsyRouter from './routes/etsy.js';
import productsRouter from './routes/products.js';
import mockupRouter from './routes/mockup.js';
import shopifyRouter from './routes/shopify.js';
import storageRouter from './routes/storage.js';
import bulkJobsRouter from './routes/bulkjobs.js';
import setupRouter from './routes/setup.js';
import { resumePendingJobs } from './services/BulkJobService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// CORS configuration
app.use(cors({
  origin: '*', // Allow all during local development
  credentials: true
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Static directories for serving files
const storageDir = join(__dirname, '..', 'storage');
const uploadsDir = join(storageDir, 'uploads');
const mockupsDir = join(storageDir, 'mockups');
const templatesDir = join(storageDir, 'templates');
const exportsDir = join(storageDir, 'exports');

// Create directories if they don't exist
[uploadsDir, mockupsDir, templatesDir, exportsDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

app.use('/storage', express.static(storageDir));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Register routes
app.use('/api/setup', setupRouter);
app.use('/api/templates', templatesRouter);
app.use('/api/variations', variationsRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/ai', aiRouter);
app.use('/api/etsy', etsyRouter);
app.use('/api/products', productsRouter);
app.use('/api/mockup', mockupRouter);
app.use('/api/shopify', shopifyRouter);
app.use('/api/storage', storageRouter);
app.use('/api/bulk-jobs', bulkJobsRouter);


// Global Error Handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: err.message || 'Internal Server Error' });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  // Sunucu kapanmışken yarım kalan toplu yükleme işlerini devam ettir
  resumePendingJobs();
});
// Updated AI Service & Routes

