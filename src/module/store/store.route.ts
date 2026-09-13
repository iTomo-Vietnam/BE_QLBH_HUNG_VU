import { Router } from "express";
import { injectable, inject } from "inversify";
import { zodValidate } from "@/shared/middleware/validation.middleware";

import {
  CreateStoreSchema,
  UpdateStoreSchema,
  StoreQuerySchema,
  StoreParamsSchema,
} from "./store.validator";
import { StoreController } from "./store.controller";
import { STORE_TYPES } from "./store.types";
import { permissionMiddleware } from "@/shared/middleware/permission.middleware";

@injectable()
export class StoreRouter {
  private router: Router;

  constructor(
    @inject(STORE_TYPES.StoreController)
    private controller: StoreController,
  ) {
    this.router = Router();
    this.initializeRoutes();
  }

  private initializeRoutes(): void {
    // All store routes require authentication
    // this.router.use(authenticate);

    // GET /stores - Get all stores with filters
    this.router.get(
      "/",
      zodValidate(StoreQuerySchema, "query"),
      permissionMiddleware("store", "read"),
      this.controller.getAllWithPagination,
    );

    // POST /stores - Create new store
    this.router.post(
      "/",
      zodValidate(CreateStoreSchema, "body"),
      permissionMiddleware("store", "create"),
      this.controller.create,
    );

    // GET /stores/:id - Get store by ID
    this.router.get(
      "/:id",
      zodValidate(StoreParamsSchema, "params"),
      permissionMiddleware("store", "read"),
      this.controller.getById,
    );

    // PUT /stores/:id - Update store
    this.router.put(
      "/:id",
      zodValidate(StoreParamsSchema, "params"),
      zodValidate(UpdateStoreSchema, "body"),
      permissionMiddleware("store", "update"),
      this.controller.update,
    );

    // DELETE /stores/:id - Delete store
    this.router.delete(
      "/:id",
      zodValidate(StoreParamsSchema, "params"),
      permissionMiddleware("store", "delete"),
      this.controller.delete,
    );
  }

  public getRouter(): Router {
    return this.router;
  }
}
