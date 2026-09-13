import { zodValidate } from "@/shared/middleware/validation.middleware";
import { Router } from "express";
import { inject, injectable } from "inversify";
import { AttributeController } from "./attribute.controller";
import { ATTRIBUTE_TYPES } from "./attribute.types";
import { permissionMiddleware } from "@/shared/middleware/permission.middleware";
import {
  AttributeParamsSchema,
  AttributeQuerySchema,
  CreateAttributeSchema,
  UpdateAttributeSchema,
} from "./attribute.validator";

@injectable()
export class AttributeRouter {
  private router: Router;

  constructor(
    @inject(ATTRIBUTE_TYPES.AttributeController)
    private attributeController: AttributeController,
  ) {
    this.router = Router();
    this.initializeRoutes();
  }

  private initializeRoutes(): void {
    this.router.get(
      "/",
      zodValidate(AttributeQuerySchema, "query"),
      permissionMiddleware("attribute", "read"),
      this.attributeController.getAllWithPagination,
    );

    this.router.post(
      "/",
      zodValidate(CreateAttributeSchema, "body"),
      permissionMiddleware("attribute", "create"),
      this.attributeController.create,
    );

    this.router.get(
      "/:id",
      zodValidate(AttributeParamsSchema, "params"),
      permissionMiddleware("attribute", "read"),
      this.attributeController.getById,
    );

    this.router.put(
      "/:id",
      zodValidate(AttributeParamsSchema, "params"),
      zodValidate(UpdateAttributeSchema, "body"),
      permissionMiddleware("attribute", "update"),
      this.attributeController.update,
    );

    this.router.delete(
      "/:id",
      zodValidate(AttributeParamsSchema, "params"),
      permissionMiddleware("attribute", "delete"),
      this.attributeController.delete,
    );
  }

  public getRouter(): Router {
    return this.router;
  }
}
