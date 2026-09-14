import { inject, injectable } from "inversify";
import {
  Between,
  DeepPartial,
  EntityManager,
  In,
  IsNull,
} from "typeorm";
import { appDayjs } from "@/shared/utils/dayjs.util";
import { BadRequestError } from "@/shared/types/errors";
import { RequestContext } from "@/shared/types/interfaces";
import {
  DailyIncomeExpenseSnapshot,
  DailyOrderSnapshot,
  DailyPaymentMethod,
  DailyPaymentSnapshot,
  DailyReport,
  DailyReportStatus,
  DailyReportSummary,
  DailyTransferNoteSnapshot,
} from "@/database/models/DailyReport";
import {
  IncomeExpense,
  IncomeExpenseStatus,
  IncomeExpenseType,
} from "@/database/models/store/IncomeExpense";
import {
  Order,
  OrderStatus,
  OrderType,
} from "@/database/models/store/Order";
import { Fund, FundType, FundSnapshot } from "@/database/models/Fund";
import { TransferNote } from "@/database/models/TransferNote";
import { BaseService } from "@/shared/base/BaseService";
import { DailyReportRepository } from "./dailyReport.repository";
import { DAILY_REPORT_TYPES } from "./dailyReport.types";

type SnapshotData = Pick<
  DailyReport,
  | "reportDate"
  | "orderSnapshots"
  | "expenseSnapshots"
  | "debtIncomeSnapshots"
  | "transferNoteSnapshots"
  | "summary"
>;

@injectable()
export class DailyReportService extends BaseService<DailyReport> {
  protected repository: DailyReportRepository;
  protected timeField: keyof DailyReport = "reportDate";
  protected searchableFields = ["reportDate"];

  constructor(
    @inject(DAILY_REPORT_TYPES.Repository) repository: DailyReportRepository,
  ) {
    super();
    this.repository = repository;
  }

  private getReportDate(value?: string | Date): string {
    return appDayjs(value || undefined).format("YYYY-MM-DD");
  }

  private getDateRange(reportDate: string): { start: Date; end: Date } {
    return {
      start: appDayjs(reportDate).startOf("day").toDate(),
      end: appDayjs(reportDate).endOf("day").toDate(),
    };
  }

  private fundSnapshot(fund?: Fund | null, fallback?: FundSnapshot | null): FundSnapshot | null {
    if (fallback) return fallback as FundSnapshot;
    if (!fund) return null;
    return {
      id: fund.id,
      code: fund.code,
      name: fund.name,
      type: fund.type,
      storeId: fund.storeId,
      isPersonal: fund.isPersonal,
    };
  }

  private getPaymentMethod(
    totalAmount: number,
    payments: DailyPaymentSnapshot[],
  ): { method: DailyPaymentMethod; paidAmount: number; debtAmount: number } {
    const paidAmount = payments.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const debtAmount = Math.max(Number(totalAmount || 0) - paidAmount, 0);
    if (debtAmount > 0.009) {
      return { method: "DEBT", paidAmount, debtAmount };
    }

    const hasCash = payments.some((item) => item.fundSnapshot?.type === FundType.CASH);
    const hasBank = payments.some((item) => item.fundSnapshot?.type === FundType.BANK);
    const method: DailyPaymentMethod = hasCash && hasBank
      ? "COMBINED"
      : hasBank
        ? "BANK"
        : "CASH";
    return { method, paidAmount, debtAmount };
  }

  private toOrderSnapshot(order: Order): DailyOrderSnapshot {
    const paymentType = order.type === OrderType.SALE_RETURN
      ? IncomeExpenseType.EXPENSE
      : IncomeExpenseType.INCOME;
    const payments = (order.incomeExpenses || [])
      .filter((item) => item.status !== IncomeExpenseStatus.CANCELED && item.type === paymentType)
      .map((item): DailyPaymentSnapshot => ({
        amount: Number(item.amount || 0),
        fundId: item.fundId,
        fundSnapshot: this.fundSnapshot(item.fund, item.fundSnapshot),
      }));
    const payment = this.getPaymentMethod(Number(order.totalAmount || 0), payments);

    return {
      id: order.id,
      type: order.type,
      code: order.code,
      occurredAt: order.occurredAt || order.orderAt,
      partnerId: order.partnerId,
      partnerName: order.partner?.name || order.partnerSnapshot?.name || null,
      paymentMethod: payment.method,
      totalAmount: Number(order.totalAmount || 0),
      paidAmount: payment.paidAmount,
      debtAmount: payment.debtAmount,
      payments,
    };
  }

