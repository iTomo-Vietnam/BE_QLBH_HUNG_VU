import { IsNull } from "typeorm";
import DatabaseConfig from "@/config/database";
import { StoreUser } from "@/database/models/store/StoreUser";
import RedisHelper from "./redis.helper";
import type { Module } from "../middleware/permission.middleware";

export const STORE_ACCESS_CACHE_PREFIX = "user:store-access:";

const getKey = (userId: string) => `${STORE_ACCESS_CACHE_PREFIX}${userId}`;

export interface CachedStoreUser {
  id: string;
  userId: string;
  storeId: string;
  store?: { id: string; code: string; name: string } | null;
  roleId?: string | null;
  role?: {
    id: string;
    storeId: string;
    name: string;
    permissions: Record<string, string[]>;
    importExcel: Module[];
    exportExcel: Module[];
  } | null;
}

export async function getUserStoreAccess(userId: string): Promise<CachedStoreUser[]> {
  const cached = await RedisHelper.getJson<CachedStoreUser[]>(getKey(userId));
  if (cached) return cached;

  const memberships = await DatabaseConfig.getRepository(StoreUser).find({
    where: { userId, deletedAt: IsNull() } as any,
    relations: { store: true, role: true },
  });
  const data = memberships.map((membership) => ({
    id: membership.id,
    userId: membership.userId,
    storeId: membership.storeId,
    store: membership.store
      ? {
          id: membership.store.id,
          code: membership.store.code,
          name: membership.store.name,
        }
      : null,
    roleId: membership.roleId,
    role: membership.role
      ? {
          id: membership.role.id,
          storeId: membership.role.storeId,
          name: membership.role.name,
          permissions: membership.role.permissions || {},
          importExcel: membership.role.importExcel || [],
          exportExcel: membership.role.exportExcel || [],
        }
      : null,
  }));

  await RedisHelper.setJson(getKey(userId), data);
  return data;
}

export async function invalidateUserStoreAccess(userId?: string | null): Promise<void> {
  if (userId) await RedisHelper.del(getKey(userId));
}

export async function invalidateRoleStoreAccess(roleId?: string | null): Promise<void> {
  if (!roleId) return;
  const memberships = await DatabaseConfig.getRepository(StoreUser).find({
    where: { roleId, deletedAt: IsNull() } as any,
    select: { userId: true } as any,
  });
  await Promise.all(
    memberships.map((membership) => invalidateUserStoreAccess(membership.userId)),
  );
}
