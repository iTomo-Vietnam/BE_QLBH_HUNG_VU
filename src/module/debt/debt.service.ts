import { inject, injectable } from "inversify";
import { EntityManager, In, IsNull, LessThanOrEqual } from "typeorm";
import {
  DebtRefType,
  DebtTransaction,
  Partner,
} from "@/database/models";
import { DebtSide, TransactionType } from "@/shared/constants/enum";
import { TransactionService } from "@/shared/base/TransactionService";
import { ApiResponse } from "@/shared/types/interfaces";
import { FileHelper } from "@/shared/utils/file.helper";
import { PARTNER_TYPES } from "../partner/partner.types";
import { PartnerRepository } from "../partner/partner.repository";
import { DEBT_TRANSACTION_TYPES } from "../debtTransaction/debtTransaction.types";
import { DebtTransactionRepository } from "../debtTransaction/debtTransaction.repository";
import { DEBT_ADJUSTMENT_TYPES } from "../debtAdjustment/debtAdjustment.types";
import { DebtAdjustmentRepository } from "../debtAdjustment/debtAdjustment.repository";
import {
  GetPartnerDebtReportQueryDto,
  GetTransactionDetailsQueryDto,
} from "./debt.validator";

export interface DebtBalance {
  receivable: number;
  payable: number;
}

interface DebtLedgerRow {
  id: string;
  occurredAt: Date;
  createdAt?: Date | null;
  partnerId: string;
  side: DebtSide;
  type: TransactionType;
  amount: number;
  refType: string;
  refId: string;
  refCode?: string | null;
  note?: string | null;
}

interface DebtReportRow extends Omit<Partial<Partner>, "id"> {
  id: string;
  openingAmount: number;
  inAmount: number;
  outAmount: number;
  closingAmount: number;
}

/**
 * Báo cáo công nợ và các phép tổng hợp trên sổ phát sinh.
 *
 * Module này chỉ đọc dữ liệu và extends TransactionService, tương tự
 * inventory. Các bút toán bất biến nằm trong module debtTransaction.
 */
@injectable()
export class DebtService extends TransactionService {
  constructor(
    @inject(DEBT_TRANSACTION_TYPES.Repository)
    private transactionRepository: DebtTransactionRepository,
    @inject(DEBT_ADJUSTMENT_TYPES.Repository)
    private debtAdjustmentRepository: DebtAdjustmentRepository,
    @inject(PARTNER_TYPES.PartnerRepository)
    private partnerRepository: PartnerRepository,
  ) {
    super();
  }

  async getPartnerDebtReport(
    params: GetPartnerDebtReportQueryDto,
  ): Promise<ApiResponse<DebtReportRow[]>> {
    const manager = await this.getManager();
    const page = Math.max(1, Number(params.page) || 1);
    const size = Math.max(1, Number(params.size) || 20);
    const side = params.side || DebtSide.RECEIVABLE;
    const startAt = this.toDate(params.startAt, new Date(0));
    const endAt = this.toDate(params.endAt, new Date());

    const partnersResult = await this.partnerRepository.findWithPagination(
      {
        skip: 1,
        take: 999999,
        ids: params.partnerIds,
        keyword: params.keyword,
        searchFields: [
          "name",
          "code",
          "email",
          "phone",
          "taxCode",
          "note",
          "group.name",
        ],
        moreQuery: params,
      },
      manager,
    );

    const partnerIds = partnersResult.data.map((partner) => partner.id);
    const ledger = await this.getLedgerRows(partnerIds, side, endAt, manager);

    const rows = new Map<string, DebtReportRow>();
    for (const partner of partnersResult.data) {
      rows.set(partner.id, {
        id: partner.id,
        code: partner.code,
        name: partner.name,
        type: partner.type,
        phone: partner.phone,
        groupId: partner.groupId,
        group: partner.group,
        openingAmount: 0,
        inAmount: 0,
        outAmount: 0,
        closingAmount: 0,
      });
    }

    for (const row of ledger) {
      const report = rows.get(row.partnerId);
      if (!report || !this.matchesRefType(row.refType, params.refType)) {
        continue;
      }

      if (row.occurredAt < startAt) {
        report.openingAmount += this.signedAmount(row);
      } else if (row.occurredAt <= endAt) {
        if (row.type === TransactionType.IN) {
          report.inAmount += Math.abs(Number(row.amount) || 0);
        } else {
          report.outAmount += Math.abs(Number(row.amount) || 0);
        }
      }
    }

    let reportRows = [...rows.values()].map((row) => ({
      ...row,
      closingAmount: row.openingAmount + row.inAmount - row.outAmount,
    }));

    reportRows = this.applyReportRanges(reportRows, params as any);
    reportRows.sort((left, right) =>
      this.compareReportRows(left, right, params.sortBy, params.sortOrder),
    );

    const summary = reportRows.reduce(
      (result, row) => ({
        openingAmount: result.openingAmount + row.openingAmount,
        inAmount: result.inAmount + row.inAmount,
        outAmount: result.outAmount + row.outAmount,
        closingAmount: result.closingAmount + row.closingAmount,
      }),
      {
        openingAmount: 0,
        inAmount: 0,
        outAmount: 0,
        closingAmount: 0,
      },
    );

    const totalRecords = reportRows.length;
    const paginatedRows = reportRows.slice((page - 1) * size, page * size);
    const data = await FileHelper.attachFilesToEntities(paginatedRows);

    return {
      statusCode: 200,
      success: true,
      message: "Partner debt report fetched successfully",
      data: data as DebtReportRow[],
      pagination: {
        currentPage: page,
        size,
        totalRecords,
        totalPages: Math.ceil(totalRecords / size),
      },
      summary,
    };
  }

