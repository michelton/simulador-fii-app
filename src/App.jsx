import React, { useEffect, useMemo, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

const FONT_IMPORT =
  "@import url('https://fonts.googleapis.com/css2?family=Besley:wght@400;600;700&family=Inter:wght@400;500;600;700&display=swap');";

const TOKENS = {
  paper: "#EDE6D8",
  paperSoft: "#F5F1E7",
  ink: "#211D16",
  inkSoft: "#5A5342",
  brick: "#A8472C",
  brickDark: "#7C3320",
  forest: "#2F5A3F",
  navy: "#2C3B52",
  line: "#C7BFAD",
};

const SEGMENTS = ["PAPEL", "TIJOLO", "HÍBRIDOS", "FOFs", "DESENVOLVIMENTO", "HOTELARIAS"];

// risco = % do portfólio que NÃO está gerando renda hoje:
// vacância física (fundos de imóveis), inadimplência (papel e FOFs),
// ou % da carteira ainda em obra (desenvolvimento).
const FUNDS = [
  { ticker: "CRIP11", nome: "Crédito Imobiliário Prime", segmento: "PAPEL", dy: 11.8, pvp: 0.96, liquidez: 2100000, risco: 0.4, riscoTipo: "Inadimplência" },
  { ticker: "RECI11", nome: "Recebíveis Imobiliários", segmento: "PAPEL", dy: 10.5, pvp: 1.02, liquidez: 1400000, risco: 0.9, riscoTipo: "Inadimplência" },
  { ticker: "GALP11", nome: "Galpões Logísticos", segmento: "TIJOLO", dy: 8.6, pvp: 1.08, liquidez: 3200000, risco: 3, riscoTipo: "Vacância física" },
  { ticker: "CORP11", nome: "Corporate Towers", segmento: "TIJOLO", dy: 7.4, pvp: 0.91, liquidez: 1800000, risco: 9, riscoTipo: "Vacância física" },
  { ticker: "MULT11", nome: "Multiestratégia Renda", segmento: "HÍBRIDOS", dy: 8.9, pvp: 1.0, liquidez: 2600000, risco: 5, riscoTipo: "Vacância física" },
  { ticker: "VRSA11", nome: "Versátil FII", segmento: "HÍBRIDOS", dy: 8.1, pvp: 0.95, liquidez: 900000, risco: 6, riscoTipo: "Vacância física" },
  { ticker: "ALOC11", nome: "Alocação Diversificada FOF", segmento: "FOFs", dy: 9.7, pvp: 0.94, liquidez: 1100000, risco: 4, riscoTipo: "Vacância da carteira" },
  { ticker: "CARFI11", nome: "Carteira FIIs FOF", segmento: "FOFs", dy: 9.1, pvp: 0.97, liquidez: 700000, risco: 5, riscoTipo: "Vacância da carteira" },
  { ticker: "EDIF11", nome: "Desenvolvimento Edifícios", segmento: "DESENVOLVIMENTO", dy: 6.8, pvp: 0.85, liquidez: 500000, risco: 45, riscoTipo: "Em obra" },
  { ticker: "TERR11", nome: "Terrenos e Incorporação", segmento: "DESENVOLVIMENTO", dy: 6.2, pvp: 0.8, liquidez: 400000, risco: 60, riscoTipo: "Em obra" },
  { ticker: "HOSP11", nome: "Hospitalidade Brasil", segmento: "HOTELARIAS", dy: 7.9, pvp: 0.88, liquidez: 600000, risco: 28, riscoTipo: "Quartos vazios" },
  { ticker: "POUS11", nome: "Pousadas e Resorts", segmento: "HOTELARIAS", dy: 7.1, pvp: 0.83, liquidez: 500000, risco: 35, riscoTipo: "Quartos vazios" },
];

const PROFILES = {
  Conservador: { PAPEL: 30, TIJOLO: 50, "HÍBRIDOS": 10, FOFs: 10, DESENVOLVIMENTO: 0, HOTELARIAS: 0 },
  Moderado: { PAPEL: 32, TIJOLO: 35, "HÍBRIDOS": 8, FOFs: 5, DESENVOLVIMENTO: 10, HOTELARIAS: 10 },
  Agressivo: { PAPEL: 50, TIJOLO: 10, "HÍBRIDOS": 5, FOFs: 5, DESENVOLVIMENTO: 20, HOTELARIAS: 10 },
};

const SORT_OPTIONS = [
  { key: "score", label: "Score", dir: -1 },
  { key: "dy", label: "Dividend yield", dir: -1 },
  { key: "pvp", label: "P/VP", dir: 1 },
  { key: "liquidez", label: "Liquidez", dir: -1 },
  { key: "risco", label: "Menor risco operacional", dir: 1 },
];

const DEFAULT_WEIGHTS = { dy: 40, pvp: 25, liq: 15, risco: 20 };

// Como os três cenários se afastam do caso base (em pontos percentuais ao ano).
const CENARIOS = {
  pessimista: { cota: -3, dy: -1 },
  base: { cota: 0, dy: 0 },
  otimista: { cota: 3, dy: 1 },
};

const brl = (n) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const brlCents = (n) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 });

