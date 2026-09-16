import { MigrationInterface, QueryRunner } from "typeorm";

export class AddPurchaseLineToPriceHistory1760000020000
  implements MigrationInterface
{
  name = "AddPurchaseLineToPriceHistory1760000020000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "product_price_histories"
        ADD COLUMN IF NOT EXISTS "purchaseLineId" uuid NULL DEFAULT NULL
    `);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'FK_product_price_histories_purchase_line'
        ) THEN
          ALTER TABLE "product_price_histories"
            ADD CONSTRAINT "FK_product_price_histories_purchase_line"
            FOREIGN KEY ("purchaseLineId") REFERENCES "order_lines"("id")
            ON DELETE CASCADE;
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_product_price_histories_purchase_line"
      ON "product_price_histories" ("purchaseLineId")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_product_price_histories_store_product_time"
      ON "product_price_histories" ("storeId", "productId", "occurredAt")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_product_price_histories_store_product_time"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_product_price_histories_purchase_line"`,
    );
    await queryRunner.query(
      `ALTER TABLE "product_price_histories" DROP CONSTRAINT IF EXISTS "FK_product_price_histories_purchase_line"`,
    );
    await queryRunner.query(
      `ALTER TABLE "product_price_histories" DROP COLUMN IF EXISTS "purchaseLineId"`,
    );
  }
}
