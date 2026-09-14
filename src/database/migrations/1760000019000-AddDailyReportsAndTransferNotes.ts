import { MigrationInterface, QueryRunner } from "typeorm";

export class AddDailyReportsAndTransferNotes1760000019000
  implements MigrationInterface
{
  name = "AddDailyReportsAndTransferNotes1760000019000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'transfer_notes_status_enum') THEN
          CREATE TYPE "transfer_notes_status_enum" AS ENUM ('valid', 'invalid');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'daily_reports_status_enum') THEN
          CREATE TYPE "daily_reports_status_enum" AS ENUM ('active', 'canceled');
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "transfer_notes" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tempId" uuid NULL DEFAULT NULL,
        "note" text NULL,
        "creatorId" uuid NULL,
        "creatorSnapshot" jsonb NULL,
        "updaterId" uuid NULL,
        "updaterSnapshot" jsonb NULL,
        "deleterId" uuid NULL,
        "deleterSnapshot" jsonb NULL,
        "sortOrder" numeric(10,4) NOT NULL DEFAULT 10,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NULL DEFAULT NULL,
        "deletedAt" timestamptz NULL,
        "isDefault" boolean NOT NULL DEFAULT false,
        "storeId" uuid NOT NULL,
        "occurredAt" timestamptz NOT NULL DEFAULT now(),
        "referenceCode" varchar(100) NOT NULL,
        "fundId" uuid NOT NULL,
        "fundSnapshot" jsonb NULL DEFAULT NULL,
        "amount" numeric(15,2) NOT NULL DEFAULT 0,
        "status" "transfer_notes_status_enum" NOT NULL DEFAULT 'valid',
        "invalidReason" text NULL DEFAULT NULL,
        CONSTRAINT "PK_transfer_notes_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_transfer_notes_store" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_transfer_notes_fund" FOREIGN KEY ("fundId") REFERENCES "funds"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_transfer_notes_store_date" ON "transfer_notes" ("storeId", "occurredAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_transfer_notes_store_reference" ON "transfer_notes" ("storeId", "referenceCode")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "daily_reports" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tempId" uuid NULL DEFAULT NULL,
        "note" text NULL,
        "creatorId" uuid NULL,
        "creatorSnapshot" jsonb NULL,
        "updaterId" uuid NULL,
        "updaterSnapshot" jsonb NULL,
        "deleterId" uuid NULL,
        "deleterSnapshot" jsonb NULL,
        "sortOrder" numeric(10,4) NOT NULL DEFAULT 10,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NULL DEFAULT NULL,
        "deletedAt" timestamptz NULL,
        "isDefault" boolean NOT NULL DEFAULT false,
        "storeId" uuid NOT NULL,
        "reportDate" date NOT NULL,
        "status" "daily_reports_status_enum" NOT NULL DEFAULT 'active',
        "orderSnapshots" jsonb NOT NULL DEFAULT '[]',
        "expenseSnapshots" jsonb NOT NULL DEFAULT '[]',
        "debtIncomeSnapshots" jsonb NOT NULL DEFAULT '[]',
        "transferNoteSnapshots" jsonb NOT NULL DEFAULT '[]',
        "summary" jsonb NOT NULL DEFAULT '{}',
        "capturedAt" timestamptz NOT NULL DEFAULT now(),
        "canceledAt" timestamptz NULL DEFAULT NULL,
        CONSTRAINT "PK_daily_reports_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_daily_reports_store" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_daily_reports_store_date" ON "daily_reports" ("storeId", "reportDate")`,
    );
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_daily_reports_active_store_date"
      ON "daily_reports" ("storeId", "reportDate")
      WHERE "status" = 'active' AND "deletedAt" IS NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "daily_reports"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "transfer_notes"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "daily_reports_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "transfer_notes_status_enum"`);
  }
}