  async getTransactionDetails(
    params: GetTransactionDetailsQueryDto,
  ): Promise<ApiResponse<DebtTransaction[]>> {
    const manager = await this.getManager();
    const side = params.side || DebtSide.RECEIVABLE;
    const startAt = this.toDate(params.startAt, new Date(0));
    const endAt = this.toDate(params.endAt, new Date());
    const ledger = await this.getLedgerRows(
      [params.partnerId],
      side,
      endAt,
      manager,
    );

    const filteredLedger = ledger.filter((row) =>
      this.matchesRefType(row.refType, params.refType),
    );
    let openingAmount = 0;
    const periodRows: DebtLedgerRow[] = [];

    for (const row of filteredLedger) {
      if (row.occurredAt < startAt) {
        openingAmount += this.signedAmount(row);
      } else if (row.occurredAt <= endAt) {
        periodRows.push(row);
      }
    }

    let runningAmount = openingAmount;
    let inAmount = 0;
    let outAmount = 0;
    const details = periodRows.map((row) => {
      const amount = Math.abs(Number(row.amount) || 0);
      if (row.type === TransactionType.IN) {
        inAmount += amount;
        runningAmount += amount;
      } else {
        outAmount += amount;
        runningAmount -= amount;
      }

      return {
        ...row,
        amount,
        closingAmount: runningAmount,
      } as unknown as DebtTransaction;
    });

    const page = Math.max(1, Number(params.page) || 1);
    const size = Math.max(1, Number(params.size) || 20);
    const totalRecords = details.length;

    return {
      statusCode: 200,
      success: true,
      message: "Transaction details fetched successfully",
      data: details.slice((page - 1) * size, page * size),
      pagination: {
        currentPage: page,
        size,
        totalRecords,
        totalPages: Math.ceil(totalRecords / size),
      },
      summary: {
        openingAmount,
        inAmount,
        outAmount,
        closingAmount: openingAmount + inAmount - outAmount,
      },
    };
  }

  /**
   * Lấy công nợ của một đối tác tại một thời điểm.
   *
   * Bút toán có thời gian đúng bằng `atDate` được tính vào số dư, giống
   * cách tính của example/partnerDebt. `storeId` được giữ trong chữ ký để
   * tương thích với các nơi gọi cũ; debt_transactions hiện chưa phân tách
   * theo cửa hàng nên tham số này chưa cần áp dụng vào truy vấn.
   */
  async getDebtAtDate(
    partnerId: string,
    atDate: Date = new Date(),
    _storeId?: string,
    manager?: EntityManager,
    excludeId?: string,
  ): Promise<{
    payableDebtAmount: number;
    receivableDebtAmount: number;
  }> {
    const mainManager = manager || (await this.getManager());
    const [payableRows, receivableRows] = await Promise.all([
      this.getLedgerRows(
        [partnerId],
        DebtSide.PAYABLE,
        atDate,
        mainManager,
        excludeId,
      ),
      this.getLedgerRows(
        [partnerId],
        DebtSide.RECEIVABLE,
        atDate,
        mainManager,
        excludeId,
      ),
    ]);

    return {
      payableDebtAmount: payableRows.reduce(
        (total, row) => total + this.signedAmount(row),
        0,
      ),
      receivableDebtAmount: receivableRows.reduce(
        (total, row) => total + this.signedAmount(row),
        0,
      ),
    };
  }

  async getCurrentBalance(
    partnerId: string,
    manager?: EntityManager,
  ): Promise<DebtBalance> {
    const [receivableTransactions, payableTransactions] = await Promise.all([
      this.transactionRepository.getSignedAmount(
        partnerId,
        DebtSide.RECEIVABLE,
        manager,
      ),
      this.transactionRepository.getSignedAmount(
        partnerId,
        DebtSide.PAYABLE,
        manager,
      ),
    ]);

    const adjustmentRows = await this.debtAdjustmentRepository
      .getRepository(manager)
      .createQueryBuilder("adjustment")
      .select("adjustment.side", "side")
      .addSelect("COALESCE(SUM(adjustment.deltaAmount), 0)", "amount")
      .where("adjustment.partnerId = :partnerId", { partnerId })
      .andWhere("adjustment.deletedAt IS NULL")
      .groupBy("adjustment.side")
      .getRawMany<{ side: DebtSide; amount: string }>();

    const adjustments = { receivable: 0, payable: 0 };
    for (const row of adjustmentRows) {
      if (row.side === DebtSide.RECEIVABLE) {
        adjustments.receivable = Number(row.amount || 0);
      }
      if (row.side === DebtSide.PAYABLE) {
        adjustments.payable = Number(row.amount || 0);
      }
    }

    return {
      receivable: receivableTransactions + adjustments.receivable,
      payable: payableTransactions + adjustments.payable,
    };
  }

