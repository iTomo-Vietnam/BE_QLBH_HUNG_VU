import { BaseEntity } from "@/shared/base/BaseEntity";
import { Column, Entity, OneToMany } from "typeorm";
import { Address } from "@/shared/base/BaseValidator";
import { Gender } from "@/shared/constants/enum";
import { Notification } from "./Notification";
import { StoreUser } from "./store/StoreUser";

@Entity("users")
export class User extends BaseEntity {
  @Column({ type: "varchar", length: 50 })
  code: string;
  @Column({ type: "varchar", length: 255 })
  name: string;

  @Column({ type: "varchar", length: 100 })
  username: string;
  @Column({ type: "varchar", length: 255 })
  password: string;

  @Column({ type: "varchar", length: 255, nullable: true, default: null })
  email: string | null;
  @Column({ type: "varchar", length: 255, nullable: true, default: null })
  phone: string | null;
  @Column({ type: "enum", enum: Gender, nullable: true, default: null })
  gender: Gender | null;
  @Column({ type: "timestamptz", nullable: true, default: null })
  dob: Date | null;
  @Column({ type: "jsonb", default: {} })
  address: Address | null;

  @Column({ type: "boolean", default: true })
  isActive: boolean;

  @OneToMany(() => Notification, (notification) => notification.user)
  notifications?: Notification[];

  @OneToMany(() => StoreUser, (storeUser) => storeUser.user, { cascade: true })
  storeUsers?: StoreUser[];
}
