import { inject, injectable } from "inversify";
import { DeepPartial, EntityManager } from "typeorm";
import { Role } from "@/database/models/store/Role";
import { BaseService } from "@/shared/base/BaseService";
import { RequestContext } from "@/shared/types/interfaces";
import { RoleRepository } from "./role.repository";
import { ROLE_TYPES } from "./role.types";
import { invalidateRoleStoreAccess } from "@/shared/utils/store-access.utils";
import { BadRequestError } from "@/shared/types/errors";
@injectable()
export class RoleService extends BaseService<Role> {
  protected repository: RoleRepository;
  protected uniqueFields: (keyof Role)[] = ["name"];
  protected uniqueScope: (keyof Role)[] = ["storeId"];
  constructor(@inject(ROLE_TYPES.Repository) repository: RoleRepository) {
    super();
    this.repository = repository;
  }
  async validateBeforeCreate(
    data: DeepPartial<Role>,
    _manager: EntityManager,
    req?: RequestContext,
  ): Promise<void> {
    data.storeId = data.storeId || req?.storeContext?.storeId;
    if (!data.storeId) throw new BadRequestError("Cửa hàng là bắt buộc");
    if (!data.storeId) throw new Error("Cửa hàng là bắt buộc");
  }

  async actionAfterUpdate(data: Role): Promise<void> {
    await invalidateRoleStoreAccess(data.id);
  }

  async actionAfterDelete(data: Role): Promise<void> {
    await invalidateRoleStoreAccess(data.id);
  }
}
