import { DeepPartial } from "typeorm";
import { Store } from "../models/Store";
import { FundType } from "../models";
import { roleSeeders } from "./role";

const defaultRoles = () =>
  roleSeeders.map((role) => ({
    ...role,
    permissions: role.permissions ? { ...role.permissions } : undefined,
    importExcel: [...(role.importExcel || [])],
    exportExcel: [...(role.exportExcel || [])],
  }));

export const storeSeeders: DeepPartial<Store>[] = [
  {
    code: "PT",
    name: "PHÚC THỊNH",
    phone: "0766706668",
    email: null,
    taxCode: null,
    address: {
      state: "Tỉnh Gia Lai",
      ward: "Phường Quy Nhơn Bắc",
      detail: "25 Lạc Long Quân",
      isPermanent: false,
    },
    isActive: true,
    workEndTime: "18:00",
    sortOrder: 10,
    roles: defaultRoles(),
    funds: [
      {
        code: "TM-PT",
        name: "Tiền mặt",
        type: FundType.CASH,
        isDefault: true,
        isPersonal: false,
        isActive: true,
      },
      {
        code: "NH-PT",
        name: "Ngân hàng ACB",
        type: FundType.BANK,
        bank: "ACB",
        accountNumber: "123456789",
        accountHolderName: "PHÚC THỊNH",
        isDefault: false,
        isPersonal: false,
        isActive: true,
      },
    ],
  },
  {
    code: "TV",
    name: "THẾ VŨ",
    phone: "0905644431",
    email: null,
    taxCode: null,
    address: {
      state: "Tỉnh Gia Lai",
      ward: "Phường Quy Nhơn",
      detail: "466 Trần Hưng Đạo",
      isPermanent: false,
    },
    isActive: true,
    workEndTime: "17:30",
    sortOrder: 20,
    roles: defaultRoles(),
    funds: [
      {
        code: "TM-TV",
        name: "Tiền mặt",
        type: FundType.CASH,
        isDefault: true,
        isPersonal: false,
        isActive: true,
      },
      {
        code: "NH-TV",
        name: "Ngân hàng MB",
        type: FundType.BANK,
        bank: "MB",
        accountNumber: "987654321",
        accountHolderName: "THẾ VŨ",
        isDefault: false,
        isPersonal: false,
        isActive: true,
      },
    ],
  },
];
