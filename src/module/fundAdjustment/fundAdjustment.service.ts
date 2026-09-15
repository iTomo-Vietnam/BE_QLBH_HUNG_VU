import { inject, injectable } from "inversify";
import { DeepPartial, EntityManager } from "typeorm";
import { FundAdjustment } from "@/database/models/FundAdjustment";
import { BaseService } from "@/shared/base/BaseService";
import { RequestContext } from "@/shared/types/interfaces";
import { FUND_TYPES } from "../fund/fund.types";
import { FundRepository } from "../fund/fund.repository";
import { FundAdjustmentRepository } from "./fundAdjustment.repository";
import { FUND_ADJUSTMENT_TYPES } from "./fundAdjustment.types";
@injectable()
export class FundAdjustmentService extends BaseService<FundAdjustment> {
  protected repository: FundAdjustmentRepository;
  protected uniqueFields: (keyof FundAdjustment)[] = ["code"];
  constructor(
    @inject(FUND_ADJUSTMENT_TYPES.Repository)
    repository: FundAdjustmentRepository,
    @inject(FUND_TYPES.Repository) private fundRepository: FundRepository,
  ) {
    super();
    this.repository = repository;
  }
  async validateBeforeCreate(
    data: DeepPartial<FundAdjustment>,
    manager: EntityManager,
    req?: RequestContext,
  ): Promise<void> {
    await this.fundRepository.attachInfo(data, manager);
    data.deltaAmount =
      Number(data.countedAmount || 0) - Number(data.expectedAmount || 0);
  }
}
