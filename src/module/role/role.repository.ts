import { injectable } from "inversify";
import { Role } from "@/database/models/store/Role";
import {
  BaseRepository,
  IFindPaginationOptions,
} from "@/shared/base/BaseRepository";
import {
  RoleRelations,
  RoleRelationsList,
  RoleSelectFull,
  RoleSelectList,
} from "./role.select";
import { SelectQueryBuilder } from "typeorm";
@injectable()
export class RoleRepository extends BaseRepository<Role> {
  protected entityClass = Role;
  protected selectedFields = RoleSelectFull;
  protected selectedFieldsForList = RoleSelectList;
  protected relations = RoleRelations;
  protected relationsForList = RoleRelationsList;

  protected async extendQueryBuilder(
    qb: SelectQueryBuilder<Role>,
    options: IFindPaginationOptions<Role>,
  ): Promise<void> {
    const alias = qb.alias;

    qb.loadRelationCountAndMap(`${alias}.userCount`, `${alias}.storeUsers`);
  }
}
