# Segurança e riscos

Auditoria estática em 30/10/2026. Não houve ataque, exploração, chamada externa ou teste dinâmico. A classificação informa evidência no código, não certificação de segurança.

## Controles observados

| Controle | Estado | Evidência e avaliação |
|---|---|---|
| Hash de senha Node | Implementado | `apps/api/src/server.js:14, 446–474, 519–520, 619–634`: scrypt com salt aleatório de 16 bytes e 64 bytes de saída. Parâmetros não documentados/configurados explicitamente. |
| Hash de senha Python | Implementado | `apps/api-python/app/security.py:5–10`: Argon2 PasswordHasher (time 3, memory 65536, parallelism 2). |
| Cookies/sessão Node | Parcial | `server.js:123–166`: token aleatório, HttpOnly, SameSite=Strict, expiração servidor de 8h, Secure apenas quando NODE_ENV=production; sessões guardadas em Map, perdidas ao reiniciar e não compartilhadas. Cookie logout não acrescenta `Secure` explicitamente. |
| Cookies/sessão Python | Parcial | `main.py:19–25, 123–140`; cookie HttpOnly/Strict e Secure condicionado; sessão persistida com expiração/revogação. Cadastro define max-age hardcoded 28800, login usa helper/env TTL. Não foi identificado CSRF token validado, apesar de header permitido. |
| Expiração e logout | Implementado parcialmente | Node verifica expiry na sessão e apaga ao uso. Python consulta expiração/revogação; redefinição de senha e revogação de portal invalidam sessões do paciente. |
| Token convite/reset | Implementado | Node/Python geram tokens randômicos e persistem SHA-256; uso único, expiração, validação. Node profissional cria links manuais; sem serviço de entrega. |
| Autorização multi-tenant Node | Implementado parcialmente | `access-control.js:1–100`, `server.js:267–330` conferem workspace/membership/roles/atribuições. Handlers usam `workspaceContext`, acesso clínico, e retornos 404 para ocultar alguns recursos. Risco residual de cobertura inconsistente em cada rota não elimina necessidade de teste. |
| Autorização Python | Parcial | `main.py:101–140` e `patient_access`; FKs compostas ligam registros clínicos ao paciente/workspace. Rota de avaliação e dados ditos clínicos devem ser revisados rota a rota. `can_read_patient` consulta assignment sem verificar `assignment_type`; algumas rotas dict são flexíveis. |
| Validação de entrada | Parcial | Node `body` limita corpo a 1 MB e vários handlers validam limites; nem todos os campos numéricos (ex. cintura/quadril) têm faixas. Python usa Pydantic em Auth/Patient/Assessment/Appointment/Goal, mas várias rotas aceitam `dict` e convertem manualmente. |
| CORS Python | Implementado parcialmente | `main.py:16–25`: origens por env, credenciais, métodos/headers listados; production exige origem explícita e sem `*`. Same-origin efetivo depende do proxy/domínio. |
| Proteção CSRF | Parcial/Não verificada | Python verifica Origin em mutações com cookie (`main.py:27–35`); Node define SameSite Strict, sem verificação Origin explícita. Não há token CSRF verificado. SameSite mitiga alguns cenários, não equivale a teste abrangente. |
| Rate limiting | Ausente no Node; parcial Python | Node sem limiter identificado. Python `main.py:96–100` persiste hits e aplica limites em alguns fluxos de login, tokens e convites, não todas as mutações. Limpeza/retention de `rate_limit_hits` não foi encontrada; robustez multi-instância depende DB/implementação. |
| SQL injection | Parcialmente mitigado por padrão de uso | Consultas exibidas usam SQLAlchemy expression API/select; nenhum SQL construído por interpolação foi identificado nos handlers inspecionados. Sem fuzz/dynamic check. |
| XSS | Parcial | `app.js` tem `esc`; `portal.js` `portalEsc`; strings interpoladas são frequentemente escapadas. Não foi feita revisão exhaustiva de todo sink DOM nem execução navegador. |
| Headers de segurança | Parcial | Node estático inclui CSP, nosniff; JSON inclui nosniff/no-store. `apps/web/server.mjs:18–21` no proxy repassa headers upstream; não acrescenta sua CSP a respostas de API. |
| Logs e segredos | Parcial | Node loga método/status sem URL para evitar vazar tokens (`server.js:1781–1794`). `.env` presente e não aberto. Compose inclui credencial local fixa para test-db; não usar fora de teste descartável. Logs preview existentes não inspecionados. |
| CORS/credenciais no proxy | Não validado | Web proxy usa HTTP(S) proxy e repassa request headers; funcionamento de cookie `Set-Cookie`, origem e domínio deve ser validado para topologias reais. `config.js` pode também apontar API cross-origin. |
| TLS/config produção | Não validado | Compose não configura TLS/ingress. Python protege startup com Secure/CORS production; Node Secure depende NODE_ENV. Nenhuma evidência de domínio ou deploy. |
| Backup/recuperação | Parcial | Node copia backup na migração específica. Postgres volume persistente e README documenta comando manual; sem rotina/restore test demonstrados. |
| Dados de saúde e privacidade | Lacuna | Registros incluem medidas, notas clínicas e planos em JSON/DB. Não há evidência de controles operacionais completos de retenção, acesso a backup, monitoramento ou avaliação de privacidade. README recomenda não usar dados reais e não declara conformidade LGPD. |

