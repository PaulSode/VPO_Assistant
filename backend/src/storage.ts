/**
 * Minimal local file storage for ticket attachments.
 *
 * POC-grade: files are written under <repo>/backend/uploads/<ticketId>/ and
 * served back (publicly, by unguessable stored name) via the /files route.
 * No external object store, no extra dependencies — just Node fs.
 */

import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// uploads/ sits next to src/ (resolve from this file: src/storage.ts → ../uploads)
const UPLOADS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'uploads');

export interface StoredFile {
  filename: string;
  storedName: string;
  mime?: string;
  size: number;
  url: string;
}

/** Strip path separators so a malicious filename can't escape the ticket folder. */
function safeName(name: string): string {
  return name.replace(/[/\\]/g, '_').replace(/\.\./g, '_').slice(0, 200) || 'fichier';
}

export async function storeAttachment(args: {
  folder: string; // partition on disk + in the public URL (e.g. ticketId, or kb-<docId>)
  filename: string;
  mime?: string;
  dataBase64: string;
}): Promise<StoredFile> {
  const folder = safeName(args.folder);
  const clean = safeName(args.filename);
  const storedName = `${randomUUID()}_${clean}`;
  const dir = path.join(UPLOADS_ROOT, folder);
  await mkdir(dir, { recursive: true });

  // dataBase64 may be a bare base64 string or a data: URL — handle both.
  const base64 = args.dataBase64.includes(',') ? args.dataBase64.split(',', 2)[1]! : args.dataBase64;
  const buffer = Buffer.from(base64, 'base64');
  await writeFile(path.join(dir, storedName), buffer);

  return {
    filename: clean,
    storedName,
    mime: args.mime,
    size: buffer.length,
    url: `/files/${folder}/${storedName}`,
  };
}

export async function readAttachment(folder: string, storedName: string): Promise<Buffer> {
  return readFile(path.join(UPLOADS_ROOT, safeName(folder), safeName(storedName)));
}

/** Best-effort removal of a whole attachment folder. */
export async function removeFolder(folder: string): Promise<void> {
  await rm(path.join(UPLOADS_ROOT, safeName(folder)), { recursive: true, force: true });
}
