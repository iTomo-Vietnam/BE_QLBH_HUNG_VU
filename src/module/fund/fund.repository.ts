import { injectable } from "inversify";
import { DeepPartial, EntityManager } from "typeorm";
import { Fund, FundSnapshot } from "@/database/models/Fund";
import { BaseRepository } from "@/shared/base/BaseRepository";
import { FundRelations, FundRelationsList, FundSelectFull, FundSelectList } from "./fund.select";

@injectable()
export class FundRepository extends BaseRepository<Fund> {
  protected entityClass = Fund;
  protected selectedFields = FundSelectFull;
  protected selectedFieldsForList = FundSelectList;
  protected relations = FundRelations;
  protected relationsForList = FundRelationsList;

  async getSnapshot(id: string, manager?: EntityManager): Promise<FundSnapshot | null> {
    const fund = await this.getRepository(manager).findOne({ where: { id, deletedAt: null } as any });
    return fund
      ? { id: fund.id, code: fund.code, name: fund.name, type: fund.type, storeId: fund.storeId, isPersonal: fund.isPersonal }
      : null;
  }

  async attachInfo<T extends { fundId?: string | null; fundSnapshot?: DeepPartial<FundSnapshot> | null }>(data: T, manager?: EntityManager): Promise<void> {
    if (data.fundId && (!data.fundSnapshot || data.fundSnapshot.id !== data.fundId)) {
      data.fundSnapshot = await this.getSnapshot(data.fundId, manager);
    }
  }
}
