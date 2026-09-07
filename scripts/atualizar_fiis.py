"""
Atualiza a tabela `funds` do Supabase com dados abertos e oficiais:

  - CVM (Informe Mensal Estruturado de FII): valor patrimonial por cota,
    dividend yield mensal, segmento de atuação, mandato, composição (CRI, FII).
  - B3 (Cotações Históricas - COTAHIST): preço de fechamento e volume diário.
  - CVM (Informe Trimestral de FII, opcional): vacância por imóvel -> risco.

A ponte entre CVM (CNPJ) e B3 (ticker) é o código ISIN, presente nos dois.

Uso:
  python atualizar_fiis.py                 # baixa, calcula e grava no Supabase
  python atualizar_fiis.py --dry-run       # baixa, calcula e só imprime
  python atualizar_fiis.py --dry-run --fixtures pasta/   # usa arquivos locais (testes)

Variáveis de ambiente (para gravar):
  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
Opcionais:
  TICKERS="MXRF11,HGLG11,..."   restringe aos tickers listados
  MIN_LIQUIDEZ=200000            ignora fundos com volume médio diário abaixo (R$)
"""

from __future__ import annotations

import argparse
import io
import json
import logging
import os
import sys
import time
import unicodedata
import zipfile
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pandas as pd
import requests

log = logging.getLogger("fii")
logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

CVM_MENSAL = "https://dados.cvm.gov.br/dados/FII/DOC/INF_MENSAL/DADOS/inf_mensal_fii_{ano}.zip"
CVM_TRIMESTRAL = "https://dados.cvm.gov.br/dados/FII/DOC/INF_TRIMESTRAL/DADOS/inf_trimestral_fii_{ano}.zip"
B3_COTAHIST = "https://bvmf.bmfbovespa.com.br/InstDados/SerHist/COTAHIST_A{ano}.ZIP"

SEGMENTOS = ["PAPEL", "TIJOLO", "HÍBRIDOS", "FOFs", "DESENVOLVIMENTO", "HOTELARIAS"]

# Layout fixo do COTAHIST (posições 1-based, inclusivas) - documento oficial da B3.
COTAHIST_LAYOUT = {
    "TIPREG": (1, 2),
    "DATA": (3, 10),
    "CODBDI": (11, 12),
    "CODNEG": (13, 24),
    "TPMERC": (25, 27),
    "PREULT": (109, 121),
    "TOTNEG": (148, 152),
    "VOLTOT": (171, 188),
    "CODISI": (231, 242),
}


# --------------------------------------------------------------------------- utilidades

def baixar(url: str, timeout: int = 300, tentativas: int = 3) -> bytes:
    """Download com novas tentativas: os servidores da B3/CVM derrubam conexoes longas as vezes."""
    ultimo_erro = None
    for n in range(1, tentativas + 1):
        log.info("Baixando %s (tentativa %d/%d)", url, n, tentativas)
        try:
            r = requests.get(url, timeout=timeout, headers={"User-Agent": "simulador-fii/1.0"})
            r.raise_for_status()
            return r.content
        except (requests.ConnectionError, requests.Timeout, requests.exceptions.ChunkedEncodingError) as e:
            ultimo_erro = e
            log.warning("Falha na tentativa %d: %s", n, e)
            time.sleep(10 * n)
    raise RuntimeError(f"Download falhou apos {tentativas} tentativas: {url}") from ultimo_erro


def ler_csvs_do_zip(conteudo: bytes, contem: str) -> pd.DataFrame:
    """Lê todos os CSVs dentro do zip cujo nome contém `contem` e concatena."""
    partes = []
    with zipfile.ZipFile(io.BytesIO(conteudo)) as z:
        for nome in z.namelist():
            if contem in nome.lower() and nome.lower().endswith(".csv"):
                bruto = z.read(nome)
                try:
                    texto = bruto.decode("utf-8")
                except UnicodeDecodeError:
                    texto = bruto.decode("latin-1")
                partes.append(pd.read_csv(io.StringIO(texto), sep=";", dtype=str))
    if not partes:
        raise FileNotFoundError(f"Nenhum CSV com '{contem}' no zip")
    return pd.concat(partes, ignore_index=True)


