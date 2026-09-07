# Simulador de FIIs

Projeto Vite + React pronto para rodar localmente ou colar no Bolt.new / Lovable.

## Rodar localmente

```bash
npm install
npm run dev
```

Abre em `http://localhost:5173`.

## Publicar (gerar versão de produção)

```bash
npm run build
```

Gera a pasta `dist/` — pode ser hospedada em qualquer lugar (Vercel, Netlify, GitHub Pages).

## Usar no Bolt.new ou Lovable

Essas ferramentas normalmente aceitam importar um repositório do GitHub. O caminho mais
simples:

1. Suba esta pasta como um repositório novo no GitHub (mesmo processo que já usamos para o
   projeto DIO — `git init`, `git add .`, `git commit`, `git push`).
2. No Bolt.new/Lovable, escolha "importar do GitHub" e cole o link do repositório.

Se a ferramenta aceitar colar código diretamente, o arquivo principal é `src/App.jsx`.

## Dados reais: como ligar o botão "Carregar dados reais (Supabase)"

O botão fica desabilitado até você configurar a conexão. O pipeline de dados é **100% gratuito**
e usa só fontes oficiais:

- **CVM – Informe Mensal de FII** (dados abertos): valor patrimonial, dividend yield mensal,
  segmento, mandato, composição da carteira.
- **B3 – Cotações Históricas (COTAHIST)**: preço de fechamento e volume diário.
- **CVM – Informe Trimestral** (opcional): vacância por imóvel → risco operacional.

A ponte entre CVM (CNPJ) e B3 (ticker) é o código ISIN, presente nos dois arquivos.

### Ordem que funciona

1. **Supabase**: crie o projeto (grátis) e rode `supabase.sql` no SQL Editor.
2. **GitHub**: suba esta pasta como repositório e cadastre, em *Settings → Secrets and variables → Actions*:
   - Secret `SUPABASE_URL` (ex.: `https://xxxx.supabase.co`)
   - Secret `SUPABASE_SERVICE_ROLE_KEY` (Project Settings → API → service_role — **nunca** a anon)
   - (opcional) Variable `TICKERS` = `MXRF11,HGLG11,...` para limitar a uma lista
   - (opcional) Variable `MIN_LIQUIDEZ` = `200000` para ignorar fundos ilíquidos
3. **Rode uma vez à mão**: aba *Actions* → "Atualizar dados de FIIs" → *Run workflow*. Depois disso
   roda sozinho todo dia às 6h (Brasília).
4. **Frontend**: copie `.env.example` para `.env` com `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`
   (a anon é pública; a segurança é a política RLS de leitura). No Bolt.new/Vercel, cadastre as
   mesmas variáveis no painel de ambiente.

### Testar o script localmente

```bash
pip install -r scripts/requirements.txt
python scripts/atualizar_fiis.py --dry-run                     # baixa dados reais, só imprime
python scripts/atualizar_fiis.py --dry-run --fixtures tests/fixtures --hoje 2026-09-07   # testes offline
```

### O que confirmar na primeira execução real

O script foi validado com arquivos de teste no formato oficial, mas os nomes de coluna da CVM foram
escritos a partir da documentação, não de um download aqui. Se alguma coluna não bater, o log diz
exatamente qual e lista as disponíveis — aí é ajustar as candidatas em `coluna(...)` no script.
Pontos de atenção: `Codigo_ISIN` (a ponte com a B3), `Percentual_Dividend_Yield_Mes` e, no informe
trimestral, `Percentual_Vacancia`.

### Como os indicadores são calculados (transparência)

- **DY 12m** = soma dos 12 últimos `Percentual_Dividend_Yield_Mes` do informe mensal
- **P/VP** = último fechamento (B3) ÷ valor patrimonial por cota (CVM)
- **Liquidez** = volume financeiro médio diário dos últimos ~30 pregões (B3)
- **Risco** = vacância média dos imóveis no último informe trimestral (fundos de imóveis);
  para papel/FOF fica vazio até integrar inadimplência
- **Segmento** = mandato "Desenvolvimento" → DESENVOLVIMENTO; segmento "Hotel" → HOTELARIAS;
  ≥50% do PL em cotas de FII → FOFs; ≥50% em CRI ou mandato de títulos → PAPEL;
  "Híbrido" → HÍBRIDOS; demais → TIJOLO

## Estrutura

```
.
├── index.html
├── package.json
├── vite.config.js
├── supabase.sql                 # tabelas + política RLS de leitura
├── .env.example                 # variáveis de ambiente do frontend
├── scripts/
│   ├── atualizar_fiis.py        # pipeline CVM + B3 -> Supabase
│   └── requirements.txt
├── tests/fixtures/              # arquivos de exemplo no formato oficial (testes offline)
├── .github/workflows/
│   └── atualizar-fiis.yml       # agendamento diário gratuito (GitHub Actions)
└── src/
    ├── main.jsx      # ponto de entrada
    └── App.jsx        # o simulador (todo o código do protótipo)
```
