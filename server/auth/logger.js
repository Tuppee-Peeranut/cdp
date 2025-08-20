import fs from 'fs';
import path from 'path';

const logFile = path.join(process.cwd(), 'server', 'auth', 'auth.log');

export function logEvent(event, details = {}) {
  const entry = { timestamp: new Date().toISOString(), event, ...details };
  const line = JSON.stringify(entry) + '\n';
  fs.appendFile(logFile, line, err => {
    if (err) console.error('Failed to write auth log', err);
  });
}