def coluna(df: pd.DataFrame, *candidatas: str, obrigatoria: bool = True) -> str | None:
    """Encontra a primeira coluna existente entre as candidatas (case-insensitive)."""
    mapa = {c.lower(): c for c in df.columns}
    for cand in candidatas:
        if cand.lower() in mapa:
            return mapa[cand.lower()]
    if obrigatoria:
        raise KeyError(f"Coluna não encontrada. Candidatas: {candidatas}. Disponíveis: {list(df.columns)[:40]}")
    return None


def sem_acento(txt) -> str:
    """minúsculas e sem acentos, para comparar rótulos da CVM com segurança."""
    txt = "" if txt is None else str(txt)
    return unicodedata.normalize("NFKD", txt).encode("ascii", "ignore").decode().lower()


def numero(serie: pd.Series) -> pd.Series:
    return pd.to_numeric(serie.astype(str).str.replace(",", ".", regex=False), errors="coerce")


def anos_necessarios(hoje: date, meses: int = 14) -> list[int]:
    inicio = hoje - timedelta(days=31 * meses)
    return sorted({inicio.year, hoje.year})


# --------------------------------------------------------------------------- B3

def parse_cotahist(texto: str) -> pd.DataFrame:
    linhas = []
    for l in texto.splitlines():
        if not l.startswith("01"):
            continue
        rec = {k: l[a - 1:b].strip() for k, (a, b) in COTAHIST_LAYOUT.items()}
        if rec["CODBDI"] != "12" or rec["TPMERC"] != "010":   # 12 = fundos imobiliários, 010 = mercado à vista
            continue
        linhas.append(rec)
    df = pd.DataFrame(linhas)
    if df.empty:
        return df
    df["data"] = pd.to_datetime(df["DATA"], format="%Y%m%d")
    df["preco"] = pd.to_numeric(df["PREULT"], errors="coerce") / 100.0
    df["volume"] = pd.to_numeric(df["VOLTOT"], errors="coerce") / 100.0
    df["negocios"] = pd.to_numeric(df["TOTNEG"], errors="coerce")
    return df.rename(columns={"CODNEG": "ticker", "CODISI": "isin"})[
        ["ticker", "isin", "data", "preco", "volume", "negocios"]
    ]


def carregar_b3(anos: list[int], fixtures: Path | None) -> pd.DataFrame:
    partes = []
    for ano in anos:
        if fixtures:
            caminho = fixtures / f"COTAHIST_A{ano}.TXT"
            if not caminho.exists():
                continue
            texto = caminho.read_text(encoding="latin-1")
        else:
            try:
                conteudo = baixar(B3_COTAHIST.format(ano=ano))
            except requests.HTTPError as e:
                log.warning("B3 %s indisponível (%s)", ano, e)
                continue
            with zipfile.ZipFile(io.BytesIO(conteudo)) as z:
                nome = [n for n in z.namelist() if n.upper().endswith(".TXT")][0]
                texto = z.read(nome).decode("latin-1")
        partes.append(parse_cotahist(texto))
    if not partes:
        raise RuntimeError("Nenhuma cotação da B3 carregada")
    return pd.concat(partes, ignore_index=True)


def resumir_b3(cot: pd.DataFrame, janela_dias: int = 30) -> pd.DataFrame:
    cot = cot.sort_values("data")
    ultimo = cot.groupby("ticker").tail(1).set_index("ticker")
    corte = cot["data"].max() - pd.Timedelta(days=int(janela_dias * 1.5))
    recente = cot[cot["data"] >= corte]
    liq = recente.groupby("ticker")["volume"].mean().rename("liquidez")
    out = ultimo[["isin", "preco", "data"]].join(liq)
    out = out.rename(columns={"data": "data_preco"})
    # tickers de FII terminam em 11 (ou 11B etc.); descarta recibos/direitos (12, 13...)
    return out[out.index.str.match(r"^[A-Z]{4}11B?$")]


