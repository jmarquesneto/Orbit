CREATE TYPE "public"."ofx_import_status" AS ENUM('review', 'done');--> statement-breakpoint
CREATE TYPE "public"."ofx_match" AS ENUM('auto', 'suggest', 'new', 'dup');--> statement-breakpoint
CREATE TYPE "public"."ofx_resolution" AS ENUM('pending', 'linked', 'created', 'ignored');--> statement-breakpoint
CREATE TABLE "ofx_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"import_id" uuid NOT NULL,
	"fitid" text NOT NULL,
	"posted_at" date NOT NULL,
	"amount_cents" bigint NOT NULL,
	"memo" text NOT NULL,
	"match" "ofx_match" NOT NULL,
	"score" smallint DEFAULT 0 NOT NULL,
	"suggested_transaction_id" uuid,
	"resolution" "ofx_resolution" DEFAULT 'pending' NOT NULL,
	"transaction_id" uuid,
	CONSTRAINT "ofx_entries_score_range" CHECK ("ofx_entries"."score" BETWEEN 0 AND 100)
);
--> statement-breakpoint
CREATE TABLE "ofx_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_id" uuid NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"file_name" text NOT NULL,
	"file_sha256" "bytea" NOT NULL,
	"bank_id" text,
	"account_mask" text,
	"period_start" date,
	"period_end" date,
	"ledger_balance_cents" bigint,
	"status" "ofx_import_status" DEFAULT 'review' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ofx_imports_wallet_file_unique" UNIQUE("wallet_id","file_sha256")
);
--> statement-breakpoint
ALTER TABLE "ofx_entries" ADD CONSTRAINT "ofx_entries_import_id_ofx_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."ofx_imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ofx_entries" ADD CONSTRAINT "ofx_entries_suggested_transaction_id_transactions_id_fk" FOREIGN KEY ("suggested_transaction_id") REFERENCES "public"."transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ofx_entries" ADD CONSTRAINT "ofx_entries_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ofx_imports" ADD CONSTRAINT "ofx_imports_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ofx_imports" ADD CONSTRAINT "ofx_imports_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ofx_entries_import_idx" ON "ofx_entries" USING btree ("import_id");