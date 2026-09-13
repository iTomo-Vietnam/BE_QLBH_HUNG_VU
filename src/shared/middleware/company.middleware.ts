import { Request, Response, NextFunction } from "express";
import DatabaseConfig from "@/config/database";
import { Store } from "@/database/models/Store";
import { BadRequestError } from "@/shared/types/errors";

/** Resolves the active store; storeId remains only as a request-context alias. */
export const companyResolver = async (
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const storeId = req.headers["x-store-id"] as
      | string
      | undefined;
    if (!storeId) return next();
    const store = await DatabaseConfig.getRepository(Store).findOne({
      where: { id: storeId },
    });
    if (!store) return next(new BadRequestError("Cửa hàng không tồn tại"));
    req.storeContext = {
      storeId: store.id,
      companyName: store.name,
      companyCode: store.code,
    };
    next();
  } catch (error) {
    next(error);
  }
};