# --------------------------------------------------------------------------- CVM mensal

def carregar_cvm_mensal(anos: list[int], fixtures: Path | None) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame | None]:
    gerais, compls, ativos = [], [], []
    for ano in anos:
        if fixtures:
            caminho = fixtures / f"inf_mensal_fii_{ano}.zip"
            if not caminho.exists():
                continue
            conteudo = caminho.read_bytes()
        else:
            try:
                conteudo = baixar(CVM_MENSAL.format(ano=ano))
            except requests.HTTPError as e:
                log.warning("CVM mensal %s indisponível (%s)", ano, e)
                continue
        gerais.append(ler_csvs_do_zip(conteudo, "geral"))
        compls.append(ler_csvs_do_zip(conteudo, "complemento"))
        try:
            ativos.append(ler_csvs_do_zip(conteudo, "ativo_passivo"))
        except FileNotFoundError:
            pass
    if not gerais:
        raise RuntimeError("Nenhum informe mensal da CVM carregado")
    ativo = pd.concat(ativos, ignore_index=True) if ativos else None
    return pd.concat(gerais, ignore_index=True), pd.concat(compls, ignore_index=True), ativo


def resumir_cvm(geral: pd.DataFrame, compl: pd.DataFrame, ativo: pd.DataFrame | None = None) -> pd.DataFrame:
    c_cnpj = coluna(geral, "CNPJ_Fundo_Classe", "CNPJ_Fundo", "CNPJ_FUNDO")
    c_data = coluna(geral, "Data_Referencia", "DT_REFER")
    c_nome = coluna(geral, "Nome_Fundo_Classe", "Nome_Fundo", "DENOM_SOCIAL")
    c_isin = coluna(geral, "Codigo_ISIN", "Cod_ISIN", "ISIN", obrigatoria=False)
    c_seg = coluna(geral, "Segmento_Atuacao", obrigatoria=False)
    c_mand = coluna(geral, "Mandato", obrigatoria=False)

    g = geral.copy()
    g["data"] = pd.to_datetime(g[c_data], errors="coerce")
    g = g.sort_values("data").groupby(c_cnpj).tail(1).set_index(c_cnpj)
    g = g.rename(columns={c_nome: "nome"})
    g["isin"] = g[c_isin].str.strip() if c_isin else None
    g["segmento_cvm"] = g[c_seg].fillna("") if c_seg else ""
    g["mandato"] = g[c_mand].fillna("") if c_mand else ""
    log.info("Segmento_Atuacao (top 12): %s", g["segmento_cvm"].value_counts().head(12).to_dict())
    log.info("Mandato (top 8): %s", g["mandato"].value_counts().head(8).to_dict())

    k_cnpj = coluna(compl, "CNPJ_Fundo_Classe", "CNPJ_Fundo", "CNPJ_FUNDO")
    k_data = coluna(compl, "Data_Referencia", "DT_REFER")
    k_vp = coluna(compl, "Valor_Patrimonial_Cotas", "Valor_Patrimonial_Cota", "Valor_Patrimonial_Cotas_Classe", "VL_PATRIM_COTA")
    k_dy = coluna(compl, "Percentual_Dividend_Yield_Mes", "Dividend_Yield_Mes", obrigatoria=False)
    k_pl = coluna(compl, "Patrimonio_Liquido", "VL_PATRIM_LIQ", obrigatoria=False)
    # Composicao da carteira (CRI, cotas de FII) vive no arquivo ativo_passivo,
    # nao no complemento. Se existir, traz as duas colunas para dentro de compl.
    k_cri = k_fii = None
    if ativo is not None:
        a_cnpj = coluna(ativo, "CNPJ_Fundo_Classe", "CNPJ_Fundo", obrigatoria=False)
        a_data = coluna(ativo, "Data_Referencia", obrigatoria=False)
        a_cri = coluna(ativo, "CRI", "Valor_CRI", "Certificados_Recebiveis_Imobiliarios", obrigatoria=False)
        a_fii = coluna(ativo, "FII", "Valor_FII", "Cotas_FII", "Fundos_Investimento_Imobiliario", obrigatoria=False)
        log.info("Colunas do ativo_passivo: %s", list(ativo.columns))
        if a_cnpj and a_data and (a_cri or a_fii):
            sub = ativo[[a_cnpj, a_data] + [c for c in (a_cri, a_fii) if c]].copy()
            sub = sub.rename(columns={a_cnpj: "CNPJ_Fundo_Classe", a_data: "Data_Referencia"})
            if a_cri: sub = sub.rename(columns={a_cri: "CRI"})
            if a_fii: sub = sub.rename(columns={a_fii: "FII"})
            compl = compl.merge(sub, left_on=[k_cnpj, k_data], right_on=["CNPJ_Fundo_Classe", "Data_Referencia"],
                                how="left", suffixes=("", "_ap"))
            k_cri = "CRI" if a_cri else None
            k_fii = "FII" if a_fii else None
    # fallback: alguns arquivos (e os fixtures de teste) trazem CRI/FII no proprio complemento
    k_cri = k_cri or coluna(compl, "CRI", obrigatoria=False)
    k_fii = k_fii or coluna(compl, "FII", obrigatoria=False)

    c = compl.copy()
    c["data"] = pd.to_datetime(c[k_data], errors="coerce")
    c["vp"] = numero(c[k_vp])
    c["dy_mes"] = numero(c[k_dy]) if k_dy else float("nan")
    # Administradores preenchem o DY mensal em unidades diferentes: fração (0,011)
    # ou percentual (1,1). Abaixo de 0,05 só faz sentido como fração -> converte.
    c["dy_mes"] = c["dy_mes"].where(c["dy_mes"] >= 0.05, c["dy_mes"] * 100)
    if not k_cri or not k_fii:
        log.warning("Colunas CRI/FII não encontradas no complemento. Disponíveis: %s", list(compl.columns))
    c["pl"] = numero(c[k_pl]) if k_pl else float("nan")
    c["cri"] = numero(c[k_cri]) if k_cri else 0.0
    c["fii"] = numero(c[k_fii]) if k_fii else 0.0
    c = c.sort_values("data")

    ultimo = c.groupby(k_cnpj).tail(1).set_index(k_cnpj)
    corte = c["data"].max() - pd.DateOffset(months=12)
    dy12 = c[c["data"] > corte].groupby(k_cnpj)["dy_mes"].sum(min_count=1).rename("dy_12m")
    meses = c[c["data"] > corte].groupby(k_cnpj)["dy_mes"].count().rename("meses_dy")

    out = g[["nome", "isin", "segmento_cvm", "mandato"]].join(
        ultimo[["vp", "pl", "cri", "fii", "data"]].rename(columns={"data": "data_informe"}), how="inner"
    ).join(dy12).join(meses)
    return out


