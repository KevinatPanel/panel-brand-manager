-- Manual "client" flag on companies. A company is treated as a client in the
-- app when this flag is true OR its linked deal is in an activation stage
-- (A1–A5). The manual flag lets us backfill existing/historical clients that
-- never ran through the pipeline inside the tool.
alter table leads add column if not exists is_client boolean not null default false;
