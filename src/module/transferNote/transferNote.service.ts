import { inject, injectable } from "inversify";
import { DeepPartial, EntityManager } from "typeorm";
import { appDayjs } from "@/shared/utils/dayjs.util";
import { BadRequestError } from "@/shared/types/errors";
import { RequestContext } from "@/shared/types/interfaces";
import { Fund, FundType } from "@/database/models/Fund";
import {
  TransferNote,
  TransferNoteStatus,
} from "@/database/models/TransferNote";
import { BaseService } from "@/shared/base/BaseService";
import { FundRepository } from "../fund/fund.repository";
import { FUND_TYPES } from "../fund/fund.types";
import { TransferNoteRepository } from "./transferNote.repository";
import { TRANSFER_NOTE_TYPES } from "./transferNote.types";

@injectable()
export class TransferNoteService extends BaseService<TransferNote> {
  protected repository: TransferNoteRepository;
  protected searchableFields = ["referenceCode", "note", "invalidReason"];
  protected timeField: keyof TransferNote = "occurredAt";

  constructor(
    @inject(TRANSFER_NOTE_TYPES.Repository) repository: TransferNoteRepository,
    @inject(FUND_TYPES.Repository) private fundRepository: FundRepository,
  ) {
    super();
    this.repository = repository;
  }

  private assertCurrentDate(occurredAt: Date | string | undefined): Date {
    const value = occurredAt ? new Date(occurredAt) : new Date();
    if (Number.isNaN(value.getTime()) || !appDayjs(value).isSame(appDayjs(), "day")) {
      throw new BadRequestError("transferNote.only_current_date");
    }
    return value;
  }

  private async attachFund(
    data: DeepPartial<TransferNote>,
    manager: EntityManager,
  ): Promise<void> {
    if (!data.fundId) throw new BadRequestError("transferNote.fund.required");
    if (!data.storeId) throw new BadRequestError("store.required");

    const fund = await manager.getRepository(Fund).findOne({
      where: { id: data.fundId, storeId: data.storeId, deletedAt: null } as any,
    });
    if (!fund) throw new BadRequestError("transferNote.fund.not_found");
    if (fund.type !== FundType.BANK) {
      throw new BadRequestError("transferNote.fund.bank_required");
    }
    await this.fundRepository.attachInfo(data, manager);
  }

  private validateStatus(data: DeepPartial<TransferNote>): void {
    const status = data.status || TransferNoteStatus.VALID;
    if (status === TransferNoteStatus.INVALID && !data.invalidReason?.trim()) {
      throw new BadRequestError("transferNote.invalid_reason.required");
    }
    if (status === TransferNoteStatus.VALID) data.invalidReason = null;
  }

  async validateBeforeCreate(
    data: DeepPartial<TransferNote>,
    manager: EntityManager,
    req?: RequestContext,
  ): Promise<void> {
    data.storeId = data.storeId || req?.storeContext?.storeId;
    data.occurredAt = this.assertCurrentDate(data.occurredAt as Date | string | undefined);
    this.validateStatus(data);
    await this.attachFund(data, manager);
  }

  async validateBeforeUpdate(
    id: string,
    data: DeepPartial<TransferNote>,
    manager: EntityManager,
    req?: RequestContext,
  ): Promise<void> {
    const current = await this.getById(id, req, manager);
    if (data.occurredAt !== undefined) {
      data.occurredAt = this.assertCurrentDate(data.occurredAt as Date | string);
    }
    data.storeId = current.storeId;
    if (data.fundId !== undefined || !current.fundSnapshot) {
      await this.attachFund({ ...current, ...data }, manager);
      data.fundSnapshot = (await this.fundRepository.getSnapshot(data.fundId || current.fundId, manager)) as any;
    }
    this.validateStatus({ ...current, ...data });
    if (data.status === TransferNoteStatus.VALID) data.invalidReason = null;
  }
}