  private async getLedgerRows(
    partnerIds: string[],
    side: DebtSide,
    endAt: Date,
    manager: EntityManager,
    excludeId?: string,
  ): Promise<DebtLedgerRow[]> {
    if (partnerIds.length === 0) return [];

    const transactions = await this.transactionRepository
      .getRepository(manager)
      .find({
        where: {
          partnerId: In(partnerIds),
          side,
          occurredAt: LessThanOrEqual(endAt),
          deletedAt: IsNull(),
        } as any,
        order: { occurredAt: "ASC", createdAt: "ASC", id: "ASC" } as any,
      });

    const adjustments = await this.debtAdjustmentRepository
      .getRepository(manager)
      .find({
        where: {
          partnerId: In(partnerIds),
          side,
          occurredAt: LessThanOrEqual(endAt),
          deletedAt: IsNull(),
        } as any,
        order: { occurredAt: "ASC", createdAt: "ASC", id: "ASC" } as any,
      });

    const transactionRows: DebtLedgerRow[] = transactions.map((row) => ({
      id: row.id,
      occurredAt: row.occurredAt,
      createdAt: row.createdAt,
      partnerId: row.partnerId,
      side: row.side,
      type: row.type,
      amount: Number(row.amount) || 0,
      refType: row.refType,
      refId: row.refId,
      refCode: row.refCode,
      note: row.note,
    }));

    const adjustmentRows: DebtLedgerRow[] = adjustments
      .filter((row) => row.id !== excludeId)
      .map((row) => ({
        id: row.id,
        occurredAt: row.occurredAt,
        createdAt: row.createdAt,
        partnerId: row.partnerId as string,
        side: row.side,
        type:
          Number(row.deltaAmount) >= 0 ? TransactionType.IN : TransactionType.OUT,
        amount: Math.abs(Number(row.deltaAmount) || 0),
        refType: DebtRefType.ADJUSTMENT,
        refId: row.id,
        refCode: row.code,
        note: row.reason,
      }));

    return [...transactionRows, ...adjustmentRows].sort(
      (left, right) =>
        left.occurredAt.getTime() - right.occurredAt.getTime() ||
        (left.createdAt?.getTime() || 0) - (right.createdAt?.getTime() || 0) ||
        left.id.localeCompare(right.id),
    );
  }

  private signedAmount(row: Pick<DebtLedgerRow, "type" | "amount">): number {
    const amount = Math.abs(Number(row.amount) || 0);
    return row.type === TransactionType.IN ? amount : -amount;
  }

  private matchesRefType(rowRefType: string, filter?: string): boolean {
    if (!filter) return true;
    if (rowRefType === filter) return true;

    if (filter === "invoice") {
      return [
        DebtRefType.PURCHASE,
        DebtRefType.SALE,
        DebtRefType.PURCHASE_RETURN,
        DebtRefType.SALE_RETURN,
      ].includes(rowRefType as DebtRefType);
    }
    if (filter === "payment") {
      return [DebtRefType.INCOME, DebtRefType.EXPENSE].includes(
        rowRefType as DebtRefType,
      );
    }
    return false;
  }

  private applyReportRanges(
    rows: DebtReportRow[],
    params: Record<string, any>,
  ): DebtReportRow[] {
    const fields: (keyof DebtReportRow)[] = [
      "openingAmount",
      "inAmount",
      "outAmount",
      "closingAmount",
    ];

    return rows.filter((row) =>
      fields.every((field) => {
        const value = Number(row[field]) || 0;
        const gte = params[`${String(field)}Gte`];
        const lte = params[`${String(field)}Lte`];
        return (
          (gte == null || value >= Number(gte)) &&
          (lte == null || value <= Number(lte))
        );
      }),
    );
  }

  private compareReportRows(
    left: DebtReportRow,
    right: DebtReportRow,
    sortBy?: string,
    sortOrder?: "ASC" | "DESC",
  ): number {
    const field = sortBy || "name";
    const direction = sortOrder === "ASC" ? 1 : -1;
    const leftValue = (left as any)[field];
    const rightValue = (right as any)[field];

    if (typeof leftValue === "string" || typeof rightValue === "string") {
      return (
        String(leftValue || "").localeCompare(String(rightValue || ""), "vi") *
        direction
      );
    }
    return ((Number(leftValue) || 0) - (Number(rightValue) || 0)) * direction;
  }

  private toDate(value: Date | undefined, fallback: Date): Date {
    if (!value) return fallback;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? fallback : date;
  }
}

