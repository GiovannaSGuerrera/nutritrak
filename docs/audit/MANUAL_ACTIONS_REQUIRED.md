# Ações externas pendentes

Somente atividades não executadas automaticamente; não existe autorização de deploy/contratação/alteração produtiva.

| Ação | Por que/onde | Passo a passo | Impacto e gate |
|---|---|---|---|
| CI remoto e imagens Linux | Docker daemon indisponível; GitHub/host não alterados | Em Linux isolado executar workflow/builds, scan OS/imagens; revisar/fixar digests; guardar evidências e corrigir divergências | Bloqueia lançamento; AUD-020 |
| Infra/TLS/volume protegido | Exige acesso e autorização de produção; host/DNS/firewall | Revisar Compose/Caddy, DNS80/443, ACL/criptografia de disco, porta privada/TRUST_PROXY; após autorização iniciar e testar health/certificado/bypass negado | Bloqueia; AUD-009 |
| Segredos e SMTP real | Credenciais adicionais não fornecidas; relay/DNS | Gerar chaves distintas em ambiente seguro, guardar cópia offline; configurar SMTP_TLS/remetente/SPF/DKIM/DMARC; testar signup/verify/reset em caixas autorizadas | Bloqueia; AUD-009. Recuperação por canal real não comprovada |
| Backup externo, restore/rollback e alertas | Destino/monitoramento e RPO/RTO dependem do operador | Agendar backup-encrypted no scheduler existente, copiar para destino independente, restaurar em diretório novo, invalidar tokens antigos na cópia e comparar contagens; configurar alertas de falha/idade/disco/health/SMTP e ensaiar rollback | Bloqueia; AUD-009. Restore sintético local já validado |
| Política/retencão clínica | Decisão jurídica/controlador não inferível do código | Definir bases legais de saúde, retenção, operadores, atendimento/exclusão/backups; fornecer legal/privacy.md e terms.md aprovados; testar publicação e solicitação. Não apagar histórico indiscriminadamente | Bloqueia dados reais; AUD-010; sem declaração LGPD integral |
| Dados legados e homologação | Dados reais não acessados/migrados; requer cópia autorizada | Preservar JSON/hash, importar destino novo protegido; reconciliar duplicatas/referências/credenciais; comparar contagens/atribuições/planos; homologar dois tenants com responsável clínico e medir carga representativa | Bloqueia uso comercial de dados existentes; capacidade não comprovada |
| Revisão humana e navegadores | Apenas Chromium automatizado disponível | Em staging testar teclado/leitor de tela, Safari/Firefox/dispositivos-alvo e portal; registrar/corrigir antes de prometer suporte | Não bloqueia testes internos; bloqueia alegações integrais de compatibilidade/acessibilidade |
| Aprovação e implantação comercial | Deploy proibido sem autorização | Após gates, revisar release/backup/janela, obter autorização, seguir guia e smoke, monitorar piloto fechado | Bloqueia disponibilização pública; nenhum deploy realizado |

Nenhuma credencial real comprometida identificada; não foi inventada rotação de incidente. Se evidência externa surgir, revogar/rotacionar no emissor antes de lançar. Backend Python continua experimental; cutover para ele exige paridade e pg_dump/restore em escopo separado.