def classificar(row) -> str:
    seg = sem_acento(row.get("segmento_cvm", ""))
    mand = sem_acento(row.get("mandato", ""))
    pl = row.get("pl") or 0
    frac_cri = (row.get("cri") or 0) / pl if pl else 0
    frac_fii = (row.get("fii") or 0) / pl if pl else 0
    if "desenvolv" in mand:
        return "DESENVOLVIMENTO"
    if "hotel" in seg:
        return "HOTELARIAS"
    if frac_fii >= 0.5:
        return "FOFs"
    if frac_cri >= 0.5 or "titulo" in seg or "titulo" in mand:
        return "PAPEL"
    if "hibrido" in seg or "hibrido" in mand:
        return "HÍBRIDOS"
    return "TIJOLO"


# --------------------------------------------------------------------------- CVM trimestral (risco, opcional)

def carregar_risco(anos: list[int], fixtures: Path | None) -> pd.Series | None:
    """Vacância média por CNPJ a partir do informe trimestral. Retorna None se não achar."""
    partes = []
    for ano in anos:
        try:
            if fixtures:
                caminho = fixtures / f"inf_trimestral_fii_{ano}.zip"
                if not caminho.exists():
                    continue
                conteudo = caminho.read_bytes()
            else:
                conteudo = baixar(CVM_TRIMESTRAL.format(ano=ano))
            with zipfile.ZipFile(io.BytesIO(conteudo)) as z:
                log.info("Arquivos no informe trimestral %s: %s", ano, z.namelist())
            df_tri = ler_csvs_do_zip(conteudo, "imovel_desempenho")
            log.info("Colunas do imovel_desempenho: %s", list(df_tri.columns))
            partes.append(df_tri)
        except Exception as e:  # noqa: BLE001 - opcional por desenho
            log.warning("Informe trimestral %s não utilizado (%s)", ano, e)
    if not partes:
        return None
    df = pd.concat(partes, ignore_index=True)
    try:
        c_cnpj = coluna(df, "CNPJ_Fundo_Classe", "CNPJ_Fundo", "CNPJ_FUNDO")
        c_data = coluna(df, "Data_Referencia", "DT_REFER")
        c_vac = coluna(df, "Percentual_Vacancia", "Percentual_Vacancia_Fisica", "Vacancia_Fisica",
                       "Percentual_Vacancia_Financeira", "Vacancia")
    except KeyError as e:
        log.warning("Colunas de vacância não encontradas: %s", e)
        return None
    df["data"] = pd.to_datetime(df[c_data], errors="coerce")
    df["vac"] = numero(df[c_vac])
    ultima = df.groupby(c_cnpj)["data"].transform("max")
    return df[df["data"] == ultima].groupby(c_cnpj)["vac"].mean().rename("risco")


