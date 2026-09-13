import { EntityManager, SelectQueryBuilder } from "typeorm";
import { injectable } from "inversify";
import { DebtRefType, DebtTransaction } from "@/database/models/DebtTransaction";
import { DebtSide, TransactionType } from "@/shared/constants/enum";
import {
  BaseRepository,
  IFindPaginationOptions,
} from "@/shared/base/BaseRepository";
import {
  DebtTransactionRelations,
  DebtTransactionRelationsList,
  DebtTransactionSelectFull,
  DebtTransactionSelectList,
} from "./debtTransaction.select";
import { DebtTransactionQueryDto } from "./debtTransaction.validator";

@injectable()
export class DebtTransactionRepository extends BaseRepository<DebtTransaction> {
  protected entityClass = DebtTransaction;
  protected selectedFields = DebtTransactionSelectFull;
  protected selectedFieldsForList = DebtTransactionSelectList;
  protected relations = DebtTransactionRelations;
  protected relationsForList = DebtTransactionRelationsList;

  protected async extendQueryBuilder(
    qb: SelectQueryBuilder<DebtTransaction>,
    options: IFindPaginationOptions<DebtTransaction>,
  ): Promise<void> {
    const query = (options.moreQuery || {}) as DebtTransactionQueryDto;
    const alias = qb.alias;

    if (query.partnerId) {
      qb.andWhere(`${alias}.partnerId = :debtTransactionPartnerId`, {
        debtTransactionPartnerId: query.partnerId,
      });
    }
    if (query.side) {
      qb.andWhere(`${alias}.side = :debtTransactionSide`, {
        debtTransactionSide: query.side,
      });
    }
    if (query.refType) {
      qb.andWhere(`${alias}.refType = :debtTransactionRefType`, {
        debtTransactionRefType: query.refType,
      });
    }
  }

  async removeByReference(
    refType: DebtRefType,
    refId: string,
    manager?: EntityManager,
  ): Promise<void> {
    await this.getRepository(manager).delete({ refType, refId } as any);
  }

  async getSignedAmount(
    partnerId: string,
    side?: DebtSide,
    manager?: EntityManager,
  ): Promise<number> {
    const qb = this.getRepository(manager)
      .createQueryBuilder("transaction")
      .select(
        "COALESCE(SUM(CASE WHEN transaction.type = :inType THEN transaction.amount ELSE -transaction.amount END), 0)",
        "amount",
      )
      .where("transaction.partnerId = :partnerId", { partnerId })
      .andWhere("transaction.deletedAt IS NULL")
      .setParameter("inType", TransactionType.IN);

    if (side) qb.andWhere("transaction.side = :side", { side });

    const row = await qb.getRawOne<{ amount: string }>();
    return Number(row?.amount || 0);
  }
}

