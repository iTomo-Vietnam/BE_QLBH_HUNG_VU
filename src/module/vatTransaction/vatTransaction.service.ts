import { inject, injectable } from "inversify";
import { EntityManager } from "typeorm";
import { VatTransaction } from "@/database/models/VatTransaction";
import { VatAdjustment } from "@/database/models/VatDebtAdjustment";
import { BaseService } from "@/shared/base/BaseService";
import { TransactionType } from "@/shared/constants/enum";
import { VatTransactionRepository } from "./vatTransaction.repository";
import { VAT_TRANSACTION_TYPES } from "./vatTransaction.types";
@injectable()
export class VatTransactionService extends BaseService<VatTransaction> {
  protected repository: VatTransactionRepository;

  constructor(
    @inject(VAT_TRANSACTION_TYPES.Repository)
    repository: VatTransactionRepository,
  ) {
    super();
    this.repository = repository;
  }

  async getBalanceAtDate(
    occurredAt: Date,
    excludeId?: string,
    manager?: EntityManager,
  ): Promise<number> {
    const transactionRepository = this.repository.getRepository(manager);

    const transactionResult = await transactionRepository
      .createQueryBuilder("transaction")
      .select(
        "COALESCE(SUM(CASE WHEN transaction.type = :inType THEN transaction.amount ELSE -transaction.amount END), 0)",
        "amount",
      )
      .where("transaction.occurredAt <= :occurredAt", { occurredAt })
      .andWhere("transaction.deletedAt IS NULL")
      .setParameter("inType", TransactionType.IN)
      .getRawOne<{ amount: string }>();

    const adjustmentQuery = transactionRepository.manager
      .getRepository(VatAdjustment)
      .createQueryBuilder("adjustment")
      .select("COALESCE(SUM(adjustment.deltaAmount), 0)", "amount")
      .where("adjustment.occurredAt <= :occurredAt", { occurredAt })
      .andWhere("adjustment.deletedAt IS NULL");

    if (excludeId) {
      adjustmentQuery.andWhere("adjustment.id != :excludeId", { excludeId });
    }

    const adjustmentResult = await adjustmentQuery.getRawOne<{ amount: string }>();

    return Number(transactionResult?.amount || 0) + Number(adjustmentResult?.amount || 0);
  }

  async validateBeforeCreate(): Promise<void> {
    throw new Error("vatTransaction.generated_only");
  }

  async validateBeforeUpdate(): Promise<void> {
    throw new Error("vatTransaction.immutable");
  }

  async validateBeforeDelete(): Promise<void> {
    throw new Error("vatTransaction.immutable");
  }
}

