import { MigrationInterface, QueryRunner } from "typeorm";

export class AddFundPersonalFlag1760000017000 implements MigrationInterface {
  name = "AddFundPersonalFlag1760000017000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "funds"
      ADD COLUMN IF NOT EXISTS "isPersonal" boolean NOT NULL DEFAULT false
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "funds" DROP COLUMN IF EXISTS "isPersonal"
    `);
  }
}
