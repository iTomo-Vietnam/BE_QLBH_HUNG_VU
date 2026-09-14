import { Entity, Column, Index, ManyToOne, JoinColumn } from "typeorm";
import { BaseEntity } from "@/shared/base/BaseEntity";
import { User } from "./User";

export enum ActionType {
  CREATE = "create",
  UPDATE = "update",
  DELETE = "delete",
  PENDING = "pending",
  APPROVE = "approve",
  REJECT = "reject",
  FAILED = "failed",
  UNFIXED = "unfixed",
  DAILY_WARNING = "daily_warning",
  REPLY = "reply",
  NOTIFICATION = "notification",
  REMINDER = "reminder",
  ASSIGN = "assign",
  COMPLETE = "complete",
  CANCEL = "cancel",
}
export enum NotificationType {
  SYSTEM = "system",
  USER = "user",
  ORDER = "order",
  ORDER_LINE = "order_line",
  PRODUCTION = "production",
  STOCK_DOCUMENT = "stockDocument",
  // Approval modules
  QUOTATION_REQUEST = "quotationRequest",
  QUOTATION = "quotation",
  PURCHASE_REQUISITION = "purchaseRequisition",
  PURCHASE_QUOTATION = "purchaseQuotation",
  PURCHASE = "purchase",
  SHIPPING_PLAN = "shippingPlan",
  PAYMENT_REQUEST = "paymentRequest",
  STORE_WORKDAY = "storeWorkday",
  STORE_TRANSFER = "storeTransfer",
}

@Index("IDX_notifications_userId", ["userId"])
@Index("IDX_notifications_read", ["isRead"])
@Index("IDX_notifications_type", ["type"])
@Entity("notifications")
export class Notification extends BaseEntity {
  // ============================== FIELDS ==============================
  @Column({ type: "uuid" })
  userId: string; // FK - Người nhận thông báo

  @Column({ type: "varchar", length: 50 })
  type: NotificationType; // Loại thông báo

  @Column({
    type: "varchar",
    enum: ActionType,
    nullable: true,
    default: null,
  })
  action: ActionType | null;

  @Column({ type: "varchar", length: 255 })
  title: string; // Tiêu đề

  @Column({ type: "text" })
  body: string; // Nội dung

  @Column({ type: "jsonb", nullable: true, default: null })
  data?: Record<string, unknown> | null; // Dữ liệu kèm theo (entityType, entityId, ...)

  @Column({ type: "boolean", default: false })
  isRead: boolean; // Đã đọc?

  @Column({ type: "timestamptz", nullable: true, default: null })
  readAt?: Date | null; // Thời điểm đọc

  @Column({ type: "varchar", length: 100, nullable: true, default: null })
  entityType?: string | null; // Loại đối tượng liên quan (WorkOrder, Machine, ...)

  @Column({ type: "uuid", nullable: true, default: null })
  entityId?: string | null; // ID đối tượng liên quan

  // ============================== RELATIONSHIPS ==============================
  @ManyToOne(() => User, { nullable: true, onDelete: "CASCADE" })
  @JoinColumn({ name: "userId" })
  user?: User; // Người nhận
}
