import crypto from "node:crypto";
import type { Dirent, Stats } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

export const TRANSIENT_CLOUD_READ_MESSAGE =
  "Общая папка временно недоступна для чтения. Подождите синхронизацию облака и нажмите «Проверить снова» или «Обновить данные».";

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message ?? "";
  }
  if (
    error
    && typeof error === "object"
    && "message" in error
    && typeof (error as { message?: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }
  return "";
}

function getErrorCode(error: unknown): string {
  if (
    error
    && typeof error === "object"
    && "code" in error
    && typeof (error as { code?: unknown }).code === "string"
  ) {
    return (error as { code: string }).code;
  }
  return "";
}

export function isTransientReadError(error: unknown): boolean {
  const message = getErrorMessage(error);
  const code = getErrorCode(error);
  return (
    /UNKNOWN:\s*unknown error,\s*read/i.test(message)
    || /\bunknown error,\s*read\b/i.test(message)
    || /\bcloud file provider\b/i.test(message)
    || /\bcloud file provider is not running\b/i.test(message)
    || /\bprovider is not running\b/i.test(message)
    || code === "UNKNOWN"
    || code === "EBUSY"
    || code === "EIO"
    || code === "EPERM"
  );
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTransientReadRetry<T>(operation: () => Promise<T>): Promise<T> {
  const delays = [0, 100, 250, 500, 900, 1500];
  let lastError: unknown;
  for (let index = 0; index < delays.length; index += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isTransientReadError(error) || index === delays.length - 1) {
        throw error;
      }
      await sleep(delays[index + 1] ?? 0);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Не удалось прочитать файл.");
}

async function readFileWithRetry(filePath: string, encoding: BufferEncoding): Promise<string>;
async function readFileWithRetry(filePath: string): Promise<Buffer>;
async function readFileWithRetry(filePath: string, encoding?: BufferEncoding): Promise<string | Buffer> {
  return withTransientReadRetry(async () => {
    if (encoding) {
      return fs.readFile(filePath, encoding);
    }
    return fs.readFile(filePath);
  });
}

export async function readDirentsWithRetry(dirPath: string): Promise<Dirent[]> {
  return withTransientReadRetry(() => fs.readdir(dirPath, { withFileTypes: true }));
}

export async function statWithRetry(targetPath: string): Promise<Stats> {
  return withTransientReadRetry(() => fs.stat(targetPath));
}

export async function accessWithRetry(targetPath: string): Promise<void> {
  await withTransientReadRetry(() => fs.access(targetPath));
}

export async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

export async function exists(filePath: string): Promise<boolean> {
  try {
    await accessWithRetry(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function readJsonFile<T>(filePath: string): Promise<T> {
  const raw = await readFileWithRetry(filePath, "utf8");
  return JSON.parse(raw) as T;
}

export async function writeJsonFile(
  filePath: string,
  value: unknown,
  pretty = true
): Promise<void> {
  const json = pretty
    ? `${JSON.stringify(value, null, 2)}\n`
    : JSON.stringify(value);
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, json, "utf8");
}

export async function readTextFile(filePath: string): Promise<string> {
  return readFileWithRetry(filePath, "utf8");
}

export async function appendTextFile(filePath: string, content: string): Promise<void> {
  await ensureDir(path.dirname(filePath));
  await fs.appendFile(filePath, content, "utf8");
}

export async function hashFile(filePath: string): Promise<string> {
  const raw = await readFileWithRetry(filePath);
  return crypto.createHash("sha256").update(raw).digest("hex");
}

export async function hashJson(value: unknown): Promise<string> {
  const raw = JSON.stringify(value);
  return crypto.createHash("sha256").update(raw).digest("hex");
}

export async function copyPath(source: string, destination: string): Promise<void> {
  await ensureDir(path.dirname(destination));
  await fs.cp(source, destination, { recursive: true, force: true });
}

export async function removePath(targetPath: string): Promise<void> {
  if (!(await exists(targetPath))) {
    return;
  }
  await fs.rm(targetPath, { recursive: true, force: true });
}

export function safeTimestamp(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, "-");
}
