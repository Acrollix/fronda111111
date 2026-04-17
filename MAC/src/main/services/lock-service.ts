import path from "node:path";
import { LOCK_TTL_MINUTES } from "@shared/constants";
import type { LockFile } from "@shared/types";
import { exists, isTransientReadError, readJsonFile, removePath, safeTimestamp, writeJsonFile } from "./fs-utils";

const SELF_LOCK_RECOVERY_MS = 10_000;
const STALE_LOCK_HEARTBEAT_MS = 90_000;

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

function parseDate(value?: string): number | null {
  if (!value) {
    return null;
  }
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : timestamp;
}

function formatLockReason(existing: LockFile): string {
  const owner = existing.user_name || "другой пользователь";
  return `Эту запись уже редактирует ${owner}.`;
}

export class LockService {
  private getEntityLockPath(sharedPath: string, entityType: string, entityId?: string): string {
    if (entityType === "structure" || entityType === "directories" || entityType === "manifest") {
      return path.join(sharedPath, "locks", `${entityType}.lock.json`);
    }
    return path.join(sharedPath, "locks", "entities", `${entityType}_${entityId}.lock.json`);
  }

  async acquireLock(
    sharedPath: string,
    entityType: string,
    entityId: string | undefined,
    payload: Omit<LockFile, "lock_id" | "acquired_at" | "heartbeat_at" | "expires_at">
  ): Promise<{ ok: boolean; lock?: LockFile; reason?: string }> {
    const lockPath = this.getEntityLockPath(sharedPath, entityType, entityId);
    const now = new Date();

    if (await exists(lockPath)) {
      const existing = await readJsonFile<LockFile>(lockPath).catch(() => null);
      if (!existing) {
        await removePath(lockPath).catch(() => undefined);
      } else {
        const nowMs = now.getTime();
        const expiresAtMs = parseDate(existing.expires_at);
        const heartbeatAtMs = parseDate(existing.heartbeat_at) ?? parseDate(existing.acquired_at);
        const sameMachine = Boolean(existing.machine_id && existing.machine_id === payload.machine_id);
        const sameUser = Boolean(existing.user_name && existing.user_name === payload.user_name);
        const expired = expiresAtMs !== null && expiresAtMs <= nowMs;
        const staleByHeartbeat = heartbeatAtMs !== null && nowMs - heartbeatAtMs > STALE_LOCK_HEARTBEAT_MS;
        const recoverOwnLock = sameMachine && sameUser && heartbeatAtMs !== null && nowMs - heartbeatAtMs > SELF_LOCK_RECOVERY_MS;

        if (expired || staleByHeartbeat || recoverOwnLock) {
          await removePath(lockPath).catch(() => undefined);
        } else {
          return { ok: false, reason: formatLockReason(existing) };
        }
      }
    }

    const lock: LockFile = {
      ...payload,
      lock_id: `lock_${entityType}_${entityId ?? "global"}_${safeTimestamp(now)}`,
      acquired_at: now.toISOString(),
      heartbeat_at: now.toISOString(),
      expires_at: addMinutes(now, LOCK_TTL_MINUTES).toISOString()
    };
    await writeJsonFile(lockPath, lock);
    return { ok: true, lock };
  }

  async refreshLock(sharedPath: string, entityType: string, entityId?: string): Promise<void> {
    const lockPath = this.getEntityLockPath(sharedPath, entityType, entityId);
    if (!(await exists(lockPath))) {
      return;
    }
    const lock = await readJsonFile<LockFile>(lockPath);
    const now = new Date();
    lock.heartbeat_at = now.toISOString();
    lock.expires_at = addMinutes(now, LOCK_TTL_MINUTES).toISOString();
    await writeJsonFile(lockPath, lock);
  }

  async releaseLock(sharedPath: string, entityType: string, entityId?: string): Promise<void> {
    const lockPath = this.getEntityLockPath(sharedPath, entityType, entityId);
    try {
      if (await exists(lockPath)) {
        await removePath(lockPath);
      }
    } catch (error) {
      if (!isTransientReadError(error)) {
        throw error;
      }
      console.warn(`[FRONDA] Не удалось вовремя снять lock ${entityType}:${entityId ?? "global"}`, error);
    }
  }

  async readLock(sharedPath: string, entityType: string, entityId?: string): Promise<LockFile | null> {
    const lockPath = this.getEntityLockPath(sharedPath, entityType, entityId);
    if (!(await exists(lockPath))) {
      return null;
    }
    return readJsonFile<LockFile>(lockPath);
  }
}
