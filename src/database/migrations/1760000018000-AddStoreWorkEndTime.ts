import { MigrationInterface, QueryRunner } from "typeorm";

export class AddStoreWorkEndTime1760000018000 implements MigrationInterface {
  name = "AddStoreWorkEndTime1760000018000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "stores"
      ADD COLUMN IF NOT EXISTS "workEndTime" time NULL DEFAULT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "stores" DROP COLUMN IF EXISTS "workEndTime"`,
    );
  }
}
