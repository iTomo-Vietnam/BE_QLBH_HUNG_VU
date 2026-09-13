import { Entity, Column, OneToMany } from "typeorm";
import { PermissionStructure } from "@/shared/middleware/permission.middleware";
import type { Module } from "@/shared/middleware/permission.middleware";
import { StoreEntity } from "./StoreEntity";
import { StoreUser } from "./StoreUser";

@Entity("roles")
export class Role extends StoreEntity {
  @Column({ type: "varchar", length: 255 })
  name: string;

  @Column({ type: "jsonb", default: {} })
  permissions: PermissionStructure;

  @Column({ type: "jsonb", default: () => "'[]'" })
  importExcel: Module[];

  @Column({ type: "jsonb", default: () => "'[]'" })
  exportExcel: Module[];

  // ============================== RELATIONSHIPS ==============================
  @OneToMany(() => StoreUser, (su) => su.role)
  storeUsers: StoreUser[];

  userCount?: number;
}
