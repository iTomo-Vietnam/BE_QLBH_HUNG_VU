import { inject, injectable } from "inversify";
import { DeepPartial, EntityManager } from "typeorm";
import { VatAdjustment } from "@/database/models/VatDebtAdjustment";
import { BaseService } from "@/shared/base/BaseService";
import { RequestContext } from "@/shared/types/interfaces";
import { VatAdjustmentRepository } from "./vatAdjustment.repository";
import { VAT_ADJUSTMENT_TYPES } from "./vatAdjustment.types";
@injectable()
export class VatAdjustmentService extends BaseService<VatAdjustment> {
  protected repository: VatAdjustmentRepository;
  protected uniqueFields: (keyof VatAdjustment)[] = ["code"];
  protected timeField: keyof VatAdjustment = "occurredAt";
  protected searchableFields: (keyof VatAdjustment)[] = ["code", "reason"];

  constructor(
    @inject(VAT_ADJUSTMENT_TYPES.Repository) repository: VatAdjustmentRepository,
  ) {
    super();
    this.repository = repository;
  }

  async validateBeforeCreate(
    data: DeepPartial<VatAdjustment>,
    _manager: EntityManager,
    _req?: RequestContext,
  ): Promise<void> {
    this.setDelta(data);
  }

  async validateBeforeUpdate(
    id: string,
    data: DeepPartial<VatAdjustment>,
    manager: EntityManager,
    _req?: RequestContext,
  ): Promise<void> {
    const current = await this.repository.findById(id, manager);
    if (!current) throw new Error("vatAdjustment.not_found");
    this.setDelta(data, current);
  }

  private setDelta(data: DeepPartial<VatAdjustment>, current?: VatAdjustment) {
    const expectedAmount = data.expectedAmount ?? current?.expectedAmount;
    const countedAmount = data.countedAmount ?? current?.countedAmount;
    if (expectedAmount == null || countedAmount == null) {
      throw new Error("vatAdjustment.amount.required");
    }
    data.deltaAmount = Number(countedAmount) - Number(expectedAmount);
  }
}

