import { ContainerModule } from "inversify";
import { TransferNoteRepository } from "./transferNote.repository";
import { TransferNoteService } from "./transferNote.service";
import { TransferNoteController } from "./transferNote.controller";
import { TransferNoteRouter } from "./transferNote.route";
import { TRANSFER_NOTE_TYPES } from "./transferNote.types";

export const transferNoteModule = new ContainerModule((bind) => {
  bind(TRANSFER_NOTE_TYPES.Repository).to(TransferNoteRepository).inSingletonScope();
  bind(TRANSFER_NOTE_TYPES.Service).to(TransferNoteService).inSingletonScope();
  bind(TRANSFER_NOTE_TYPES.Controller).to(TransferNoteController).inSingletonScope();
  bind(TRANSFER_NOTE_TYPES.Router).to(TransferNoteRouter).inSingletonScope();
});
