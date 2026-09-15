import { inject, injectable } from "inversify";
import { DeepPartial, EntityManager, In, IsNull, Not } from "typeorm";
import { appDayjs } from "@/shared/utils/dayjs.util";
import { BadRequestError } from "@/shared/types/errors";
import { RequestContext } from "@/shared/types/interfaces";
import { Fund, FundType } from "@/database/models/Fund";
import {
  IncomeExpense,
  IncomeExpenseStatus,
  IncomeExpenseType,
} from "@/database/models/store/IncomeExpense";
import { Order, OrderStatus, OrderType } from "@/database/models/store/Order";
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

  private isSameAmount(left: unknown, right: unknown): boolean {
    return Math.abs(Number(left || 0) - Number(right || 0)) <= 0.01;
  }

  private async resolveStatus(
    data: DeepPartial<TransferNote>,
    manager: EntityManager,
  ): Promise<{ status: TransferNoteStatus; invalidReason: string | null }> {
    const storeId = data.storeId;
    const referenceCode = data.referenceCode?.trim();
    const fundId = data.fundId;
    const amount = Number(data.amount || 0);
    if (!storeId || !referenceCode || !fundId || amount <= 0) {
      return {
        status: TransferNoteStatus.INVALID,
        invalidReason: "Thiếu thông tin đối soát",
      };
    }

    const orderRepository = manager.getRepository(Order);
    const incomeExpenseRepository = manager.getRepository(IncomeExpense);
    const orderCandidates = await orderRepository.find({
      where: {
        storeId,
        code: referenceCode,
        type: In([OrderType.SALE, OrderType.SALE_RETURN]),
        deletedAt: IsNull(),
      } as any,
    });
    const incomeCandidates = await incomeExpenseRepository.find({
      where: {
        storeId,
        code: referenceCode,
        type: IncomeExpenseType.INCOME,
        orderId: IsNull(),
        deletedAt: IsNull(),
      } as any,
      relations: { fund: true },
    });

    if (!orderCandidates.length && !incomeCandidates.length) {
      return {
        status: TransferNoteStatus.INVALID,
        invalidReason: "Không tìm thấy phiếu tương ứng",
      };
    }

    const completedOrders = orderCandidates.filter(
      (item) => item.status === OrderStatus.COMPLETED,
    );
    const completedIncome = incomeCandidates.filter(
      (item) => item.status === IncomeExpenseStatus.COMPLETED,
    );
    if (!completedOrders.length && !completedIncome.length) {
      return {
        status: TransferNoteStatus.INVALID,
        invalidReason: "Phiếu tương ứng chưa hoàn thành",
      };
    }

    let hasBankPayment = false;
    let hasMatchingFund = false;

    for (const order of completedOrders) {
      const payments = await incomeExpenseRepository.find({
        where: {
          orderId: order.id,
          status: Not(IncomeExpenseStatus.CANCELED),
          deletedAt: IsNull(),
        } as any,
        relations: { fund: true },
      });
      const paymentTypes =
        order.type === OrderType.SALE
          ? [IncomeExpenseType.INCOME]
          : [IncomeExpenseType.INCOME, IncomeExpenseType.EXPENSE];
      const bankPayments = payments.filter(
        (item) =>
          paymentTypes.includes(item.type) && item.fund?.type === FundType.BANK,
      );
      if (!bankPayments.length) continue;
      hasBankPayment = true;

      for (const payment of bankPayments) {
        if (payment.fundId !== fundId) continue;
        hasMatchingFund = true;
        if (this.isSameAmount(payment.amount, amount)) {
          return { status: TransferNoteStatus.VALID, invalidReason: null };
        }
      }
    }

    for (const income of completedIncome) {
      if (income.fund?.type !== FundType.BANK) continue;
      hasBankPayment = true;
      if (income.fundId !== fundId) continue;
      hasMatchingFund = true;
      if (this.isSameAmount(income.amount, amount)) {
        return { status: TransferNoteStatus.VALID, invalidReason: null };
      }
    }

    if (!hasBankPayment) {
      return {
        status: TransferNoteStatus.INVALID,
        invalidReason: "Phương thức thanh toán không phải chuyển khoản",
      };
    }
    if (!hasMatchingFund) {
      return {
        status: TransferNoteStatus.INVALID,
        invalidReason: "Quỹ nhận không trùng khớp",
      };
    }
    return {
      status: TransferNoteStatus.INVALID,
      invalidReason: "Số tiền không trùng khớp",
    };
  }

  async revalidateByReferenceCode(
    storeId: string,
    referenceCode: string,
    manager: EntityManager,
  ): Promise<void> {
    const normalizedCode = referenceCode?.trim();
    if (!storeId || !normalizedCode) return;

    const notes = await this.repository.getRepository(manager).find({
      where: {
        storeId,
        referenceCode: normalizedCode,
        deletedAt: IsNull(),
      } as any,
    });
    for (const note of notes) {
      const result = await this.resolveStatus(note, manager);
      if (note.status === result.status && note.invalidReason === result.invalidReason) {
        continue;
      }
      await this.repository.getRepository(manager).update(note.id, result);
    }
  }

  async validateBeforeCreate(
    data: DeepPartial<TransferNote>,
    manager: EntityManager,
    req?: RequestContext,
  ): Promise<void> {
    data.storeId = data.storeId || req?.storeContext?.storeId;
    data.occurredAt = this.assertCurrentDate(data.occurredAt as Date | string | undefined);
    await this.attachFund(data, manager);
    const result = await this.resolveStatus(data, manager);
    data.status = result.status;
    data.invalidReason = result.invalidReason;
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
    const merged = { ...current, ...data } as DeepPartial<TransferNote>;
    const result = await this.resolveStatus(merged, manager);
    data.status = result.status;
    data.invalidReason = result.invalidReason;
  }
}