function computeScores(funds, weights) {
  const w = weights || DEFAULT_WEIGHTS;
  const total = w.dy + w.pvp + w.liq + w.risco || 1;
  const range = (arr) => [Math.min(...arr), Math.max(...arr)];
  const norm = (v, min, max) => (max === min ? 0.5 : (v - min) / (max - min));
  const riscosValidos = funds.map((f) => f.risco).filter((v) => v != null && !Number.isNaN(v));
  const riscoMedio = riscosValidos.length
    ? riscosValidos.reduce((s, v) => s + v, 0) / riscosValidos.length
    : 0;
  const riscoDe = (f) => (f.risco == null || Number.isNaN(f.risco) ? riscoMedio : f.risco);
  const [dyMin, dyMax] = range(funds.map((f) => f.dy));
  const [pvpMin, pvpMax] = range(funds.map((f) => f.pvp));
  const [liqMin, liqMax] = range(funds.map((f) => f.liquidez));
  const [rMin, rMax] = range(funds.map(riscoDe));
  return funds.map((f) => {
    const dyN = norm(f.dy, dyMin, dyMax);
    const pvpN = 1 - norm(f.pvp, pvpMin, pvpMax);
    const liqN = norm(f.liquidez, liqMin, liqMax);
    const riscoN = 1 - norm(riscoDe(f), rMin, rMax);
    const score = Math.round(
      ((dyN * w.dy + pvpN * w.pvp + liqN * w.liq + riscoN * w.risco) / total) * 100
    );
    return { ...f, score };
  });
}

function fvValor(aporteMensal, taxaMensal, meses) {
  if (Math.abs(taxaMensal) < 1e-9) return aporteMensal * meses;
  return aporteMensal * ((Math.pow(1 + taxaMensal, meses) - 1) / taxaMensal);
}

// Separa dois motores de retorno: os dividendos (que pagam a renda) e a
// variação da cota (que muda o patrimônio). O patrimônio cresce pelos dois,
// com reinvestimento; a renda mensal vem só do dividend yield.
function taxasCenario(dyAnual, varCotaAnual, ajuste) {
  const dyEff = Math.max(0, dyAnual + ajuste.dy);
  const cotaEff = varCotaAnual + ajuste.cota;
  const totalAnual = (1 + dyEff / 100) * (1 + cotaEff / 100) - 1;
  return {
    mensalTotal: Math.pow(1 + totalAnual, 1 / 12) - 1,
    mensalDY: Math.pow(1 + dyEff / 100, 1 / 12) - 1,
  };
}

function deflator(inflacaoAnual, meses) {
  return Math.pow(1 + inflacaoAnual / 100, meses / 12);
}

// Conexão com o seu banco (Supabase). A chave "anon" é pública por desenho:
// ela só permite o que a política de RLS liberar (aqui, leitura da tabela funds).
// No projeto Vite, esses valores vêm de variáveis de ambiente via main.jsx;
// dentro do Claude.ai ficam vazios e a ferramenta usa os dados de exemplo.
const SUPABASE_CONFIG = {
  url: "",
  anonKey: "",
};

async function buscarDadosSupabase(cfg) {
  if (!cfg.url || !cfg.anonKey) {
    throw new Error("Conexão com o Supabase não configurada");
  }
  const url = `${cfg.url.replace(/\/$/, "")}/rest/v1/funds?select=*&order=dy.desc`;
  const response = await fetch(url, {
    headers: {
      apikey: cfg.anonKey,
      Authorization: `Bearer ${cfg.anonKey}`,
    },
  });
  if (!response.ok) throw new Error(`Supabase respondeu ${response.status}`);
  const rows = await response.json();
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("A tabela funds está vazia — rode o pipeline do n8n primeiro");
  }
  const fundos = rows
    .filter((r) => r && r.ticker && SEGMENTS.includes(r.segmento))
    .map((r) => ({
      ticker: String(r.ticker),
      nome: String(r.nome || r.ticker),
      segmento: r.segmento,
      dy: Number(r.dy) || 0,
      pvp: Number(r.pvp) || 0,
      liquidez: Number(r.liquidez) || 0,
      risco: r.risco == null ? null : Number(r.risco),
      riscoTipo: r.risco_tipo || "Sem renda",
      aproximado: false,
    }));
  const datas = rows.map((r) => r.atualizado_em).filter(Boolean).sort();
  const ultimaAtualizacao = datas.length ? new Date(datas[datas.length - 1]) : new Date();
  return { fundos, ultimaAtualizacao };
}

