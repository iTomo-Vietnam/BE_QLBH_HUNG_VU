import { BaseEntity, UserSnapshot } from "@/shared/base/BaseEntity";
import { Column, Entity, JoinColumn, ManyToOne, OneToMany } from "typeorm";
import { StoreTransferLine } from "./StoreTransferLine";
import { Store, StoreSnapshot } from "./Store";
import { User } from "./User";

export enum StoreTransferStatus {
  PLANNED = "planned",
  EXPORTED = "exported",
  IMPORTED = "imported",
  CANCELED = "canceled",
}

@Entity("store_transfers")
export class StoreTransfer extends BaseEntity {
  @Column({ type: "timestamptz", default: () => "CURRENT_TIMESTAMP" })
  occurredAt: Date;

  /** Thời điểm lập kế hoạch chuyển kho. Các mốc xuất/nhập/hủy nằm ở các field bên dưới. */
  @Column({
    type: "enum",
    enum: StoreTransferStatus,
    default: StoreTransferStatus.PLANNED,
  })
  status: StoreTransferStatus;

  @Column({ type: "timestamptz", nullable: true, default: null })
  exportedAt: Date | null;
  @Column({ type: "uuid", nullable: true, default: null })
  exporterId: string | null;
  @Column({ type: "jsonb", nullable: true, default: null })
  exporterSnapshot: UserSnapshot | null;
  @ManyToOne(() => User, { onDelete: "SET NULL" })
  @JoinColumn({ name: "exporterId" })
  exporter: User | null;

  @Column({ type: "timestamptz", nullable: true, default: null })
  importedAt: Date | null;
  @Column({ type: "uuid", nullable: true, default: null })
  importerId: string | null;
  @Column({ type: "jsonb", nullable: true, default: null })
  importerSnapshot: UserSnapshot | null;
  @ManyToOne(() => User, { onDelete: "SET NULL" })
  @JoinColumn({ name: "importerId" })
  importer: User | null;

  @Column({ type: "timestamptz", nullable: true, default: null })
  canceledAt: Date | null;
  @Column({ type: "uuid", nullable: true, default: null })
  cancelerId: string | null;
  @Column({ type: "jsonb", nullable: true, default: null })
  cancelerSnapshot: UserSnapshot | null;
  @ManyToOne(() => User, { onDelete: "SET NULL" })
  @JoinColumn({ name: "cancelerId" })
  canceler: User | null;

  @Column({ type: "varchar", length: 50 })
  code: string;

  @Column({ type: "uuid", nullable: true, default: null })
  fromStoreId: string | null;
  @Column({ type: "jsonb", nullable: true, default: null })
  fromStoreSnapshot: StoreSnapshot | null;
  @ManyToOne(() => Store, { onDelete: "SET NULL" })
  @JoinColumn({ name: "fromStoreId" })
  fromStore: Store | null;

  @Column({ type: "uuid", nullable: true, default: null })
  toStoreId: string | null;
  @Column({ type: "jsonb", nullable: true, default: null })
  toStoreSnapshot: StoreSnapshot | null;
  @ManyToOne(() => Store, {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "toStoreId" })
  toStore: Store;

  @Column({ type: "text", nullable: true })
  reason: string | null;

  @OneToMany(() => StoreTransferLine, (line) => line.transfer, {
    cascade: true,
  })
  lines: StoreTransferLine[];
}
