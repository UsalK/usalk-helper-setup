// Optional manual generator. Normal server startup performs the same setup.
import db from '../db/db.js';
import { initializeLocalSnapshots } from '../services/TemplateSync.js';

const result = initializeLocalSnapshots();
db.close();
if (!result) process.exitCode = 1;
else console.log('Local files are ready. Existing data and settings were preserved.');
