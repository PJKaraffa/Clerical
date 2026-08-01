-- Run this once in the Supabase SQL Editor before using the enhanced ballot.

alter table public.votes
add column if not exists nomination_reason text;

alter table public.votes
drop constraint if exists votes_nomination_reason_length;

alter table public.votes
add constraint votes_nomination_reason_length
check (nomination_reason is null or char_length(nomination_reason) <= 250);