const labelStyle = {
  display: "block",
  fontSize: 12,
  color: TOKENS.inkSoft,
  marginBottom: 8,
  textTransform: "uppercase",
  letterSpacing: 0.5,
};

const inputStyle = {
  width: "100%",
  boxSizing: "border-box",
  padding: "8px 10px",
  fontSize: 15,
  fontFamily: "'Inter', sans-serif",
  border: `1px solid ${TOKENS.line}`,
  background: "#fff",
  color: TOKENS.ink,
};

const th = (align = "left", extra = {}) => ({
  textAlign: align,
  padding: "6px 8px",
  fontWeight: 600,
  ...extra,
});

function Chip({ ativo, cor, onClick, children, flex }) {
  return (
    <button
      className="fii-chip"
      onClick={onClick}
      style={{
        flex: flex ? 1 : undefined,
        padding: "8px 12px",
        fontSize: 13,
        fontFamily: "'Inter', sans-serif",
        cursor: "pointer",
        border: `1px solid ${ativo ? cor : TOKENS.line}`,
        background: ativo ? cor : "transparent",
        color: ativo ? "#fff" : TOKENS.ink,
      }}
    >
      {children}
    </button>
  );
}

export default function FiiScreenerSimulador({ supabase } = {}) {
  const cfg = { ...SUPABASE_CONFIG, ...(supabase || {}) };
  const supabaseConfigurado = Boolean(cfg.url && cfg.anonKey);
  const [perfil, setPerfil] = useState("Moderado");
  const [aporte, setAporte] = useState(500);
  const [prazoAnos, setPrazoAnos] = useState(10);
  const [varCota, setVarCota] = useState(0);
  const [inflacao, setInflacao] = useState(4);
  const [modoValores, setModoValores] = useState("real");
  const [sortKey, setSortKey] = useState("score");
  const [fonte, setFonte] = useState("exemplo");
  const [fundosReais, setFundosReais] = useState(null);
  const [statusBusca, setStatusBusca] = useState("idle");
  const [erroBusca, setErroBusca] = useState(null);
  const [atualizadoEm, setAtualizadoEm] = useState(null);
  const [pesos, setPesos] = useState(DEFAULT_WEIGHTS);
  const [escolhas, setEscolhas] = useState({});

  const fundosBase = fonte === "real" && fundosReais ? fundosReais : FUNDS;

  const handleBuscarReais = async () => {
    setStatusBusca("carregando");
    setErroBusca(null);
    try {
      const { fundos, ultimaAtualizacao } = await buscarDadosSupabase(cfg);
      setFundosReais(fundos);
      setFonte("real");
      setEscolhas({});
      setAtualizadoEm(ultimaAtualizacao);
      setStatusBusca("ok");
    } catch (e) {
      setErroBusca(e.message || "Falha ao carregar dados reais");
      setStatusBusca("erro");
    }
  };

  const scoredFunds = useMemo(() => computeScores(fundosBase, pesos), [fundosBase, pesos]);
  const somaPesos = pesos.dy + pesos.pvp + pesos.liq + pesos.risco || 1;
  const setPeso = (chave) => (e) => setPesos((p) => ({ ...p, [chave]: Number(e.target.value) }));

  // Fundo pré-selecionado por segmento = maior score nos critérios atuais;
  // o usuário pode trocar por qualquer outro do mesmo segmento.
  const porSegmento = useMemo(() => {
    const mapa = {};
    for (const seg of SEGMENTS) {
      mapa[seg] = scoredFunds
        .filter((f) => f.segmento === seg)
        .sort((a, b) => b.score - a.score);
    }
    return mapa;
  }, [scoredFunds]);

  useEffect(() => {
    setEscolhas((prev) => {
      const next = { ...prev };
      for (const seg of SEGMENTS) {
        const lista = porSegmento[seg];
        if (!lista.length) {
          delete next[seg];
          continue;
        }
        if (!next[seg] || !lista.some((f) => f.ticker === next[seg])) {
          next[seg] = lista[0].ticker;
        }
      }
      return next;
    });
  }, [porSegmento]);

  const carteira = useMemo(() => {
    const pesosPerfil = PROFILES[perfil];
    const linhas = SEGMENTS.map((seg) => {
      const fundo = porSegmento[seg].find((f) => f.ticker === escolhas[seg]) || null;
      return { segmento: seg, pct: pesosPerfil[seg], fundo, opcoes: porSegmento[seg] };
    });
    const pctTotal = linhas.reduce((s, l) => s + l.pct, 0) || 1;
    const dyBlend = linhas.reduce(
      (s, l) => s + (l.pct / pctTotal) * (l.fundo ? l.fundo.dy : 0),
      0
    );
    return { linhas, dyBlend };
  }, [perfil, porSegmento, escolhas]);

  const meses = prazoAnos * 12;

  const resultados = useMemo(() => {
    const out = {};
    for (const nome of Object.keys(CENARIOS)) {
      const { mensalTotal, mensalDY } = taxasCenario(carteira.dyBlend, varCota, CENARIOS[nome]);
      const calc = (m) => {
        const nominal = fvValor(aporte, mensalTotal, m);
        const div = nominal * mensalDY;
        const d = modoValores === "real" ? deflator(inflacao, m) : 1;
        return { patrimonio: nominal / d, dividendo: div / d };
      };
      out[nome] = {
        atual: calc(meses),
        cenarios: [2, 5, 10, 20, 30].map((anos) => ({ anos, ...calc(anos * 12) })),
        serie: (() => {
          const pontos = [];
          const passo = meses > 60 ? 12 : 1;
          for (let m = 0; m <= meses; m += passo) pontos.push({ m, v: calc(m).patrimonio });
          if (pontos[pontos.length - 1].m !== meses) pontos.push({ m: meses, v: calc(meses).patrimonio });
          return pontos;
        })(),
      };
    }
    return out;
  }, [carteira.dyBlend, varCota, aporte, meses, modoValores, inflacao]);

  const chartData = resultados.base.serie.map((p, i) => ({
    ano: +(p.m / 12).toFixed(1),
    pessimista: Math.round(resultados.pessimista.serie[i].v),
    base: Math.round(p.v),
    otimista: Math.round(resultados.otimista.serie[i].v),
  }));

  const sortDef = SORT_OPTIONS.find((s) => s.key === sortKey);
  const listaOrdenada = [...scoredFunds].sort((a, b) => {
    const av = a[sortKey] ?? Infinity;
    const bv = b[sortKey] ?? Infinity;
    return (av - bv) * sortDef.dir;
  });

  const sufixo = modoValores === "real" ? "(valor de hoje)" : "(nominal)";

  return (
    <div
      style={{
        fontFamily: "'Inter', sans-serif",
        background: TOKENS.paper,
        color: TOKENS.ink,
        padding: "2.5rem 1.5rem",
        minHeight: "100%",
      }}
    >
      <style>{`
        ${FONT_IMPORT}
        .fii-head { font-family: 'Besley', serif; }
        .fii-num { font-variant-numeric: tabular-nums; }
        .fii-chip { transition: background-color .15s ease, color .15s ease, border-color .15s ease; }
        .fii-row:hover { background: ${TOKENS.paperSoft}; }
        .fii-grid { display: grid; gap: 24px; }
        .fii-grid-3 { grid-template-columns: repeat(3, 1fr); }
        .fii-grid-4 { grid-template-columns: repeat(4, 1fr); }
        .fii-scroll { overflow-x: auto; }
        .fii-stats { display: flex; gap: 28px; flex-wrap: wrap; }
        button:focus-visible, input:focus-visible, select:focus-visible {
          outline: 2px solid ${TOKENS.navy}; outline-offset: 2px;
        }
        @media (max-width: 720px) {
          .fii-grid-3, .fii-grid-4 { grid-template-columns: 1fr; }
          .fii-stats { gap: 16px; }
        }
        input[type="number"]::-webkit-inner-spin-button { opacity: 1; }
      `}</style>

      <div style={{ maxWidth: 1040, margin: "0 auto" }}>
        {/* Header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            flexWrap: "wrap",
            gap: 12,
            borderBottom: `2px solid ${TOKENS.ink}`,
            paddingBottom: 20,
            marginBottom: 28,
          }}
        >
          <div>
            <p style={{ margin: 0, fontSize: 12, letterSpacing: 1, color: TOKENS.inkSoft, textTransform: "uppercase" }}>
              Dossiê de fundos imobiliários
            </p>
            <h1 className="fii-head" style={{ margin: "6px 0 8px", fontSize: 32, fontWeight: 700, lineHeight: 1.1 }}>
              Simulador e comparador de FIIs
            </h1>
            <p style={{ margin: 0, maxWidth: 520, color: TOKENS.inkSoft, fontSize: 14.5 }}>
              Compare fundos pelos critérios que você define, monte a sua carteira por
              segmento e veja três cenários de patrimônio em valor de hoje.
            </p>
          </div>
          <div style={{ border: `1px solid ${TOKENS.ink}`, padding: "6px 12px", fontSize: 11.5, letterSpacing: 0.5, color: TOKENS.inkSoft, whiteSpace: "nowrap" }}>
            PROTÓTIPO · DADOS ILUSTRATIVOS
          </div>
        </div>

        {/* Fonte de dados */}
        <section style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 20 }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <Chip ativo={fonte === "exemplo"} cor={TOKENS.ink} onClick={() => setFonte("exemplo")}>
              Dados de exemplo
            </Chip>
            <button
              className="fii-chip"
              onClick={handleBuscarReais}
              disabled={statusBusca === "carregando" || !supabaseConfigurado}
              title={supabaseConfigurado ? "" : "Configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY (veja o README)"}
              style={{
                padding: "8px 12px",
                fontSize: 13,
                fontFamily: "'Inter', sans-serif",
                cursor: statusBusca === "carregando" ? "wait" : supabaseConfigurado ? "pointer" : "not-allowed",
                opacity: supabaseConfigurado ? 1 : 0.55,
                border: `1px solid ${fonte === "real" ? TOKENS.forest : TOKENS.line}`,
                background: fonte === "real" ? TOKENS.forest : "transparent",
                color: fonte === "real" ? "#fff" : TOKENS.ink,
              }}
            >
              {statusBusca === "carregando"
                ? "Carregando do banco..."
                : fonte === "real"
                ? "Recarregar dados reais"
                : "Carregar dados reais (Supabase)"}
            </button>
          </div>
          {fonte === "real" && atualizadoEm && (
            <p style={{ margin: 0, fontSize: 12, color: TOKENS.inkSoft }}>
              Atualizado {atualizadoEm.toLocaleString("pt-BR")}
            </p>
          )}
        </section>

        {statusBusca === "erro" && (
          <div style={{ border: `1px solid ${TOKENS.brick}`, background: TOKENS.paperSoft, color: TOKENS.brickDark, padding: "10px 14px", fontSize: 13, marginBottom: 20 }}>
            Não consegui carregar os dados reais ({erroBusca}). Os dados de exemplo continuam em uso.
          </div>
        )}

        {/* Parâmetros */}
        <section className="fii-grid fii-grid-3" style={{ border: `1px solid ${TOKENS.line}`, background: TOKENS.paperSoft, padding: "20px 24px", marginBottom: 20 }}>
          <div>
            <label style={labelStyle}>Perfil de investidor</label>
            <div style={{ display: "flex", gap: 6 }}>
              {Object.keys(PROFILES).map((p) => (
                <Chip key={p} flex ativo={perfil === p} cor={TOKENS.brick} onClick={() => setPerfil(p)}>
                  {p}
                </Chip>
              ))}
            </div>
          </div>
          <div>
            <label style={labelStyle}>Aporte mensal (R$)</label>
            <input
              type="number"
              min={0}
              step={50}
              value={aporte}
              onChange={(e) => setAporte(Math.max(0, Number(e.target.value) || 0))}
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>Prazo (anos)</label>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              {[2, 5, 10, 20, 30].map((a) => (
                <Chip key={a} ativo={prazoAnos === a} cor={TOKENS.navy} onClick={() => setPrazoAnos(a)}>
                  {a}a
                </Chip>
              ))}
              <input
                type="number"
                min={1}
                max={50}
                value={prazoAnos}
                onChange={(e) => setPrazoAnos(Math.min(50, Math.max(1, Number(e.target.value) || 1)))}
                aria-label="Prazo em anos"
                style={{ ...inputStyle, width: 72, padding: "7px 8px", fontSize: 13 }}
              />
            </div>
          </div>
        </section>

        {/* Premissas de retorno */}
        <section className="fii-grid fii-grid-3" style={{ border: `1px solid ${TOKENS.line}`, padding: "20px 24px", marginBottom: 28 }}>
          <div>
            <div style={{ ...labelStyle, display: "flex", justifyContent: "space-between" }}>
              <span>Variação anual da cota (base)</span>
              <span className="fii-num">{varCota > 0 ? "+" : ""}{varCota}%</span>
            </div>
            <input
              type="range"
              min={-10}
              max={10}
              step={1}
              value={varCota}
              onChange={(e) => setVarCota(Number(e.target.value))}
              style={{ width: "100%", accentColor: TOKENS.navy }}
              aria-label="Variação anual da cota no cenário base"
            />
            <p style={{ margin: "6px 0 0", fontSize: 12, color: TOKENS.inkSoft, lineHeight: 1.5 }}>
              Pessimista: cota {CENARIOS.pessimista.cota} p.p. e DY {CENARIOS.pessimista.dy} p.p. ·
              Otimista: +{CENARIOS.otimista.cota} / +{CENARIOS.otimista.dy} p.p.
            </p>
          </div>
          <div>
            <label style={labelStyle}>Inflação estimada (% a.a.)</label>
            <input
              type="number"
              min={0}
              max={20}
              step={0.5}
              value={inflacao}
              onChange={(e) => setInflacao(Math.max(0, Number(e.target.value) || 0))}
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>Mostrar valores</label>
            <div style={{ display: "flex", gap: 6 }}>
              <Chip flex ativo={modoValores === "real"} cor={TOKENS.forest} onClick={() => setModoValores("real")}>
                Em valor de hoje
              </Chip>
              <Chip flex ativo={modoValores === "nominal"} cor={TOKENS.forest} onClick={() => setModoValores("nominal")}>
                Nominais
              </Chip>
            </div>
            <p style={{ margin: "6px 0 0", fontSize: 12, color: TOKENS.inkSoft, lineHeight: 1.5 }}>
              "Valor de hoje" desconta a inflação — é o que o dinheiro compraria agora.
            </p>
          </div>
        </section>

        {/* Pesos do score */}
        <section style={{ border: `1px solid ${TOKENS.line}`, padding: "20px 24px", marginBottom: 28 }}>
          <h2 className="fii-head" style={{ fontSize: 18, fontWeight: 700, margin: "0 0 4px" }}>
            Como o score é calculado
          </h2>
          <p style={{ margin: "0 0 18px", fontSize: 13, color: TOKENS.inkSoft }}>
            Ajuste o peso de cada critério e veja o ranking mudar. O score não é uma
            recomendação: é o resultado do que você decide priorizar.
          </p>
          <div className="fii-grid fii-grid-4">
            {[
              { chave: "dy", rotulo: "Dividend yield" },
              { chave: "pvp", rotulo: "Desconto sobre P/VP" },
              { chave: "liq", rotulo: "Liquidez" },
              { chave: "risco", rotulo: "Menos risco operacional" },
            ].map((item) => (
              <div key={item.chave}>
                <div style={{ ...labelStyle, display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                  <span>{item.rotulo}</span>
                  <span className="fii-num">{Math.round((pesos[item.chave] / somaPesos) * 100)}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={pesos[item.chave]}
                  onChange={setPeso(item.chave)}
                  style={{ width: "100%", accentColor: TOKENS.brick }}
                  aria-label={`Peso de ${item.rotulo}`}
                />
              </div>
            ))}
          </div>
          <p style={{ margin: "14px 0 0", fontSize: 12, color: TOKENS.inkSoft, lineHeight: 1.5 }}>
            Risco operacional = parte do portfólio que não gera renda hoje: vacância física
            (fundos de imóveis), inadimplência (papel e FOFs) ou área ainda em obra (desenvolvimento).
          </p>
        </section>

        {/* Carteira */}
        <section style={{ marginBottom: 28 }}>
          <h2 className="fii-head" style={{ fontSize: 18, fontWeight: 700, margin: "0 0 4px" }}>
            Sua carteira (perfil {perfil})
          </h2>
          <p style={{ margin: "0 0 14px", fontSize: 13, color: TOKENS.inkSoft }}>
            Cada segmento começa com o fundo de maior score nos seus critérios. Troque
            livremente — a projeção recalcula com a sua escolha.
          </p>
          <div className="fii-scroll">
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5, minWidth: 560 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${TOKENS.ink}` }}>
                  <th style={th()}>Segmento</th>
                  <th style={th()}>Fundo (você escolhe)</th>
                  <th style={th("right")}>DY</th>
                  <th style={th("right")}>%</th>
                  <th style={th("right")}>Valor/mês</th>
                </tr>
              </thead>
              <tbody>
                {carteira.linhas.map((l) => (
                  <tr key={l.segmento} className="fii-row" style={{ borderBottom: `1px solid ${TOKENS.line}`, opacity: l.pct === 0 ? 0.55 : 1 }}>
                    <td style={{ padding: "8px" }}>{l.segmento}</td>
                    <td style={{ padding: "8px" }}>
                      {l.opcoes.length ? (
                        <select
                          value={escolhas[l.segmento] || ""}
                          onChange={(e) => setEscolhas((p) => ({ ...p, [l.segmento]: e.target.value }))}
                          aria-label={`Fundo para o segmento ${l.segmento}`}
                          style={{ ...inputStyle, padding: "6px 8px", fontSize: 13, width: "100%", maxWidth: 360 }}
                        >
                          {l.opcoes.map((f) => (
                            <option key={f.ticker} value={f.ticker}>
                              {f.ticker} · {f.nome} (score {f.score})
                            </option>
                          ))}
                        </select>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="fii-num" style={{ padding: "8px", textAlign: "right" }}>
                      {l.fundo ? `${l.fundo.dy.toFixed(1)}%` : "—"}
                    </td>
                    <td className="fii-num" style={{ padding: "8px", textAlign: "right" }}>{l.pct}%</td>
                    <td className="fii-num" style={{ padding: "8px", textAlign: "right" }}>{brl((aporte * l.pct) / 100)}</td>
                  </tr>
                ))}
                <tr>
                  <td colSpan={2} style={{ padding: "8px", fontWeight: 600 }}>Total · DY médio ponderado</td>
                  <td className="fii-num" style={{ padding: "8px", textAlign: "right", fontWeight: 600 }}>{carteira.dyBlend.toFixed(1)}%</td>
                  <td className="fii-num" style={{ padding: "8px", textAlign: "right", fontWeight: 600 }}>100%</td>
                  <td className="fii-num" style={{ padding: "8px", textAlign: "right", fontWeight: 600 }}>{brl(aporte)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* Projeção */}
        <section style={{ marginBottom: 28, border: `1px solid ${TOKENS.line}`, padding: "20px 24px" }}>
          <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "baseline", gap: 16, marginBottom: 16 }}>
            <h2 className="fii-head" style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>
              Projeção em {prazoAnos} anos {sufixo}
            </h2>
            <div className="fii-stats">
              <div>
                <p style={{ margin: 0, fontSize: 11.5, color: TOKENS.inkSoft, textTransform: "uppercase" }}>Patrimônio (cenário base)</p>
                <p className="fii-num" style={{ margin: 0, fontSize: 20, fontWeight: 700, color: TOKENS.forest }}>
                  {brl(resultados.base.atual.patrimonio)}
                </p>
                <p className="fii-num" style={{ margin: 0, fontSize: 12, color: TOKENS.inkSoft }}>
                  entre {brl(resultados.pessimista.atual.patrimonio)} e {brl(resultados.otimista.atual.patrimonio)}
                </p>
              </div>
              <div>
                <p style={{ margin: 0, fontSize: 11.5, color: TOKENS.inkSoft, textTransform: "uppercase" }}>Renda mensal (cenário base)</p>
                <p className="fii-num" style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>
                  {brlCents(resultados.base.atual.dividendo)}
                </p>
                <p className="fii-num" style={{ margin: 0, fontSize: 12, color: TOKENS.inkSoft }}>
                  entre {brlCents(resultados.pessimista.atual.dividendo)} e {brlCents(resultados.otimista.atual.dividendo)}
                </p>
              </div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 12, color: TOKENS.inkSoft, marginBottom: 6 }}>
            <span><span style={{ display: "inline-block", width: 18, borderTop: `2px dashed ${TOKENS.inkSoft}`, verticalAlign: "middle", marginRight: 6 }} />Pessimista</span>
            <span><span style={{ display: "inline-block", width: 18, borderTop: `2px solid ${TOKENS.brick}`, verticalAlign: "middle", marginRight: 6 }} />Base</span>
            <span><span style={{ display: "inline-block", width: 18, borderTop: `2px dotted ${TOKENS.forest}`, verticalAlign: "middle", marginRight: 6 }} />Otimista</span>
          </div>

          <div style={{ width: "100%", height: 260 }}>
            <ResponsiveContainer>
              <LineChart data={chartData} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid stroke={TOKENS.line} strokeDasharray="0" vertical={false} />
                <XAxis dataKey="ano" tickFormatter={(v) => `${v}a`} stroke={TOKENS.inkSoft} fontSize={12} tickLine={false} />
                <YAxis tickFormatter={(v) => `${Math.round(v / 1000)}k`} stroke={TOKENS.inkSoft} fontSize={12} tickLine={false} axisLine={false} width={44} />
                <Tooltip
                  formatter={(v, nome) => [brl(v), nome[0].toUpperCase() + nome.slice(1)]}
                  labelFormatter={(v) => `Ano ${v}`}
                  contentStyle={{ fontFamily: "'Inter', sans-serif", fontSize: 13, border: `1px solid ${TOKENS.line}` }}
                />
                <Line type="monotone" dataKey="pessimista" stroke={TOKENS.inkSoft} strokeWidth={1.5} strokeDasharray="6 4" dot={false} />
                <Line type="monotone" dataKey="base" stroke={TOKENS.brick} strokeWidth={2.2} dot={false} />
                <Line type="monotone" dataKey="otimista" stroke={TOKENS.forest} strokeWidth={1.5} strokeDasharray="2 3" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="fii-scroll">
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5, marginTop: 20, minWidth: 520 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${TOKENS.ink}` }}>
                  <th style={th()}>Cenário</th>
                  <th style={th("right")}>Patrimônio base</th>
                  <th style={th("right")}>Faixa (pess. – otim.)</th>
                  <th style={th("right")}>Renda/mês base</th>
                </tr>
              </thead>
              <tbody>
                {resultados.base.cenarios.map((c, i) => {
                  const p = resultados.pessimista.cenarios[i];
                  const o = resultados.otimista.cenarios[i];
                  const ativo = c.anos === prazoAnos;
                  return (
                    <tr key={c.anos} className="fii-row" style={{ borderBottom: `1px solid ${TOKENS.line}`, background: ativo ? TOKENS.paperSoft : "transparent" }}>
                      <td style={{ padding: "8px", fontWeight: ativo ? 600 : 400 }}>{c.anos} anos</td>
                      <td className="fii-num" style={{ padding: "8px", textAlign: "right", fontWeight: ativo ? 600 : 400 }}>{brl(c.patrimonio)}</td>
                      <td className="fii-num" style={{ padding: "8px", textAlign: "right", color: TOKENS.inkSoft }}>
                        {brl(p.patrimonio)} – {brl(o.patrimonio)}
                      </td>
                      <td className="fii-num" style={{ padding: "8px", textAlign: "right" }}>{brlCents(c.dividendo)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {/* Screener */}
        <section style={{ marginBottom: 28 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 12, marginBottom: 14 }}>
            <h2 className="fii-head" style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>
              Todos os fundos ({fundosBase.length})
              {fonte === "real" && (
                <span style={{ fontSize: 12, fontWeight: 400, color: TOKENS.forest, marginLeft: 8 }}>· dados do seu banco (pipeline n8n)</span>
              )}
            </h2>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <label style={{ fontSize: 12, color: TOKENS.inkSoft }}>Ordenar por</label>
              <select
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value)}
                style={{ ...inputStyle, width: "auto", padding: "6px 8px", fontSize: 13 }}
              >
                {SORT_OPTIONS.map((o) => (
                  <option key={o.key} value={o.key}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="fii-scroll">
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 720 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${TOKENS.ink}` }}>
                  <th style={th()}>Fundo</th>
                  <th style={th()}>Segmento</th>
                  <th style={th("right")}>DY a.a.</th>
                  <th style={th("right")}>P/VP</th>
                  <th style={th("right")}>Liquidez/dia</th>
                  <th style={th("right")}>Sem renda</th>
                  <th style={th("left", { width: 140 })}>Score</th>
                </tr>
              </thead>
              <tbody>
                {listaOrdenada.map((f) => (
                  <tr key={f.ticker} className="fii-row" style={{ borderBottom: `1px solid ${TOKENS.line}` }}>
                    <td style={{ padding: "8px" }}>
                      <div style={{ fontWeight: 600 }}>
                        {f.ticker}
                        {f.aproximado && <span style={{ fontWeight: 400, fontSize: 11.5, color: TOKENS.inkSoft }}> ≈ aprox.</span>}
                      </div>
                      <div style={{ fontSize: 12, color: TOKENS.inkSoft }}>{f.nome}</div>
                    </td>
                    <td style={{ padding: "8px", color: TOKENS.inkSoft }}>{f.segmento}</td>
                    <td className="fii-num" style={{ padding: "8px", textAlign: "right", color: TOKENS.forest, fontWeight: 600 }}>{f.dy.toFixed(1)}%</td>
                    <td className="fii-num" style={{ padding: "8px", textAlign: "right" }}>{f.pvp.toFixed(2)}</td>
                    <td className="fii-num" style={{ padding: "8px", textAlign: "right" }}>{brl(f.liquidez)}</td>
                    <td className="fii-num" style={{ padding: "8px", textAlign: "right" }} title={f.riscoTipo}>
                      {f.risco == null ? "—" : `${f.risco}%`}
                      <div style={{ fontSize: 11.5, color: TOKENS.inkSoft, fontWeight: 400 }}>{f.riscoTipo}</div>
                    </td>
                    <td style={{ padding: "8px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ flex: 1, height: 6, background: TOKENS.line }}>
                          <div style={{ height: "100%", width: `${f.score}%`, background: TOKENS.brick }} />
                        </div>
                        <span className="fii-num" style={{ fontSize: 12, minWidth: 22, textAlign: "right" }}>{f.score}</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Disclaimer */}
        <section style={{ borderTop: `2px solid ${TOKENS.ink}`, paddingTop: 16, fontSize: 12.5, color: TOKENS.inkSoft, lineHeight: 1.6 }}>
          {fonte === "real"
            ? "Modo \u201cdados reais\u201d: os números vêm do seu banco de dados, atualizado pela rotina diária do pipeline (última atualização indicada acima). Confira sempre na B3 ou no site do próprio fundo antes de decidir."
            : "Ferramenta ilustrativa com dados fictícios, para fins educacionais."}{" "}
          Não constitui recomendação de investimento nem análise de qualquer fundo (CVM Res.
          19/2021): o fundo pré-selecionado em cada segmento é apenas o de maior score nos
          critérios e pesos que você escolheu, e você pode trocá-lo. As projeções são cenários
          hipotéticos que dependem das premissas informadas (variação da cota, inflação,
          dividend yield constante e reinvestimento integral) — não são previsões. Rentabilidade
          passada não garante resultado futuro; cotas de FII podem perder valor.
        </section>
      </div>
    </div>
  );
}
