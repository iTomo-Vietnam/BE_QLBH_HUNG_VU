import {
  DeleteDateColumn,
  CreateDateColumn,
  UpdateDateColumn,
  PrimaryGeneratedColumn,
  Column,
  ColumnOptions,
} from "typeorm";
import { ActionMap } from "../types/interfaces";

export interface UserSnapshot {
  id: string;
  code: string;
  name: string;
  username: string | null;
  email: string | null;
  phone: string | null;
  isActive: boolean;
}

export const BaseNumericColumnOptions: ColumnOptions = {
  type: "numeric",
  precision: 15,
  scale: 2,
  default: 0,
  transformer: {
    to: (value: number) => value,
    from: (value: string) => parseFloat(value || "0"),
  },
};

export const BaseQuantityNumericColumnOptions: ColumnOptions = {
  ...BaseNumericColumnOptions,
  precision: 18,
  scale: 6,
};

export const BaseFactorNumericColumnOptions: ColumnOptions = {
  ...BaseNumericColumnOptions,
  precision: 18,
  scale: 6,
  default: 1,
};

export const BaseNullableNumericColumnOptions: ColumnOptions = {
  ...BaseNumericColumnOptions,
  nullable: true,
  default: null,
  transformer: {
    to: (value: number | null) => value,
    from: (value: string | null) => (value === null ? null : parseFloat(value)),
  },
};

export const BaseSortOrderColumnOptions: ColumnOptions = {
  type: "numeric",
  precision: 10,
  scale: 4,
  default: 10,
  transformer: {
    to: (value: number) => value,
    from: (value: string) => parseFloat(value || "0"),
  },
};

/**
 * Base Entity with Soft Delete Support
 * Tất cả entities nên extend từ class này để có soft delete functionality
 */
export abstract class BaseEntity {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "uuid", nullable: true, default: null })
  tempId?: string | null;

  @Column({ name: "note", type: "text", nullable: true })
  note?: string | null;

  @Column({ type: "uuid", nullable: true, default: null })
  creatorId: string | null;
  @Column({ type: "jsonb", nullable: true, default: null })
  creatorSnapshot: UserSnapshot | null;
  @Column({ type: "uuid", nullable: true, default: null })
  updaterId: string | null;
  @Column({ type: "jsonb", nullable: true, default: null })
  updaterSnapshot: UserSnapshot | null;
  @Column({ type: "uuid", nullable: true, default: null })
  deleterId: string | null;
  @Column({ type: "jsonb", nullable: true, default: null })
  deleterSnapshot: UserSnapshot | null;

  @Column(BaseSortOrderColumnOptions)
  sortOrder: number;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt: Date;

  @UpdateDateColumn({ type: "timestamptz", nullable: true, default: null })
  updatedAt: Date | null;

  @DeleteDateColumn({ type: "timestamptz", nullable: true })
  deletedAt?: Date | null;

  @Column({ name: "isDefault", type: "boolean", default: false })
  isDefault: boolean;

  _actions?: ActionMap;

  // Helper methods
  get isDeleted(): boolean {
    return this.deletedAt !== null && this.deletedAt !== undefined;
  }
}