  private toIncomeExpenseSnapshot(item: IncomeExpense): DailyIncomeExpenseSnapshot {
    return {
      id: item.id,
      type: item.type,
      code: item.code,
      occurredAt: item.occurredAt,
      categoryId: item.categoryId,
      categoryName: item.category?.name || item.categorySnapshot?.name || null,
      description: item.description,
      note: item.note || null,
      partnerId: item.partnerId,
      partnerName: item.partner?.name || item.partnerSnapshot?.name || null,
      fundId: item.fundId,
      fundSnapshot: this.fundSnapshot(item.fund, item.fundSnapshot),
      amount: Number(item.amount || 0),
    };
  }

  private toTransferNoteSnapshot(item: TransferNote): DailyTransferNoteSnapshot {
    return {
      id: item.id,
      occurredAt: item.occurredAt,
      referenceCode: item.referenceCode,
      creatorId: item.creatorId,
      creatorSnapshot: item.creatorSnapshot,
      fundId: item.fundId,
      fundSnapshot: this.fundSnapshot(item.fund, item.fundSnapshot),
      amount: Number(item.amount || 0),
      status: item.status,
      invalidReason: item.invalidReason,
      note: item.note || null,
    };
  }

  private getFundAmount(
    items: DailyIncomeExpenseSnapshot[],
    type: FundType,
  ): number {
    return items.reduce(
      (sum, item) => sum + (item.fundSnapshot?.type === type ? item.amount : 0),
      0,
    );
  }

  private buildSummary(
    orders: DailyOrderSnapshot[],
    expenses: DailyIncomeExpenseSnapshot[],
    debtIncome: DailyIncomeExpenseSnapshot[],
    transferNotes: DailyTransferNoteSnapshot[],
  ): DailyReportSummary {
    return {
      orderCount: orders.length,
      orderTotalAmount: orders.reduce((sum, item) => sum + item.totalAmount, 0),
      orderPaidAmount: orders.reduce((sum, item) => sum + item.paidAmount, 0),
      orderDebtAmount: orders.reduce((sum, item) => sum + item.debtAmount, 0),
      expenseCashAmount: this.getFundAmount(expenses, FundType.CASH),
      expenseBankAmount: this.getFundAmount(expenses, FundType.BANK),
      expenseTotalAmount: expenses.reduce((sum, item) => sum + item.amount, 0),
      debtIncomeCashAmount: this.getFundAmount(debtIncome, FundType.CASH),
      debtIncomeBankAmount: this.getFundAmount(debtIncome, FundType.BANK),
      debtIncomeTotalAmount: debtIncome.reduce((sum, item) => sum + item.amount, 0),
      transferNoteValidAmount: transferNotes
        .filter((item) => item.status === "valid")
        .reduce((sum, item) => sum + item.amount, 0),
      transferNoteInvalidAmount: transferNotes
        .filter((item) => item.status !== "valid")
        .reduce((sum, item) => sum + item.amount, 0),
    };
  }

