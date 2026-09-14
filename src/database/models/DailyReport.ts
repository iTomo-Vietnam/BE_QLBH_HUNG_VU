import { Column, Entity } from "typeorm";
import { UserSnapshot } from "@/shared/base/BaseEntity";
import { StoreEntity } from "./store/StoreEntity";
import { FundSnapshot } from "./Fund";

export enum DailyReportStatus {
  ACTIVE = "active",
  CANCELED = "canceled",
}

export type DailyPaymentMethod = "DEBT" | "CASH" | "BANK" | "COMBINED";

export interface DailyPaymentSnapshot {
  amount: number;
  fundId: string | null;
  fundSnapshot: FundSnapshot | null;
}

export interface DailyOrderSnapshot {
  id: string;
  type: string;
  code: string;
  occurredAt: Date | string;
  partnerId: string | null;
  partnerName: string | null;
  paymentMethod: DailyPaymentMethod;
  totalAmount: number;
  paidAmount: number;
  debtAmount: number;
  payments: DailyPaymentSnapshot[];
}

export interface DailyIncomeExpenseSnapshot {
  id: string;
  type: "INCOME" | "EXPENSE";
  code: string;
  occurredAt: Date | string;
  categoryId: string | null;
  categoryName: string | null;
  description: string | null;
  note: string | null;
  partnerId: string | null;
  partnerName: string | null;
  fundId: string | null;
  fundSnapshot: FundSnapshot | null;
  amount: number;
}

export interface DailyTransferNoteSnapshot {
  id: string;
  occurredAt: Date | string;
  referenceCode: string;
  creatorId: string | null;
  creatorSnapshot: UserSnapshot | null;
  fundId: string;
  fundSnapshot: FundSnapshot | null;
  amount: number;
  status: string;
  invalidReason: string | null;
  note: string | null;
}

export interface DailyReportSummary {
  orderCount: number;
  orderTotalAmount: number;
  orderPaidAmount: number;
  orderDebtAmount: number;
  expenseCashAmount: number;
  expenseBankAmount: number;
  expenseTotalAmount: number;
  debtIncomeCashAmount: number;
  debtIncomeBankAmount: number;
  debtIncomeTotalAmount: number;
  transferNoteValidAmount: number;
  transferNoteInvalidAmount: number;
}

@Entity("daily_reports")
export class DailyReport extends StoreEntity {
  @Column({ type: "date" })
  reportDate: string;

  @Column({
    type: "enum",
    enum: DailyReportStatus,
    default: DailyReportStatus.ACTIVE,
  })
  status: DailyReportStatus;

  @Column({ type: "jsonb", default: () => "'[]'" })
  orderSnapshots: DailyOrderSnapshot[];

  @Column({ type: "jsonb", default: () => "'[]'" })
  expenseSnapshots: DailyIncomeExpenseSnapshot[];

  @Column({ type: "jsonb", default: () => "'[]'" })
  debtIncomeSnapshots: DailyIncomeExpenseSnapshot[];

  @Column({ type: "jsonb", default: () => "'[]'" })
  transferNoteSnapshots: DailyTransferNoteSnapshot[];

  @Column({ type: "jsonb", default: () => "'{}'" })
  summary: DailyReportSummary;

  @Column({ type: "timestamptz", default: () => "CURRENT_TIMESTAMP" })
  capturedAt: Date;

  @Column({ type: "timestamptz", nullable: true, default: null })
  canceledAt: Date | null;
}