# --------------------------------------------------------------------------- montagem

def montar_tabela(b3: pd.DataFrame, cvm: pd.DataFrame, risco: pd.Series | None,
                  tickers: set[str] | None, min_liq: float) -> pd.DataFrame:
    cvm = cvm.reset_index().rename(columns={cvm.index.name or "index": "cnpj"})
    cvm = cvm.dropna(subset=["isin"])
    b3r = b3.reset_index()
    df = b3r.merge(cvm, on="isin", how="inner")
    log.info("Pareados por ISIN: %d fundos (B3 %d, CVM %d)", len(df), len(b3r), len(cvm))

    df["segmento"] = df.apply(classificar, axis=1)
    df["pvp"] = (df["preco"] / df["vp"]).round(3)
    df["dy"] = df["dy_12m"].round(2)
    df["liquidez"] = df["liquidez"].round(0)

    if risco is not None:
        df = df.merge(risco.reset_index().rename(columns={risco.index.name or "index": "cnpj"}), on="cnpj", how="left")
        df["risco"] = df["risco"].round(2)
    else:
        df["risco"] = None
    df["risco_tipo"] = df["segmento"].map(
        lambda s: "Vacância física" if s in ("TIJOLO", "HÍBRIDOS", "HOTELARIAS", "DESENVOLVIMENTO") else "Inadimplência"
    )
    # sem vacância medida, não invente: deixa null para papel/FOF
    df.loc[df["segmento"].isin(["PAPEL", "FOFs"]), "risco"] = None

    df = df[df["dy"].notna() & df["pvp"].notna() & (df["vp"] > 0) & (df["preco"] > 0)]
    # descarta o que é erro de dado, não fundo: DY 12m impossível, P/VP absurdo, preço velho
    antes = len(df)
    df = df[(df["dy"] > 0) & (df["dy"] <= 40) & (df["pvp"] >= 0.2) & (df["pvp"] <= 3.0)]
    limite = df["data_preco"].max() - pd.Timedelta(days=20)
    df = df[df["data_preco"] >= limite]
    df = df.sort_values("data_informe").drop_duplicates("ticker", keep="last")
    log.info("Filtros de sanidade removeram %d fundos", antes - len(df))
    if tickers:
        df = df[df["ticker"].isin(tickers)]
    if min_liq:
        df = df[df["liquidez"].fillna(0) >= min_liq]
    df["nome"] = df["nome"].str.strip().str.slice(0, 80)
    df["atualizado_em"] = datetime.now(timezone.utc).isoformat()
    return df[["ticker", "nome", "segmento", "dy", "pvp", "liquidez", "risco", "risco_tipo",
               "atualizado_em", "meses_dy", "data_preco", "data_informe"]].sort_values("dy", ascending=False)


