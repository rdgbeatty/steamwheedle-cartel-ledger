import { mkdir, readFile, writeFile, rename, unlink, chmod } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

export const DAY = 86_400_000;

export async function readJson(path, fallback = null) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw new Error('A local state file could not be read. Check .wow-local or move it aside to reset the tool.');
  }
}

export async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600, flag: 'wx' });
    await rename(temporary, path);
    await chmod(path, 0o600);
  } finally { await unlink(temporary).catch(() => {}); }
}

export async function readRecent(directory, file, maxAge, now = Date.now()) {
  const path = join(directory, file);
  const value = await readJson(path);
  if (!value) return null;
  const time = Date.parse(value.retainedAt ?? value.generatedAt);
  if (!Number.isFinite(time) || time > now + 60_000 || now - time >= maxAge) {
    await unlink(path).catch(() => {});
    return null;
  }
  return value;
}

export async function readCredentials(directory, env = process.env) {
  if (env.BLIZZARD_CLIENT_ID || env.BLIZZARD_CLIENT_SECRET) return {
    clientId: env.BLIZZARD_CLIENT_ID || '', clientSecret: env.BLIZZARD_CLIENT_SECRET || '', fromEnvironment: true,
  };
  const saved = await readJson(join(directory, 'private', 'credentials.json'), {});
  return {
    clientId: saved.clientId || '', clientSecret: saved.clientSecret || '', fromEnvironment: false,
  };
}
