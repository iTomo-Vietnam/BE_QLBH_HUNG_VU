import { DeepPartial, EntityManager } from "typeorm";
import DatabaseConfig from "@/config/database";
import { AuthUtils } from "@/shared/utils/auth.utils";
import { Attribute, AttributeType } from "../models/Attribute";
import { Role } from "../models/store/Role";
import { Store } from "../models/Store";
import { Fund } from "../models/Fund";
import { StoreUser } from "../models/store/StoreUser";
import { User } from "../models/User";
import { adminSeeder } from "./user";
import { attributeSeeders } from "./attribute/seedData";
import { storeSeeders } from "./store";

async function upsertStores(manager: EntityManager): Promise<Store[]> {
  const repository = manager.getRepository(Store);
  const fundRepository = manager.getRepository(Fund);
  const stores: Store[] = [];
  for (const seed of storeSeeders) {
    const { funds, roles, ...storeSeed } = seed as DeepPartial<Store> & {
      funds?: DeepPartial<Fund>[];
      roles?: DeepPartial<Role>[];
    };
    const existing = await repository.findOne({ where: { code: seed.code } });
    const store = existing
      ? repository.merge(existing, storeSeed)
      : repository.create(storeSeed);
    const savedStore = await repository.save(store);
    stores.push(savedStore);

    // Upsert các quỹ trong seed theo mã để chạy seeder nhiều lần không tạo trùng.
    for (const fundSeed of funds || []) {
      const existingFund = await fundRepository.findOne({
        where: {
          code: fundSeed.code,
          storeId: savedStore.id,
          deletedAt: null,
        } as any,
      });
      const fund = existingFund
        ? fundRepository.merge(existingFund, { ...fundSeed, storeId: savedStore.id })
        : fundRepository.create({ ...fundSeed, storeId: savedStore.id });
      await fundRepository.save(fund);
    }

    const roleRepository = manager.getRepository(Role);
    for (const roleSeed of roles || []) {
      const existingRole = await roleRepository.findOne({
        where: {
          name: roleSeed.name,
          storeId: savedStore.id,
          deletedAt: null,
        } as any,
      });
      const role = existingRole
        ? roleRepository.merge(existingRole, roleSeed)
        : roleRepository.create({ ...roleSeed, storeId: savedStore.id });
      await roleRepository.save(role);
    }
  }
  return stores;
}

async function upsertAdmin(manager: EntityManager): Promise<User> {
  const repository = manager.getRepository(User);
  const existing = await repository.findOne({
    where: { username: adminSeeder.username! },
  });
  const user = existing
    ? repository.merge(existing, adminSeeder)
    : repository.create(adminSeeder);
  if (!existing) user.password = await AuthUtils.hashPassword("123456");
  return repository.save(user);
}

async function attachAdminToStores(
  manager: EntityManager,
  admin: User,
  stores: Store[],
): Promise<void> {
  const repository = manager.getRepository(StoreUser);
  for (const store of stores) {
    const existing = await repository.findOne({
      where: { userId: admin.id, storeId: store.id } as any,
    });
    if (!existing)
      await repository.save(
        repository.create({ userId: admin.id, storeId: store.id }),
      );
  }
}

async function seedAttributes(manager: EntityManager): Promise<void> {
  const repository = manager.getRepository(Attribute);
  const validTypes = Object.values(AttributeType);
  await repository
    .createQueryBuilder()
    .update(Attribute)
    .set({ deletedAt: new Date() })
    .where('"type" NOT IN (:...validTypes)', { validTypes })
    .andWhere('"deletedAt" IS NULL')
    .execute();

  for (const seed of attributeSeeders) {
    const existing = await repository.findOne({
      where: { name: seed.name!, type: seed.type! } as any,
    });
    if (existing) {
      await repository.update(existing.id, {
        isDefault: seed.isDefault ?? existing.isDefault,
        deletedAt: null,
      } as any);
    } else {
      await repository.save(repository.create(seed));
    }
  }
}

export class DatabaseSeeder {
  static async run(): Promise<void> {
    console.log("🌱 Starting current-model database seeding...");
    await DatabaseConfig.initialize();
    try {
      await DatabaseConfig.transaction(async (manager) => {
        const stores = await upsertStores(manager);
        const admin = await upsertAdmin(manager);
        await attachAdminToStores(manager, admin, stores);
        await seedAttributes(manager);
        console.log(
          `✅ Seeded ${stores.length} stores, admin user, roles and current attributes.`,
        );
      });
      console.log("🔐 Default login: admin / 123456");
    } finally {
      await DatabaseConfig.destroy();
    }
  }
}
