import { Router } from "express";
import { injectable, inject } from "inversify";
import { zodValidate } from "@/shared/middleware/validation.middleware";
import { LOG_TYPES } from "./log.types";
import { LogController } from "./log.controller";
import { LogParamsSchema, LogQuerySchema } from "./log.validator";
import { permissionMiddleware } from "@/shared/middleware/permission.middleware";

@injectable()
export class LogRouter {
  private router: Router;

  constructor(
    @inject(LOG_TYPES.LogController)
    private controller: LogController,
  ) {
    this.router = Router();
    this.initializeRoutes();
  }

  private initializeRoutes(): void {
    // GET / - Danh sách log có phân trang + filter
    this.router.get(
      "/",
      zodValidate(LogQuerySchema, "query"),
      permissionMiddleware("log", "read"),
      this.controller.getAllWithPagination,
    );

    // GET /:id - Chi tiết 1 log
    this.router.get(
      "/:id",
      zodValidate(LogParamsSchema, "params"),
      permissionMiddleware("log", "read"),
      this.controller.getById,
    );
  }

  public getRouter(): Router {
    return this.router;
  }
}
