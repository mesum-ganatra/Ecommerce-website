import { createApp } from './app';
import './models';
import { assertStorageConfigured } from './services/storage';

// Entry point for Vercel. Vercel calls this Express app as a function for every request; the database connection
// is opened on demand inside the app (see app.ts) and reused while the instance stays warm.
assertStorageConfigured();

const app = createApp();
// the bundle is CommonJS and Vercel expects the request handler to be the module itself
module.exports = app;
