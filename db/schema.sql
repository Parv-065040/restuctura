-- RESTRUCTRA database schema (PostgreSQL / Supabase)
-- Minimal, no unnecessary complexity per the build spec (§41, §50).

create extension if not exists "pgcrypto";

create table if not exists businesses (
    id uuid primary key default gen_random_uuid(),
    business_name text,
    business_type text,               -- Manufacturing / Trading / Services / Retail / Other
    monthly_sales numeric,
    monthly_expenses numeric,
    cash_reserve numeric,
    receivables_amount numeric,
    customers_paying_late text,       -- Yes / No / Sometimes / Not sure
    income_outlook text,              -- Increase / Stay similar / Decrease / Not sure
    main_problem text,
    urgency text,
    created_at timestamptz not null default now()
);

create table if not exists loans (
    id uuid primary key default gen_random_uuid(),
    business_id uuid not null references businesses(id) on delete cascade,
    lender text,
    loan_type text,
    outstanding_amount numeric,
    emi numeric,
    remaining_tenure_months integer,
    interest_rate_pct numeric,
    secured text,
    created_at timestamptz not null default now()
);

create table if not exists documents (
    id uuid primary key default gen_random_uuid(),
    business_id uuid not null references businesses(id) on delete cascade,
    document_type text,               -- bank_statement / loan_statement / gst_summary / receivables_list / sanction_letter
    file_name text,
    extraction_failed boolean not null default false,
    -- Raw document bytes are intentionally NOT stored here (§38 minimize raw retention).
    -- Store an external object-storage reference instead if retention is required.
    storage_reference text,
    created_at timestamptz not null default now()
);

create table if not exists extracted_document_data (
    id uuid primary key default gen_random_uuid(),
    document_id uuid not null references documents(id) on delete cascade,
    field_name text not null,
    field_value text,
    confidence text check (confidence in ('HIGH','MEDIUM','LOW')),
    created_at timestamptz not null default now()
);

create table if not exists reconciliation_results (
    id uuid primary key default gen_random_uuid(),
    business_id uuid not null references businesses(id) on delete cascade,
    field_name text not null,
    user_value numeric,
    document_value numeric,
    status text check (status in ('CONFLICT','CONFIRMED')),
    action_required boolean not null default false,
    created_at timestamptz not null default now()
);

create table if not exists financial_snapshots (
    id uuid primary key default gen_random_uuid(),
    business_id uuid not null references businesses(id) on delete cascade,
    total_monthly_emi numeric,
    total_outstanding_debt numeric,
    available_after_expenses numeric,
    available_after_emi numeric,
    internal_dscr numeric,
    emi_to_sales_ratio numeric,
    emi_to_available_ratio numeric,
    cash_buffer_months numeric,
    receivables_ratio numeric,
    debt_concentration text,
    weighted_avg_interest_rate numeric,
    interest_rate_assumed boolean,
    weighted_avg_tenure_months integer,
    tenure_assumed boolean,
    comfortable_emi_lower numeric,
    comfortable_emi_upper numeric,
    stress_classifications text[],
    data_confidence_score integer,
    data_confidence_level text check (data_confidence_level in ('HIGH','MEDIUM','LOW')),
    created_at timestamptz not null default now()
);

create table if not exists scenarios (
    id uuid primary key default gen_random_uuid(),
    financial_snapshot_id uuid not null references financial_snapshots(id) on delete cascade,
    scenario_key text not null,        -- current / extend_25pct / extend_50pct / extend_100pct / temporaryRelief / stepDown / consolidation
    scenario_json jsonb not null,      -- full scenario payload as produced by the Scenario Engine
    created_at timestamptz not null default now()
);

create table if not exists recommendations (
    id uuid primary key default gen_random_uuid(),
    financial_snapshot_id uuid not null references financial_snapshots(id) on delete cascade,
    ai_unavailable boolean not null default false,
    recommendation_json jsonb not null,
    validation_passed boolean not null,
    validation_errors text[],
    created_at timestamptz not null default now()
);

create table if not exists reports (
    id uuid primary key default gen_random_uuid(),
    recommendation_id uuid not null references recommendations(id) on delete cascade,
    ai_unavailable boolean not null default false,
    report_json jsonb not null,
    validation_passed boolean not null,
    validation_errors text[],
    created_at timestamptz not null default now()
);

create index if not exists idx_loans_business on loans(business_id);
create index if not exists idx_documents_business on documents(business_id);
create index if not exists idx_extracted_document on extracted_document_data(document_id);
create index if not exists idx_reconciliation_business on reconciliation_results(business_id);
create index if not exists idx_financial_snapshots_business on financial_snapshots(business_id);
create index if not exists idx_scenarios_snapshot on scenarios(financial_snapshot_id);
