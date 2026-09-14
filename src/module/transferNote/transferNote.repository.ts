import { injectable } from "inversify";
import { BaseRepository } from "@/shared/base/BaseRepository";
import { TransferNote } from "@/database/models/TransferNote";
import {
  TransferNoteRelations,
  TransferNoteRelationsList,
  TransferNoteSelectFull,
  TransferNoteSelectList,
} from "./transferNote.select";

@injectable()
export class TransferNoteRepository extends BaseRepository<TransferNote> {
  protected entityClass = TransferNote;
  protected selectedFields = TransferNoteSelectFull;
  protected selectedFieldsForList = TransferNoteSelectList;
  protected relations = TransferNoteRelations;
  protected relationsForList = TransferNoteRelationsList;
}