## Achados prioritários

| ID | Prioridade | Tipo | Evidência/local | Impacto e consequência | Recomendação |
|---|---|---|---|---|---|
| R-01 | P1 | Confirmado | `apps/api/src/server.js:18–23, 130–166`; `data/store.json` | Store local e sessões em memória não oferecem consistência multi-instância; reinício encerra sessões. Dados clínicos podem perder durabilidade/disponibilidade e backup consistente. | Definir backend primário de produção, persistência e sessão compartilhadas, plano de migração/backup e teste de restauração antes de hospedar. |
| R-02 | P1 | Confirmado | `apps/api-python/app/main.py` (rotas de workspace/equipe) vs `apps/api/src/server.js:830–1080`; frontend `app.js:825–954` | Python não implementa gestão de membros, convites e papéis do contrato atual; apontar UI a Python deixa telas/fluxos sem rota ou com divergência. | Fechar matriz de compatibilidade por endpoint e DTO; validar fluxo ponta a ponta antes de trocar destino. |
| R-03 | P1 | Confirmado | Python `main.py:153–164` hardcodes `max_age=28800`; `security.py:11` e helpers de sessão aceitam `SESSION_TTL_HOURS` | Cookie pode durar período diferente do prazo persistido configurado; sessão expirará no servidor antes/depois do cookie conforme valor. | Aplicar um único valor TTL a criação, persistência e cookie e cobrir por teste. |
| R-04 | P1 | Confirmado | Node `server.js:162–166`, `1781–1794`; ausência de limiter no caminho Node | API Node padrão não limita tentativas; login/invitation/reset públicos podem sofrer força bruta/abuso e consumo de recursos. | Definir limiter com armazenamento compartilhado/retention apropriado e limites por conta/IP para endpoints sensíveis. |
| R-05 | P1 | Confirmado | `docker-compose.yml` serviço test-db: password fixa `localtestpassword`; package script reutiliza credencial | Credencial fixa é aceitável somente no DB efêmero isolado atual; erro de reutilização fora de profile/test expõe DB. | Restringir uso ao ambiente descartável e garantir que nenhum ambiente persistente compartilhe essa credencial. |
| R-06 | P2 | Confirmado | `apps/api-python/app/main.py:96–100`, tabela RateLimitHit | Hits são persistidos; não foi localizada limpeza por idade; crescimento contínuo do banco e custo de consultas ao longo do tempo. | Adicionar política bounded de retenção/limpeza e índice/estratégia que acompanhe consultas. |
| R-07 | P2 | Confirmado | `apps/web/server.mjs:14–28, 38–44` | Cabeçalhos CSP/referrer/nosniff são definidos para estáticos; resposta proxy de API depende integralmente do upstream. Domínio/API separado aumenta risco de configuração cookie/CORS incorreta. | Documentar e validar topologia same-site, TLS, CORS e headers no deploy real. |
| R-08 | P2 | Confirmado | `apps/api-python/app/main.py:163` vs `security.py` | Config TTL divergente no cadastro, ver R-03; marcado P1 no impacto de sessão. |
| R-09 | P2 | Suspeita a confirmar | Node `server.js:85–98`: temp file + rename, JSON snapshot global | Proteção de escrita é intra-processo; dois processos usando o mesmo DATA_DIR podem sobrescrever snapshots e produzir atualização perdida. | Não executar múltiplas instâncias com store local; mover a persistência para DB transacional ou adicionar coordenação explícita. |
| R-10 | P2 | Não verificado | `.env` presente, nenhum inventário de deploy/CI | Não foi possível verificar rotação/escopo dos valores locais, política de segredos, hospedagem, logs ou alertas. | Auditoria operacional com acesso controlado; evitar copiar valores para documentação e configurar gestão de segredos. |
| R-11 | P3 | Confirmado | Node `server.js:1772+`, web `server.mjs:38–44` | Não há política explícita observada de cache/versionamento de assets e headers comuns em toda resposta; impacto secundário. | Padronizar headers/cache conforme domínio e conteúdo no ambiente de publicação. |

### Controles não identificados

MFA, envio automático de email, rate limit no Node, monitoramento de login, política de rotação de sessão profissional, recuperação profissional por email, trilha de auditoria transacional/imutável, proteção documentada de backups, varredura de dependências/CI, pentest ou política formal de retenção não foram encontrados no código/configuração inspecionados. A ausência de arquivo não prova ausência fora do repositório; estado correto é não identificado.

P0: nenhum problema P0 confirmado na inspeção estática. Isso não é declaração de segurança ou prontidão de produção. P1: R-01 a R-05. P2: R-06 a R-10. P3: R-11.