  async buildSnapshot(storeId: string, value?: string | Date, manager?: EntityManager): Promise<SnapshotData> {
    const reportDate = this.getReportDate(value);
    const { start, end } = this.getDateRange(reportDate);
    const em = manager || this.repository.getRepository().manager;

    const orders = await em
      .getRepository(Order)
      .createQueryBuilder("order")
      .leftJoinAndSelect("order.partner", "partner")
      .leftJoinAndSelect(
        "order.incomeExpenses",
        "orderIncomeExpense",
        '"orderIncomeExpense"."deletedAt" IS NULL',
      )
      .leftJoinAndSelect("orderIncomeExpense.fund", "orderFund")
      .where('"order"."storeId" = :storeId', { storeId })
      .andWhere('"order"."deletedAt" IS NULL')
      .andWhere('"order"."status" = :completed', { completed: OrderStatus.COMPLETED })
      .andWhere(
        'COALESCE("order"."occurredAt", "order"."orderAt") BETWEEN :start AND :end',
        { start, end },
      )
      .andWhere('"order"."type" IN (:...orderTypes)', {
        orderTypes: [OrderType.SALE, OrderType.SALE_RETURN],
      })
      .orderBy('COALESCE("order"."occurredAt", "order"."orderAt")', "ASC")
      .getMany();

    const incomeExpenses = await em
      .getRepository(IncomeExpense)
      .createQueryBuilder("incomeExpense")
      .leftJoinAndSelect("incomeExpense.fund", "fund")
      .leftJoinAndSelect("incomeExpense.category", "category")
      .leftJoinAndSelect("incomeExpense.partner", "partner")
      .where('"incomeExpense"."storeId" = :storeId', { storeId })
      .andWhere('"incomeExpense"."deletedAt" IS NULL')
      .andWhere('"incomeExpense"."status" = :status', {
        status: IncomeExpenseStatus.COMPLETED,
      })
      .andWhere('"incomeExpense"."orderId" IS NULL')
      .andWhere('"incomeExpense"."occurredAt" BETWEEN :start AND :end', { start, end })
      .andWhere(
        '(("incomeExpense"."type" = :expense AND "incomeExpense"."partnerId" IS NULL) OR ("incomeExpense"."type" = :income AND "incomeExpense"."partnerId" IS NOT NULL))',
        { expense: IncomeExpenseType.EXPENSE, income: IncomeExpenseType.INCOME },
      )
      .orderBy('"incomeExpense"."occurredAt"', "ASC")
      .getMany();

    const transferNotes = await em
      .getRepository(TransferNote)
      .createQueryBuilder("transferNote")
      .leftJoinAndSelect("transferNote.fund", "fund")
      .where('"transferNote"."storeId" = :storeId', { storeId })
      .andWhere('"transferNote"."deletedAt" IS NULL')
      .andWhere('"transferNote"."occurredAt" BETWEEN :start AND :end', { start, end })
      .orderBy('"transferNote"."occurredAt"', "ASC")
      .getMany();

    const orderSnapshots = orders.map((item) => this.toOrderSnapshot(item));
    const expenseSnapshots = incomeExpenses
      .filter((item) => item.type === IncomeExpenseType.EXPENSE)
      .map((item) => this.toIncomeExpenseSnapshot(item));
    const debtIncomeSnapshots = incomeExpenses
      .filter((item) => item.type === IncomeExpenseType.INCOME)
      .map((item) => this.toIncomeExpenseSnapshot(item));
    const transferNoteSnapshots = transferNotes.map((item) => this.toTransferNoteSnapshot(item));

    return {
      reportDate,
      orderSnapshots,
      expenseSnapshots,
      debtIncomeSnapshots,
      transferNoteSnapshots,
      summary: this.buildSummary(
        orderSnapshots,
        expenseSnapshots,
        debtIncomeSnapshots,
        transferNoteSnapshots,
      ),
    };
  }

  async getCurrent(storeId: string, value?: string | Date, manager?: EntityManager): Promise<DailyReport> {
    const reportDate = this.getReportDate(value);
    const active = await this.repository.getRepository(manager).findOne({
      where: {
        storeId,
        reportDate,
        status: DailyReportStatus.ACTIVE,
        deletedAt: IsNull(),
      } as any,
    });
    if (active) return active;

    return {
      ...(await this.buildSnapshot(storeId, reportDate, manager)),
      id: "",
      tempId: "",
      storeId,
      status: DailyReportStatus.ACTIVE,
      capturedAt: new Date(),
      canceledAt: null,
    } as DailyReport;
  }

  async validateBeforeCreate(
    data: DeepPartial<DailyReport>,
    manager: EntityManager,
    req?: RequestContext,
  ): Promise<void> {
    const storeId = data.storeId || req?.storeContext?.storeId;
    if (!storeId) throw new BadRequestError("store.required");
    const reportDate = this.getReportDate(data.reportDate);
    if (reportDate !== this.getReportDate()) {
      throw new BadRequestError("dailyReport.only_current_date");
    }

    const active = await manager.getRepository(DailyReport).findOne({
      where: { storeId, reportDate, status: DailyReportStatus.ACTIVE, deletedAt: IsNull() } as any,
    });
    if (active) throw new BadRequestError("dailyReport.active_exists");

    const snapshot = await this.buildSnapshot(storeId, reportDate, manager);
    Object.assign(data, snapshot, {
      storeId,
      reportDate,
      status: DailyReportStatus.ACTIVE,
      capturedAt: new Date(),
      canceledAt: null,
    });
  }

  async validateBeforeUpdate(
    id: string,
    data: DeepPartial<DailyReport>,
    manager: EntityManager,
    req?: RequestContext,
  ): Promise<void> {
    const current = await this.getById(id, req, manager);
    if (data.reportDate && data.reportDate !== current.reportDate) {
      throw new BadRequestError("dailyReport.date_immutable");
    }
    if (data.status && data.status !== DailyReportStatus.CANCELED) {
      throw new BadRequestError("dailyReport.status_invalid");
    }
    data.storeId = current.storeId;
    if (data.status === DailyReportStatus.CANCELED) data.canceledAt = new Date();
  }

  async cancel(id: string, req?: RequestContext): Promise<DailyReport | null> {
    const current = await this.getById(id, req);
    if (current.status !== DailyReportStatus.ACTIVE) {
      throw new BadRequestError("dailyReport.not_active");
    }
    return this.update(id, { status: DailyReportStatus.CANCELED }, undefined, req);
  }
}
