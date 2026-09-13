import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { UnauthorizedError } from "@/shared/types/errors";
import { config } from "@/config/env";
import { AuthUtils } from "@/shared/utils/auth.utils";
import { JwtPayload } from "@/shared/types/interfaces";
import DatabaseConfig from "@/config/database";
import { User } from "@/database/models/User";
import { getUserSnapshot } from "@/shared/utils/utils";
import { createPermissions } from "./permission.middleware";
import { EXCEL_MODULES } from "@/shared/types/excel";
import { getUserStoreAccess } from "@/shared/utils/store-access.utils";

export const authenticate = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  try {
    const accessToken = req.cookies?.accessToken;
    const refreshToken = req.cookies?.refreshToken;
    if (!accessToken && !refreshToken)
      throw new UnauthorizedError("Authentication required");

    if (accessToken) {
      req.user = jwt.verify(accessToken, config.JWT_ACCESS_SECRET) as JwtPayload;
      return next();
    }

    const decoded = jwt.verify(refreshToken, config.JWT_REFRESH_SECRET) as JwtPayload;
    const renewedAccessToken = AuthUtils.generateAccessToken({
      userId: decoded.userId,
      username: decoded.username,
    });
    AuthUtils.setTokenCookies(res, {
      accessToken: renewedAccessToken,
      refreshToken,
    });
    req.user = decoded;
    next();
  } catch {
    next(new UnauthorizedError("Invalid or expired token"));
  }
};

export const authorization = async (
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) throw new UnauthorizedError("Yêu cầu đăng nhập");

    const user = await DatabaseConfig.getRepository(User).findOne({
      where: { id: userId, deletedAt: null } as any,
    });
    if (!user || !user.isActive)
      throw new UnauthorizedError("Tài khoản không tồn tại hoặc đã bị khóa");

    const isAdmin = AuthUtils.isAdmin(user);
    const memberships = await getUserStoreAccess(user.id);
    const storeId = req.storeContext?.storeId;

    if (!storeId)
      throw new UnauthorizedError("Vui lòng chọn cửa hàng đang thao tác");

    if (
      !isAdmin &&
      !memberships.some((membership) => membership.storeId === storeId)
    ) {
      throw new UnauthorizedError("Tài khoản không có quyền truy cập cửa hàng này");
    }

    const snapshot = getUserSnapshot(user);
    req.userContext = snapshot
      ? { userId: user.id, userSnapshot: snapshot, isAdmin }
      : null;

    req.storePermissions = Object.fromEntries(
      memberships.map((membership) => [
        membership.storeId,
        {
          storeId: membership.storeId,
          roleId: membership.roleId,
          roleName: membership.role?.name || null,
          permissions: membership.role?.permissions || {},
          importExcel: membership.role?.importExcel || [],
          exportExcel: membership.role?.exportExcel || [],
        },
      ]),
    );
    req.availableStoreIds = isAdmin
      ? undefined
      : memberships.map((membership) => membership.storeId);

    const currentRole = storeId
      ? memberships.find((membership) => membership.storeId === storeId)?.role
      : undefined;
    req.permissions = isAdmin ? createPermissions() : currentRole?.permissions || {};
    req.importExcel = isAdmin
      ? [...EXCEL_MODULES]
      : currentRole?.importExcel || [];
    req.exportExcel = isAdmin
      ? [...EXCEL_MODULES]
      : currentRole?.exportExcel || [];

    if (req.method === "POST") {
      req.body.creatorId = userId;
      req.body.creatorSnapshot = snapshot;
    }
    if (req.method === "PUT") {
      req.body.updaterId = userId;
      req.body.updaterSnapshot = snapshot;
    }

    next();
  } catch (error) {
    next(
      error instanceof UnauthorizedError
        ? error
        : new UnauthorizedError("Không thể xác thực quyền truy cập"),
    );
  }
};
