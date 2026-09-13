import { Column, Entity, ManyToOne, OneToMany } from "typeorm";
import { FundAdjustment } from "./FundAdjustment";
import { BaseEntity } from "@/shared/base/BaseEntity";
import { Store } from "./Store";

export enum FundType {
  CASH = "cash",
  BANK = "bank",
}

export interface FundSnapshot {
  id: string;
  code: string;
  name: string;
  type: FundType;
  storeId?: string | null;
  isPersonal?: boolean;
}

@Entity("funds")
export class Fund extends BaseEntity {
  @Column({ type: "varchar", length: 25 })
  code: string;

  @Column({ type: "varchar", length: 255 })
  name: string;

  @Column({ type: "enum", enum: FundType })
  type: FundType;

  @Column({ type: "varchar", length: 255, nullable: true })
  bank: string | null;

  @Column({ type: "varchar", length: 100, nullable: true })
  accountNumber: string | null;

  @Column({ type: "varchar", length: 100, nullable: true })
  accountHolderName: string | null;

  @Column({ type: "varchar", length: 50, nullable: true })
  branch: string | null;

  @Column({ type: "uuid", nullable: true, default: null })
  storeId: string | null;

  @Column({ type: "boolean", default: false })
  isPersonal: boolean;
  @ManyToOne(() => Store, { onDelete: "SET NULL" })
  store: Store | null;

  @Column({ type: "boolean", default: true })
  isActive: boolean;

  @OneToMany(() => FundAdjustment, (fa) => fa.fund, { cascade: true })
  fundAdjustments: FundAdjustment[];

  // TODO: More fields
  currentBalance?: number;
  initialBalance?: number;
}

