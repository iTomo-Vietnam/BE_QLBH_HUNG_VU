import { Column, Entity, JoinColumn, ManyToOne } from "typeorm";
import { BaseNumericColumnOptions } from "@/shared/base/BaseEntity";
import { Fund, FundSnapshot } from "./Fund";
import { StoreEntity } from "./store/StoreEntity";

export enum TransferNoteStatus {
  VALID = "valid",
  INVALID = "invalid",
}

@Entity("transfer_notes")
export class TransferNote extends StoreEntity {
  @Column({ type: "timestamptz" })
  occurredAt: Date;

  @Column({ type: "varchar", length: 100 })
  referenceCode: string;

  @Column({ type: "text", nullable: true, default: null })
  note: string | null;

  @Column({ type: "uuid" })
  fundId: string;

  @Column({ type: "jsonb", nullable: true, default: null })
  fundSnapshot: FundSnapshot | null;

  @ManyToOne(() => Fund, { onDelete: "CASCADE" })
  @JoinColumn({ name: "fundId" })
  fund: Fund;

  @Column(BaseNumericColumnOptions)
  amount: number;

  @Column({
    type: "enum",
    enum: TransferNoteStatus,
    default: TransferNoteStatus.VALID,
  })
  status: TransferNoteStatus;

  @Column({ type: "text", nullable: true, default: null })
  invalidReason: string | null;
}
