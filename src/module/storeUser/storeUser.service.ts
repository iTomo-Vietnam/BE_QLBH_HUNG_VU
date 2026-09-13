import { inject, injectable } from "inversify";
import { DeepPartial, EntityManager } from "typeorm";
import { StoreUser } from "@/database/models/store/StoreUser";
import { BaseService } from "@/shared/base/BaseService";
import { RequestContext } from "@/shared/types/interfaces";
import { StoreUserRepository } from "./storeUser.repository";
import { STORE_USER_TYPES } from "./storeUser.types";
import { invalidateUserStoreAccess } from "@/shared/utils/store-access.utils";
import { Role } from "@/database/models/store/Role";
import { BadRequestError } from "@/shared/types/errors";
@injectable()
export class StoreUserService extends BaseService<StoreUser> {
  protected repository: StoreUserRepository;
  protected uniqueFields: (keyof StoreUser)[] = ["userId"];
  protected uniqueScope: (keyof StoreUser)[] = ["storeId"];

  constructor(@inject(STORE_USER_TYPES.Repository) repository: StoreUserRepository) {
    super();
    this.repository = repository;
  }

  async validateBeforeCreate(
    data: DeepPartial<StoreUser>,
    manager: EntityManager,
    req?: RequestContext,
  ): Promise<void> {
    data.storeId = data.storeId || req?.storeContext?.storeId;
    if (!data.storeId) throw new BadRequestError("Cửa hàng là bắt buộc");
    if (data.roleId) {
      const role = await manager.getRepository(Role).findOne({ where: { id: data.roleId } });
      if (!role || role.storeId !== data.storeId)
        throw new BadRequestError("Vai trò không thuộc cửa hàng đang thao tác");
    }
    if (!data.storeId) throw new Error("Cửa hàng là bắt buộc");
  }

  async validateBeforeUpdate(
    _id: string,
    data: DeepPartial<StoreUser>,
    manager: EntityManager,
    req?: RequestContext,
  ): Promise<void> {
    if (!data.roleId) return;
    const role = await manager.getRepository(Role).findOne({ where: { id: data.roleId } });
    if (!role) throw new BadRequestError("Không tìm thấy vai trò");
    if (role.storeId !== (data.storeId || req?.storeContext?.storeId))
      throw new BadRequestError("Vai trò không thuộc cửa hàng đang thao tác");
  }

  async actionAfterCreate(data: StoreUser): Promise<void> {
    await invalidateUserStoreAccess(data.userId);
  }

  async actionAfterUpdate(data: StoreUser): Promise<void> {
    await invalidateUserStoreAccess(data.userId);
  }

  async actionAfterDelete(data: StoreUser): Promise<void> {
    await invalidateUserStoreAccess(data.userId);
  }
}
