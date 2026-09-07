-- Rode este arquivo uma vez no SQL Editor do Supabase.

create table if not exists funds (
  ticker text primary key,
  nome text not null,
  segmento text not null check (segmento in
    ('PAPEL','TIJOLO','HÍBRIDOS','FOFs','DESENVOLVIMENTO','HOTELARIAS')),
  dy numeric not null,
  pvp numeric not null,
  liquidez numeric,
  risco numeric,            -- % do portfólio sem gerar renda (vacância, inadimplência ou em obra)
  risco_tipo text,          -- 'Vacância física', 'Inadimplência', 'Em obra'...
  atualizado_em timestamptz not null default now()
);

create table if not exists fetch_runs (
  id bigint generated always as identity primary key,
  executado_em timestamptz not null default now(),
  status text not null check (status in ('sucesso','erro')),
  detalhe text
);

-- Segurança: o frontend usa a chave anon, então só liberamos LEITURA pública
-- da tabela funds. Escrita continua exclusiva da service_role (usada pelo n8n).
alter table funds enable row level security;
alter table fetch_runs enable row level security;

drop policy if exists "leitura publica de funds" on funds;
create policy "leitura publica de funds"
  on funds for select
  to anon
  using (true);

-- fetch_runs fica sem política para anon: só a service_role lê/escreve.
