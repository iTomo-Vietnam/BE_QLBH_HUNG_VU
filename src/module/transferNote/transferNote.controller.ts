import { inject, injectable } from "inversify";
import { BaseController } from "@/shared/base/BaseController";
import { TransferNote } from "@/database/models/TransferNote";
import { TransferNoteService } from "./transferNote.service";
import { TRANSFER_NOTE_TYPES } from "./transferNote.types";

@injectable()
export class TransferNoteController extends BaseController<TransferNote> {
  protected service: TransferNoteService;

  constructor(@inject(TRANSFER_NOTE_TYPES.Service) service: TransferNoteService) {
    super();
    this.service = service;
  }
}
