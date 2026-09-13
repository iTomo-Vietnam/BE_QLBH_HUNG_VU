import { injectable } from "inversify";
import { User } from "@/database/models/User";
import {
  BaseRepository,
  IFindPaginationOptions,
} from "@/shared/base/BaseRepository";
import {
  UserRelations,
  UserRelationsList,
  UserSelectFull,
  UserSelectList,
} from "./user.select";
import { EntityManager, SelectQueryBuilder } from "typeorm";
import { UserSnapshot } from "@/shared/base/BaseEntity";
import { getUserSnapshot } from "@/shared/utils/utils";
import { UserQueryDto } from "./user.validator";
@injectable()
export class UserRepository extends BaseRepository<User> {
  protected entityClass = User;
  protected selectedFields = UserSelectFull;
  protected selectedFieldsForList = UserSelectList;
  protected relations = UserRelations;
  protected relationsForList = UserRelationsList;

  protected async extendQueryBuilder(
    qb: SelectQueryBuilder<User>,
    options: IFindPaginationOptions<User>,
  ): Promise<void> {
    const alias = qb.alias;
    const { storeId, storeIds, roleIds } =
      (options?.moreQuery as UserQueryDto) || {};

    qb.andWhere(`(${alias}.username NOT ILIKE :admin)`, { admin: "%admin%" });

    if (storeId) {
      qb.innerJoin(`${alias}.storeUsers`, "su", "su.storeId = :storeId", {
        storeId,
      });
    } else if (this.checkArrayFilter(storeIds)) {
      qb.innerJoin(
        `${alias}.storeUsers`,
        "su",
        "su.storeId IN (:...storeIds)",
        {
          storeIds,
        },
      );
    }

    if (this.checkArrayFilter(roleIds)) {
      qb.andWhere("su.roleId IN (:...roleIds)", { roleIds });
    }
  }

  async getSnapshot(
    id?: string | null,
    manager?: EntityManager,
  ): Promise<UserSnapshot | null> {
    if (!id) return null;
    const user = await super.findById(id, manager);
    if (!user) return null;
    return getUserSnapshot(user);
  }
}
