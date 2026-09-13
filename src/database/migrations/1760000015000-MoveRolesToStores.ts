import { MigrationInterface, QueryRunner } from "typeorm";

export class MoveRolesToStores1760000015000 implements MigrationInterface {
  name = "MoveRolesToStores1760000015000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "roles"
        ADD COLUMN IF NOT EXISTS "storeId" uuid NULL;
    `);
    await queryRunner.query(`
      ALTER TABLE "store_users"
        ADD COLUMN IF NOT EXISTS "roleId" uuid NULL;
    `);

    // Gán role cũ vào cửa hàng đầu tiên, sau đó nhân bản role sang các cửa hàng còn lại.
    await queryRunner.query(`
      DO $$
      DECLARE first_store_id uuid;
      BEGIN
        SELECT "id" INTO first_store_id
        FROM "stores"
        WHERE "deletedAt" IS NULL
        ORDER BY "createdAt", "id"
        LIMIT 1;

        IF first_store_id IS NOT NULL THEN
          UPDATE "roles"
          SET "storeId" = first_store_id
          WHERE "storeId" IS NULL;
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      INSERT INTO "roles" (
        "tempId", "note", "creatorId", "creatorSnapshot", "updaterId", "updaterSnapshot",
        "deleterId", "deleterSnapshot", "sortOrder", "createdAt", "updatedAt", "deletedAt",
        "isDefault", "name", "permissions", "importExcel", "exportExcel", "storeId"
      )
      SELECT
        r."tempId", r."note", r."creatorId", r."creatorSnapshot", r."updaterId", r."updaterSnapshot",
        r."deleterId", r."deleterSnapshot", r."sortOrder", r."createdAt", r."updatedAt", r."deletedAt",
        r."isDefault", r."name", r."permissions", r."importExcel", r."exportExcel", s."id"
      FROM "roles" r
      CROSS JOIN "stores" s
      WHERE r."storeId" IS NOT NULL
        AND s."deletedAt" IS NULL
        AND s."id" <> r."storeId"
        AND NOT EXISTS (
          SELECT 1 FROM "roles" existing
          WHERE existing."name" = r."name"
            AND existing."storeId" = s."id"
        );
    `);

    // Chuyển roleId cũ của users sang membership tương ứng theo tên role và cửa hàng.
    await queryRunner.query(`
      UPDATE "store_users" su
      SET "roleId" = target."id"
      FROM "users" u
      INNER JOIN "roles" source ON source."id" = u."roleId"
      INNER JOIN "roles" target
        ON target."name" = source."name"
       AND target."storeId" = su."storeId"
      WHERE su."userId" = u."id"
        AND u."roleId" IS NOT NULL;
    `);

    await queryRunner.query(`
      ALTER TABLE "roles"
        ALTER COLUMN "storeId" SET NOT NULL;
    `);
    await queryRunner.query(`
      ALTER TABLE "roles"
        DROP COLUMN IF EXISTS "type";
      ALTER TABLE "users"
        DROP COLUMN IF EXISTS "roleId" CASCADE;
    `);
    await queryRunner.query(`DROP TYPE IF EXISTS "roles_type_enum";`);
    await queryRunner.query(`
      ALTER TABLE "roles"
        ADD CONSTRAINT "FK_roles_store" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE;
    `);
    await queryRunner.query(`
      ALTER TABLE "store_users"
        ADD CONSTRAINT "FK_store_users_role" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE SET NULL;
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_roles_store_name"
      ON "roles" ("storeId", "name")
      WHERE "deletedAt" IS NULL;
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_roles_store_name";`);
    await queryRunner.query(`ALTER TABLE "store_users" DROP CONSTRAINT IF EXISTS "FK_store_users_role";`);
    await queryRunner.query(`ALTER TABLE "roles" DROP CONSTRAINT IF EXISTS "FK_roles_store";`);
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "roleId" uuid NULL;`);
    await queryRunner.query(`ALTER TABLE "roles" ADD COLUMN IF NOT EXISTS "type" varchar(20) NOT NULL DEFAULT 'store';`);
    await queryRunner.query(`ALTER TABLE "store_users" DROP COLUMN IF EXISTS "roleId";`);
    await queryRunner.query(`ALTER TABLE "roles" DROP COLUMN IF EXISTS "storeId";`);
  }
}
