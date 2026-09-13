import { inject, injectable } from "inversify";
import { DeepPartial, EntityManager } from "typeorm";
import { BaseService } from "@/shared/base/BaseService";
import { RequestContext } from "@/shared/types/interfaces";
import { Store } from "@/database/models/Store";
import { STORE_TYPES } from "./store.types";
import { StoreRepository } from "./store.repository";
import { ensureDefaultCashFund } from "../fund/fund.service";

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
    _data: DeepPartial<Store>,
    _manager: EntityManager,
    _req?: RequestContext,
  ): Promise<void> {}

  async actionAfterCreate(data: Store, manager: EntityManager): Promise<void> {
    await ensureDefaultCashFund(data.id, data.code, manager);
  }
}
