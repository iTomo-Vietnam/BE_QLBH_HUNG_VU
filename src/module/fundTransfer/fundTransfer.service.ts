import { inject, injectable } from "inversify";
import { DeepPartial, EntityManager } from "typeorm";
import { FundTransfer } from "@/database/models/FundTransfer";
import { BaseService } from "@/shared/base/BaseService";
import { RequestContext } from "@/shared/types/interfaces";
import { FundTransferRepository } from "./fundTransfer.repository";
import { FUND_TRANSFER_TYPES } from "./fundTransfer.types";
@injectable()
export class FundTransferService extends BaseService<FundTransfer> {
  protected repository: FundTransferRepository;
  protected uniqueFields: (keyof FundTransfer)[] = ["code"];
  constructor(
    @inject(FUND_TRANSFER_TYPES.Repository) repository: FundTransferRepository,
  ) {
    super();
    this.repository = repository;
  }
  async validateBeforeCreate(
    data: DeepPartial<FundTransfer>,
    _manager: EntityManager,
    _req?: RequestContext,
  ): Promise<void> {}
}
