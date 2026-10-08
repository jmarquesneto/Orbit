CREATE TYPE "public"."category_kind" AS ENUM('income', 'expense');--> statement-breakpoint
CREATE TYPE "public"."goal_movement_kind" AS ENUM('deposit', 'withdraw');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('open', 'closed', 'paid');--> statement-breakpoint
CREATE TYPE "public"."share_resource_type" AS ENUM('budget', 'goal');--> statement-breakpoint
CREATE TYPE "public"."transaction_kind" AS ENUM('income', 'expense', 'xfer');--> statement-breakpoint
CREATE TYPE "public"."transaction_status" AS ENUM('open', 'paid', 'provisioned');--> statement-breakpoint
CREATE TYPE "public"."wallet_type" AS ENUM('checking', 'cash', 'credit');--> statement-breakpoint
CREATE TABLE "budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"currency" char(3) DEFAULT 'BRL' NOT NULL,
	"period_start_day" smallint DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budgets_period_start_day" CHECK ("budgets"."period_start_day" BETWEEN 1 AND 28)
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"budget_id" uuid NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"kind" "category_kind" NOT NULL,
	"planned_cents" bigint DEFAULT 0 NOT NULL,
	"color" text,
	CONSTRAINT "categories_planned_non_negative" CHECK ("categories"."planned_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "credit_cards" (
	"wallet_id" uuid PRIMARY KEY NOT NULL,
	"limit_cents" bigint NOT NULL,
	"closing_day" smallint NOT NULL,
	"due_day" smallint NOT NULL,
	"pay_from" uuid,
	CONSTRAINT "credit_cards_days" CHECK ("credit_cards"."closing_day" BETWEEN 1 AND 31 AND "credit_cards"."due_day" BETWEEN 1 AND 31),
	CONSTRAINT "credit_cards_limit_non_negative" CHECK ("credit_cards"."limit_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "goal_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"goal_id" uuid NOT NULL,
	"wallet_id" uuid NOT NULL,
	"kind" "goal_movement_kind" NOT NULL,
	"amount_cents" bigint NOT NULL,
	"occurred_on" date NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goal_movements_amount_positive" CHECK ("goal_movements"."amount_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"target_cents" bigint NOT NULL,
	"target_date" date,
	"balance_cents" bigint DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goals_target_positive" CHECK ("goals"."target_cents" > 0),
	CONSTRAINT "goals_balance_non_negative" CHECK ("goals"."balance_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "installment_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"card_id" uuid NOT NULL,
	"budget_id" uuid NOT NULL,
	"description" text NOT NULL,
	"total_cents" bigint NOT NULL,
	"count" smallint NOT NULL,
	"purchase_date" date NOT NULL,
	"first_invoice" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "installment_plans_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "installment_plans_count" CHECK ("installment_plans"."count" BETWEEN 1 AND 48),
	CONSTRAINT "installment_plans_total_positive" CHECK ("installment_plans"."total_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"card_id" uuid NOT NULL,
	"ref_month" date NOT NULL,
	"closing_date" date NOT NULL,
	"due_date" date NOT NULL,
	"total_cents" bigint DEFAULT 0 NOT NULL,
	"paid_cents" bigint DEFAULT 0 NOT NULL,
	"status" "invoice_status" DEFAULT 'open' NOT NULL,
	CONSTRAINT "invoices_card_month_unique" UNIQUE("card_id","ref_month"),
	CONSTRAINT "invoices_ref_month_first_day" CHECK (extract(day from "invoices"."ref_month") = 1)
);
--> statement-breakpoint
CREATE TABLE "resource_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"resource_type" "share_resource_type" NOT NULL,
	"resource_id" uuid NOT NULL,
	"grantee_id" uuid NOT NULL,
	"role_code" text NOT NULL,
	"granted_by" uuid NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "share_roles" (
	"code" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"can_read" boolean NOT NULL,
	"can_update" boolean NOT NULL,
	"can_create" boolean NOT NULL,
	"can_delete" boolean NOT NULL,
	"can_share" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"budget_id" uuid NOT NULL,
	"wallet_id" uuid NOT NULL,
	"category_id" uuid,
	"invoice_id" uuid,
	"plan_id" uuid,
	"installment_no" smallint,
	"description" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"kind" "transaction_kind" NOT NULL,
	"status" "transaction_status" DEFAULT 'open' NOT NULL,
	"due_date" date NOT NULL,
	"paid_at" timestamp with time zone,
	"ofx_fitid" text,
	"created_by" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transactions_amount_positive" CHECK ("transactions"."amount_cents" > 0),
	CONSTRAINT "transactions_installment_consistent" CHECK (("transactions"."plan_id" IS NULL) = ("transactions"."installment_no" IS NULL)),
	CONSTRAINT "transactions_paid_consistent" CHECK (("transactions"."status" = 'paid') = ("transactions"."paid_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "wallets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"type" "wallet_type" NOT NULL,
	"name" text NOT NULL,
	"institution" text,
	"last4" char(4),
	"opening_cents" bigint DEFAULT 0 NOT NULL,
	"balance_cents" bigint DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallets_last4_digits" CHECK ("wallets"."last4" IS NULL OR "wallets"."last4" ~ '^[0-9]{4}$')
);
--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_budget_id_budgets_id_fk" FOREIGN KEY ("budget_id") REFERENCES "public"."budgets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_cards" ADD CONSTRAINT "credit_cards_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_cards" ADD CONSTRAINT "credit_cards_pay_from_wallets_id_fk" FOREIGN KEY ("pay_from") REFERENCES "public"."wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_movements" ADD CONSTRAINT "goal_movements_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_movements" ADD CONSTRAINT "goal_movements_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_movements" ADD CONSTRAINT "goal_movements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installment_plans" ADD CONSTRAINT "installment_plans_card_id_credit_cards_wallet_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."credit_cards"("wallet_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installment_plans" ADD CONSTRAINT "installment_plans_budget_id_budgets_id_fk" FOREIGN KEY ("budget_id") REFERENCES "public"."budgets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installment_plans" ADD CONSTRAINT "installment_plans_first_invoice_invoices_id_fk" FOREIGN KEY ("first_invoice") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installment_plans" ADD CONSTRAINT "installment_plans_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_card_id_credit_cards_wallet_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."credit_cards"("wallet_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_shares" ADD CONSTRAINT "resource_shares_grantee_id_users_id_fk" FOREIGN KEY ("grantee_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_shares" ADD CONSTRAINT "resource_shares_role_code_share_roles_code_fk" FOREIGN KEY ("role_code") REFERENCES "public"."share_roles"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_shares" ADD CONSTRAINT "resource_shares_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_budget_id_budgets_id_fk" FOREIGN KEY ("budget_id") REFERENCES "public"."budgets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_plan_id_installment_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."installment_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "budgets_owner_idx" ON "budgets" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "categories_budget_idx" ON "categories" USING btree ("budget_id");--> statement-breakpoint
CREATE INDEX "goal_movements_goal_idx" ON "goal_movements" USING btree ("goal_id");--> statement-breakpoint
CREATE INDEX "goals_owner_idx" ON "goals" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "resource_shares_active_unique" ON "resource_shares" USING btree ("resource_type","resource_id","grantee_id") WHERE "resource_shares"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "resource_shares_grantee_idx" ON "resource_shares" USING btree ("grantee_id");--> statement-breakpoint
CREATE INDEX "transactions_budget_due_idx" ON "transactions" USING btree ("budget_id","due_date");--> statement-breakpoint
CREATE INDEX "transactions_invoice_idx" ON "transactions" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "transactions_plan_idx" ON "transactions" USING btree ("plan_id");--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_wallet_fitid_unique" ON "transactions" USING btree ("wallet_id","ofx_fitid") WHERE "transactions"."ofx_fitid" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "wallets_owner_idx" ON "wallets" USING btree ("owner_id");