# --------------------------------------------------------------------------- Supabase

def gravar_supabase(df: pd.DataFrame, url: str, chave: str) -> None:
    linhas = json.loads(
        df[["ticker", "nome", "segmento", "dy", "pvp", "liquidez", "risco", "risco_tipo", "atualizado_em"]]
        .to_json(orient="records", force_ascii=False)
    )
    cab = {
        "apikey": chave,
        "Authorization": f"Bearer {chave}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }
    r = requests.post(f"{url.rstrip('/')}/rest/v1/funds?on_conflict=ticker", headers=cab, json=linhas, timeout=120)
    if not r.ok:
        log.error("Supabase respondeu %s: %s", r.status_code, r.text[:800])
    r.raise_for_status()
    log.info("Upsert de %d fundos concluído", len(linhas))


def registrar_execucao(url: str, chave: str, status: str, detalhe: str) -> None:
    cab = {"apikey": chave, "Authorization": f"Bearer {chave}", "Content-Type": "application/json"}
    try:
        requests.post(f"{url.rstrip('/')}/rest/v1/fetch_runs", headers=cab,
                      json={"status": status, "detalhe": detalhe[:500]}, timeout=30).raise_for_status()
    except Exception as e:  # noqa: BLE001
        log.warning("Não consegui registrar em fetch_runs: %s", e)


# --------------------------------------------------------------------------- main

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--fixtures", type=Path, default=None, help="pasta com arquivos locais para teste")
    ap.add_argument("--hoje", type=str, default=None, help="data de referência AAAA-MM-DD (testes)")
    args = ap.parse_args()

    hoje = date.fromisoformat(args.hoje) if args.hoje else date.today()
    anos = anos_necessarios(hoje)
    tickers = {t.strip().upper() for t in os.getenv("TICKERS", "").split(",") if t.strip()} or None
    min_liq = float(os.getenv("MIN_LIQUIDEZ", "0") or 0)

    url = os.getenv("SUPABASE_URL", "")
    chave = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
    if not args.dry_run and not (url and chave):
        log.error("Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY (ou use --dry-run)")
        return 2

    try:
        b3 = resumir_b3(carregar_b3(anos, args.fixtures))
        geral, compl, ativo = carregar_cvm_mensal(anos, args.fixtures)
        cvm = resumir_cvm(geral, compl, ativo)
        risco = carregar_risco(anos, args.fixtures)
        tabela = montar_tabela(b3, cvm, risco, tickers, min_liq)
    except Exception as e:  # noqa: BLE001
        log.exception("Falha na coleta")
        if not args.dry_run:
            registrar_execucao(url, chave, "erro", str(e))
        return 1

    if tabela.empty:
        log.error("Nenhum fundo resultante — verifique os filtros e os nomes de colunas")
        if not args.dry_run:
            registrar_execucao(url, chave, "erro", "tabela vazia")
        return 1

    with pd.option_context("display.max_rows", 50, "display.width", 160):
        print(tabela.head(50).to_string(index=False))
    log.info("Total: %d fundos | por segmento: %s", len(tabela), tabela["segmento"].value_counts().to_dict())

    if args.dry_run:
        return 0
    gravar_supabase(tabela, url, chave)
    registrar_execucao(url, chave, "sucesso", f"{len(tabela)} fundos atualizados (CVM+B3)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
