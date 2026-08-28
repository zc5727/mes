import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const envExamplePath = fileURLToPath(new URL('../.env.example', import.meta.url));
const requiredKeys = [
  'NODE_ENV',
  'PORT',
  'DATABASE_URL',
  'MQTT_URL',
  'MINIO_ENDPOINT',
  'MINIO_PORT',
  'MINIO_ACCESS_KEY',
  'MINIO_SECRET_KEY',
];

const content = await readFile(envExamplePath, 'utf8');
const values = new Map();

for (const rawLine of content.split(/\r?\n/)) {
  const line = rawLine.trim();
  if (!line || line.startsWith('#')) continue;
  const separator = line.indexOf('=');
  if (separator <= 0) throw new Error(`Invalid environment line: ${rawLine}`);
  values.set(line.slice(0, separator), line.slice(separator + 1));
}

const missingKeys = requiredKeys.filter((key) => !values.get(key));
if (missingKeys.length) throw new Error(`Missing required keys: ${missingKeys.join(', ')}`);

const port = Number(values.get('PORT'));
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535');
}

for (const key of ['DATABASE_URL', 'MQTT_URL']) {
  try {
    new URL(values.get(key));
  } catch {
    throw new Error(`${key} must be a valid URL`);
  }
}

if (process.argv.includes('--check-local')) {
  const localEnvPath = fileURLToPath(new URL('../.env', import.meta.url));
  try {
    await readFile(localEnvPath, 'utf8');
  } catch {
    throw new Error('backend/.env is missing; copy .env.example before local startup');
  }
}

console.log(`Environment contract valid: ${requiredKeys.length} required keys`);
