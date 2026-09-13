import { inject, injectable } from "inversify";
import { DeepPartial, EntityManager } from "typeorm";
import { User } from "@/database/models/User";
import { BaseService } from "@/shared/base/BaseService";
import { RequestContext } from "@/shared/types/interfaces";
import { withTransaction } from "@/shared/base/TransactionManager";
import { UserRepository } from "./user.repository";
import { USER_TYPES } from "./user.types";
import { AuthUtils } from "@/shared/utils/auth.utils";
import { StoreUser } from "@/database/models/store/StoreUser";
import { StoreUserRepository } from "@/module/storeUser/storeUser.repository";
import { STORE_USER_TYPES } from "@/module/storeUser/storeUser.types";
import { invalidateUserStoreAccess } from "@/shared/utils/store-access.utils";
import { Role } from "@/database/models/store/Role";
import { BadRequestError } from "@/shared/types/errors";

@injectable()
export class UserService extends BaseService<User> {
  protected repository: UserRepository;
  protected uniqueFields: (keyof User)[] = ["username"];
  constructor(
    @inject(USER_TYPES.Repository) repository: UserRepository,
    @inject(STORE_USER_TYPES.Repository)
    private storeUserRepository: StoreUserRepository,
  ) {
    super();
    this.repository = repository;
  }
  async validateBeforeCreate(
    data: DeepPartial<User>,
    manager: EntityManager,
    req?: RequestContext,
  ): Promise<void> {
    data.password = await AuthUtils.hashPassword(data.password || "123456");
    for (const storeUser of (data.storeUsers || []) as DeepPartial<StoreUser>[]) {
      if (!storeUser.storeId || storeUser.storeId !== req?.storeContext?.storeId)
        throw new BadRequestError("Người dùng chỉ được gán vào cửa hàng đang thao tác");
      if (storeUser.roleId) {
        const role = await manager.getRepository(Role).findOne({ where: { id: storeUser.roleId } });
        if (!role || role.storeId !== storeUser.storeId)
          throw new BadRequestError("Vai trò không thuộc cửa hàng được gán");
      }
    }
  }

  async validateBeforeUpdate(
    _id: string,
    data: DeepPartial<User>,
    _manager: EntityManager,
    _req?: RequestContext,
  ): Promise<void> {
    if (!data.password) return;
    data.password = await AuthUtils.hashPassword(data.password);
  }

  private async syncStoreUsers(
    userId: string,
    storeUsers: DeepPartial<StoreUser>[],
    manager: EntityManager,
    req?: RequestContext,
  ): Promise<void> {
    const repository = this.storeUserRepository.getRepository(manager);
    const existing = await repository.find({ where: { userId } as any });
    const storeIds = new Set<string>();

    for (const storeUser of storeUsers) {
      if (!storeUser.storeId) throw new BadRequestError("Cửa hàng là bắt buộc");
      if (storeUser.roleId) {
        const role = await manager.getRepository(Role).findOne({ where: { id: storeUser.roleId } });
        if (!role || role.storeId !== storeUser.storeId)
          throw new BadRequestError("Vai trò không thuộc cửa hàng được gán");
      }
      storeIds.add(storeUser.storeId);
    }

    const existingByStoreId = new Map(
      existing.map((storeUser) => [storeUser.storeId, storeUser]),
    );

    for (const storeUser of storeUsers) {
      const current = existingByStoreId.get(storeUser.storeId!);
      if (storeUser.storeId !== req?.storeContext?.storeId) {
        if (!current || current.roleId !== (storeUser.roleId ?? null))
          throw new BadRequestError("Chỉ được thay đổi phân quyền tại cửa hàng đang thao tác");
        continue;
      }
      if (current) {
        await repository.update(current.id, { roleId: storeUser.roleId ?? null });
      } else {
        await repository.save(repository.create({
          userId,
          storeId: storeUser.storeId,
          roleId: storeUser.roleId ?? null,
        }));
      }
    }

    for (const storeUser of existing) {
      if (!storeIds.has(storeUser.storeId) && storeUser.storeId === req?.storeContext?.storeId)
        await repository.delete(storeUser.id);
    }
  }

  async update(
    id: string,
    data: DeepPartial<User>,
    manager?: EntityManager,
    req?: RequestContext,
  ): Promise<User | null> {
    const payload = { ...(data as any) } as DeepPartial<User> & {
      storeUsers?: DeepPartial<StoreUser>[];
      role?: unknown;
      notifications?: unknown;
    };
    const storeUsers = payload.storeUsers;

    // Store roles are synced separately through StoreUserRepository below.
    delete payload.storeUsers;
    delete payload.role;
    delete payload.notifications;

    // The FE sends a masked password when it is unchanged.
    if (typeof payload.password === "string" && /^\*+$/.test(payload.password)) {
      delete payload.password;
    }

    const run = async (em: EntityManager): Promise<User | null> => {
      const updated = await super.update(id, payload, em, req);
      if (!updated || !Array.isArray(storeUsers)) return updated;

      await this.syncStoreUsers(id, storeUsers, em, req);
      await invalidateUserStoreAccess(id);
      return this.repository.findById(id, em);
    };

    return manager ? run(manager) : withTransaction(run);
  }

  async actionAfterCreate(
    data: User,
    manager: EntityManager,
    req?: RequestContext,
  ): Promise<void> {
    await invalidateUserStoreAccess(data.id);
  }

  async actionAfterDelete(data: User): Promise<void> {
    await invalidateUserStoreAccess(data.id);
  }
}
