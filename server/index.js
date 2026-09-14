import { existsSync } from 'node:fs';
if (existsSync('.env')) process.loadEnvFile('.env');
const { openDatabase } = await import('./db.js');
const { createApp } = await import('./app.js');
const db = await openDatabase();
const port = Number(process.env.PORT || 3008);
const server = createApp(db).listen(port, process.env.HOST || '127.0.0.1', () => {
  console.log(`OrganoTale server: http://localhost:${port}`);
});
// Close the database before exiting so the local PGlite store is flushed to disk.
server.on('error', (error) => { console.error(error.message); db.close().finally(() => process.exit(1)); });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => db.close().finally(() => process.exit(0))));
