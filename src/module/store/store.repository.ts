import {
  BaseRepository,
  IFindPaginationOptions,
} from "@/shared/base/BaseRepository";
import { StoreSelectFull, StoreSelectList, StoreRelations, StoreRelationsList } from "./store.select";
import { Store } from "@/database/models/Store";
import { SelectQueryBuilder } from "typeorm";
import { DeepPartial, EntityManager } from "typeorm";
import { StoreSnapshot } from "@/database/models/Store";
import { injectable } from "inversify";

@injectable()
export class StoreRepository extends BaseRepository<Store> {
  protected entityClass = Store;
  protected selectedFields = StoreSelectFull;
  protected selectedFieldsForList = StoreSelectList;
  protected relations = StoreRelations;
  protected relationsForList = StoreRelationsList;

  async getSnapshot(id: string, manager?: EntityManager): Promise<StoreSnapshot | null> {
    const store = await this.getRepository(manager).findOne({ where: { id, deletedAt: null } as any });
    return store ? { id: store.id, code: store.code, name: store.name } : null;
  }

  async attachInfo<T extends { fromStoreId?: string | null; fromStoreSnapshot?: DeepPartial<StoreSnapshot> | null; toStoreId?: string | null; toStoreSnapshot?: DeepPartial<StoreSnapshot> | null }>(data: T, manager?: EntityManager): Promise<void> {
    for (const [idKey, snapshotKey] of [["fromStoreId", "fromStoreSnapshot"], ["toStoreId", "toStoreSnapshot"]] as const) {
      const id = data[idKey];
      if (id && (!(data[snapshotKey]) || data[snapshotKey]?.id !== id)) (data as any)[snapshotKey] = await this.getSnapshot(id, manager);
    }
  }

  protected async extendQueryBuilder(
    qb: SelectQueryBuilder<Store>,
    options: IFindPaginationOptions<Store>,
  ): Promise<void> {
    const alias = qb.alias;

    // Count memberships in this store.
    qb.loadRelationCountAndMap(
      `${alias}.userCount`,
      `${alias}.storeUsers`,
    );
  }
}
