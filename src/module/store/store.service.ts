import { inject, injectable } from "inversify";
import { DeepPartial, EntityManager } from "typeorm";
import { BaseService } from "@/shared/base/BaseService";
import { RequestContext } from "@/shared/types/interfaces";
import { Store } from "@/database/models/Store";
import { FundType } from "@/database/models/Fund";
import { STORE_TYPES } from "./store.types";
import { StoreRepository } from "./store.repository";
import { generateCode } from "@/shared/utils/code.utils";
import { roleSeeders } from "@/database/seeders/role";

/** Store is a global entity; store-scoped records use StoreEntity.storeId. */
@injectable()
export class StoreService extends BaseService<Store> {
  protected repository: StoreRepository;
  protected uniqueFields: (keyof Store)[] = ["code"];
  protected searchableFields = ["code", "name", "email", "phone"];

  constructor(
    @inject(STORE_TYPES.StoreRepository) repository: StoreRepository,
  ) {
    super();
    this.repository = repository;
  }

  async validateBeforeCreate(
    data: DeepPartial<Store>,
    _manager: EntityManager,
    _req?: RequestContext,
  ): Promise<void> {
    if (!data.code) data.code = await generateCode("store");

    const funds = Array.isArray(data.funds) ? [...data.funds] : [];
    if (!funds.some((fund) => fund?.type === FundType.CASH)) {
      const normalizedCode = String(data.code)
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9_-]/g, "")
        .slice(0, 21);
      funds.unshift({
        code: `TM-${normalizedCode || "STORE"}`,
        name: "Tiền mặt",
        type: FundType.CASH,
        isPersonal: false,
        isDefault: true,
        isActive: true,
      });
    }
    data.funds = funds;

    const roles = Array.isArray(data.roles) ? [...data.roles] : [];
    const roleNames = new Set(roles.map((role) => role?.name).filter(Boolean));
    for (const seed of roleSeeders) {
      if (seed.name && roleNames.has(seed.name)) continue;
      roles.push({
        ...seed,
        permissions: seed.permissions ? { ...seed.permissions } : undefined,
        importExcel: [...(seed.importExcel || [])],
        exportExcel: [...(seed.exportExcel || [])],
      });
    }
    data.roles = roles;
  }
}
