import { Entity, Column, OneToMany } from "typeorm";
import { BaseEntity } from "@/shared/base/BaseEntity";
import { Address } from "@/shared/base/BaseValidator";
import { StoreUser } from "./store/StoreUser";
import { Fund } from "./Fund";
import { Role } from "./store/Role";

export interface StoreSnapshot {
  id: string;
  code: string;
  name: string;
}

@Entity("stores")
export class Store extends BaseEntity {
  @Column({ type: "varchar", length: 50 })
  code: string;
  @Column({ type: "varchar", length: 255 })
  name: string;

  @Column({ type: "varchar", length: 255, nullable: true, default: null })
  email: string | null;
  @Column({ type: "varchar", length: 15, nullable: true, default: null })
  phone: string | null;

  @Column({ type: "varchar", length: 255, nullable: true, default: null })
  taxCode: string | null;

  @Column({ type: "jsonb", nullable: true, default: null })
  address: Address | null;

  @Column({ type: "boolean", default: true })
  isActive: boolean;

  @OneToMany(() => Fund, (fund) => fund.store, { cascade: true })
  funds: Fund[];

  @OneToMany(() => Role, (role) => role.store, { cascade: true })
  roles: Role[];

  @OneToMany(() => StoreUser, (su) => su.store)
  storeUsers: StoreUser[];
  userCount?: number;
}
