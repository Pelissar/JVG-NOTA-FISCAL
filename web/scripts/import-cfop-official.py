"""Converte a tabela XLSX de CFOP do Portal Nacional da NF-e em catálogo JSON.

Uso: python scripts/import-cfop-official.py /caminho/Tabela_CFOP.xlsx
Dependência de desenvolvimento: openpyxl. Nunca atualizar descrições manualmente.
"""

import hashlib
import json
import sys
from datetime import datetime
from pathlib import Path

from openpyxl import load_workbook


SOURCE_URL = (
    "https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?"
    "conteudo=74KmX8poGpM%3D&AspxAutoDetectCookieSupport=1"
)
FLAG_COLUMNS = [
    "indNFe", "indComunica", "indTransp", "indDevol", "indRetor",
    "indAnula", "indRemes", "indComb", "indExcIBSCBS",
]


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("Uso: python scripts/import-cfop-official.py arquivo.xlsx")
    source = Path(sys.argv[1])
    sheet = load_workbook(source, read_only=True, data_only=True)["CFOP"]
    iterator = sheet.values
    headers = next(iterator)
    assert headers[0] == "CFOP" and headers[12] == "Título do CFOP"
    records = []
    seen = set()
    for row in iterator:
        if row[0] is None:
            continue
        code = str(row[0])
        if len(code) != 4 or not code.isascii() or not code.isdigit() or code in seen:
            raise ValueError(f"Código CFOP inválido ou repetido: {code}")
        seen.add(code)
        title, description = row[12], row[13]
        if not isinstance(title, str) or not isinstance(description, str) or not title or not description:
            raise ValueError(f"Título/descrição oficial ausente em {code}")
        records.append({
            "code": code,
            "title": title,
            "description": description,
            "validFrom": row[1].date().isoformat() if isinstance(row[1], datetime) else None,
            "validUntil": row[2].date().isoformat() if isinstance(row[2], datetime) else None,
            "flags": {name: int(row[3 + i]) if row[3 + i] is not None else None
                      for i, name in enumerate(FLAG_COLUMNS)},
        })
    if len(records) != 619:
        raise ValueError(f"A tabela oficial esperada tem 619 CFOPs; encontrados {len(records)}")
    output = {
        "source": "Portal Nacional da NF-e / ENCAT",
        "sourceUrl": SOURCE_URL,
        "document": "Informe Técnico 2023.002 v2.10 — Tabela CFOP",
        "publishedOn": "2026-09-04",
        "sourceSha256": hashlib.sha256(source.read_bytes()).hexdigest(),
        "records": records,
    }
    target = Path(__file__).resolve().parents[1] / "data" / "cfop-official-2026.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(output, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"{len(records)} CFOPs oficiais gerados em {target} ({target.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
