# Resumo da auditoria

**Data:** 30/10/2026. **Branch:** `master`. **Estado Git inicial:** limpo. **Alterações de código:** nenhuma.

## Estado encontrado

- Arquitetura: frontend estático JavaScript; API Node padrão com JSON e sessões em memória; API FastAPI/PostgreSQL/Alembic em migração, incompleta em relação ao backend legado.
- Tecnologias: Node.js >=20, pnpm 11.25, JavaScript/HTML/CSS, Python, FastAPI 0.115.12, SQLAlchemy 2.0.40, PostgreSQL 16, Alembic 1.15.2; dependências Python fixadas em `apps/api-python/requirements.txt`.
- Arquivos de código/configuração/dependências/testes inspecionados em detalhe: 32; 27 documentos técnicos preexistentes inventariados como contexto. `git ls-files` listou 60 itens rastreados. Diretórios gerados/dependências foram excluídos. `.env` não foi aberto.
- Funcionalidades identificadas: 17 áreas no inventário, incluindo autenticação, workspaces, pacientes, atribuições, avaliação, agenda, metas, planos, portal e operação.
- Endpoints: 47 operações de API Node (mais serving estático) e 36 operações FastAPI incluindo health, conforme inventário. Rotas paramétricas contam como uma operação por método/rota.
- Testes: existem 2 arquivos Node e 1 arquivo Python (4 funções de teste identificadas). Executados nesta auditoria: nenhum. Node não executado devido a cleanup automático de `apps/api/test/.runtime-data`; esse caminho estava ausente, mas a suíte apagaria/recriaria o diretório. Python não executado pois fixture grava schema/dados no `DATABASE_URL` e script inicia containers Docker. Aprovados/reprovados nesta execução: nenhum.
- Prioridades: P0 = 0 confirmados; P1 = 5; P2 = 5; P3 = 1. Detalhes e evidências em [SEGURANCA_E_RISCOS.md](SEGURANCA_E_RISCOS.md).
- Principais pendências: decidir backend de produção; compatibilizar frontend/contratos Python; migrar store/sessões Node para armazenamento apropriado se multi-instância; resolver TTL; rate-limit do Node; definir deploy, TLS, backups, monitoramento e testes de restauração.
- Preparação para hospedagem: **não validada e não pronta com evidência disponível**. README também alerta que Python não substitui completamente o Node e que não se use dados reais de saúde nesta versão.

## Documentos entregues

1. [Auditoria técnica completa](AUDITORIA_TECNICA_COMPLETA.md)
2. [Inventário de arquivos](INVENTARIO_ARQUIVOS.md)
3. [Inventário da API](INVENTARIO_API.md)
4. [Inventário de funcionalidades](INVENTARIO_FUNCIONALIDADES.md)
5. [Segurança e riscos](SEGURANCA_E_RISCOS.md)
6. [Resumo da auditoria](RESUMO_AUDITORIA.md)

## Limitações

Não verificados: `.env` e valores de configuração, dependências instaladas, runtime com banco, integrações/serviços externos, domínio/produção, navegador real, concorrência entre processos, segurança dinâmica e recuperação de backup. Documentos de planejamento antigos foram tratados como contexto, não como prova de implementação.

