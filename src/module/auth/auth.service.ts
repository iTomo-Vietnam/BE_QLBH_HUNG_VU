import { inject, injectable } from "inversify";
import { Response } from "express";
import { IsNull } from "typeorm";
import { AuthUtils } from "@/shared/utils/auth.utils";
import { AuthTokens } from "@/shared/types/interfaces";
import { BadRequestError, NotFoundError } from "@/shared/types/errors";
import {
  createPermissions,
  PermissionStructure,
} from "@/shared/middleware/permission.middleware";
import { EXCEL_MODULES } from "@/shared/types/excel";
import { BaseService } from "@/shared/base/BaseService";
import { User } from "@/database/models/User";
import { Store } from "@/database/models/Store";
import { AuthRepository } from "./auth.repository";
import { AUTH_TYPES } from "./auth.types";
import { LoginDto } from "./auth.validator";

@injectable()
export class AuthService extends BaseService<User> {
  protected repository: AuthRepository;

  constructor(
    @inject(AUTH_TYPES.AuthRepository) authRepository: AuthRepository,
  ) {
    super();
    this.repository = authRepository;
  }

  async login(
    loginData: LoginDto,
    res: Response,
  ): Promise<{ user: User; tokens: AuthTokens }> {
    const user = await this.repository.findByUsername(loginData.username);
    if (!user) throw new BadRequestError("Tài khoản không tồn tại", "username");
    if (!user.isActive) throw new BadRequestError("Tài khoản đã bị khóa");
    if (!(await AuthUtils.comparePassword(loginData.password, user.password)))
      throw new BadRequestError("Mật khẩu không chính xác", "password");
    const tokens = AuthUtils.generateTokens({
      userId: user.id,
      username: user.username,
    });
    AuthUtils.setTokenCookies(res, tokens);
    return { user, tokens };
  }

  async logout(userId: string): Promise<void> {
    await this.repository.updateRefreshToken(userId, null);
  }

  async getCurrent(userId: string, storeId?: string) {
    const user = await this.repository.findOne({
      where: { id: userId, deletedAt: IsNull() } as any,
      relations: { storeUsers: { store: true, role: true } },
    });
    if (!user) throw new NotFoundError("Người dùng không tồn tại", "userId");
    const isAdmin = AuthUtils.isAdmin(user);
    const memberships = user.storeUsers || [];
    const stores = isAdmin
      ? await this.repository.getRepository().manager.getRepository(Store).find({
          where: { deletedAt: IsNull() } as any,
        } as any)
      : memberships.map((membership) => membership.store).filter(Boolean);
    if (!isAdmin && !stores.length)
      throw new BadRequestError(
        "Tài khoản chưa được cấp quyền cho cửa hàng nào",
      );
    if (
      storeId &&
      !isAdmin &&
      !memberships.some((membership) => membership.storeId === storeId)
    )
      throw new BadRequestError(
        "Tài khoản không có quyền truy cập cửa hàng này",
      );
    const currentStore = stores.find((store) => store.id === storeId) || stores[0] || null;
    const currentRole = memberships.find(
      (membership) => membership.storeId === currentStore?.id,
    )?.role;
    const permissions: PermissionStructure = isAdmin
      ? createPermissions()
      : currentRole?.permissions || {};
    return {
      ...user,
      password: undefined,
      permissions,
      allStores: stores,
      currentStore,
      isAdmin,
      importExcel: isAdmin
        ? [...EXCEL_MODULES]
        : currentRole?.importExcel || [],
      exportExcel: isAdmin
        ? [...EXCEL_MODULES]
        : currentRole?.exportExcel || [],
    };
  }

  async update(userId: string, data: Partial<User>): Promise<User | null> {
    const payload: Partial<User> = {
      name: data.name,
      email: data.email,
      phone: data.phone,
      gender: data.gender,
      dob: data.dob,
      address: data.address,
    };
    Object.keys(payload).forEach((key) => {
      if (payload[key as keyof User] === undefined)
        delete payload[key as keyof User];
    });
    await this.repository.getRepository().update(userId, payload as any);
    return this.repository.findById(userId);
  }

  async changePassword(
    userId: string,
    oldPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.repository.findById(userId);
    if (!user) throw new NotFoundError("Người dùng không tồn tại", "userId");
    if (!(await AuthUtils.comparePassword(oldPassword, user.password)))
      throw new BadRequestError("Mật khẩu cũ không chính xác", "oldPassword");
    await this.repository.getRepository().update(userId, {
      password: await AuthUtils.hashPassword(newPassword),
    } as any);
  }
}
