import { Router } from "express";
import { inject, injectable } from "inversify";
import { permissionMiddleware } from "@/shared/middleware/permission.middleware";
import { zodValidate } from "@/shared/middleware/validation.middleware";
import { TransferNoteController } from "./transferNote.controller";
import { TRANSFER_NOTE_TYPES } from "./transferNote.types";
import {
  CreateTransferNoteSchema,
  TransferNoteParamsSchema,
  TransferNoteQuerySchema,
  UpdateTransferNoteSchema,
} from "./transferNote.validator";

@injectable()
export class TransferNoteRouter {
  private router = Router();

  constructor(@inject(TRANSFER_NOTE_TYPES.Controller) controller: TransferNoteController) {
    this.router.get(
      "/",
      zodValidate(TransferNoteQuerySchema, "query"),
      permissionMiddleware("transferNote", "read"),
      controller.getAllWithPagination,
    );
    this.router.get(
      "/:id",
      zodValidate(TransferNoteParamsSchema, "params"),
      permissionMiddleware("transferNote", "read"),
      controller.getById,
    );
    this.router.post(
      "/",
      zodValidate(CreateTransferNoteSchema, "body"),
      permissionMiddleware("transferNote", "create"),
      controller.create,
    );
    this.router.put(
      "/:id",
      zodValidate(TransferNoteParamsSchema, "params"),
      zodValidate(UpdateTransferNoteSchema, "body"),
      permissionMiddleware("transferNote", "update"),
      controller.update,
    );
    this.router.patch(
      "/:id",
      zodValidate(TransferNoteParamsSchema, "params"),
      zodValidate(UpdateTransferNoteSchema, "body"),
      permissionMiddleware("transferNote", "update"),
      controller.update,
    );
    this.router.delete(
      "/:id",
      zodValidate(TransferNoteParamsSchema, "params"),
      permissionMiddleware("transferNote", "delete"),
      controller.delete,
    );
  }

  getRouter(): Router {
    return this.router;
  }
}
