# Escritório Pixel de IA: cérebro

Etapa 1: o serviço local que inicia sessões do Claude Code em modo estruturado (Agent SDK), recebe os eventos e os mostra num log.

Requisitos: Node >= 22.18 e o Claude Code logado na sua conta.

```bash
npm install
npm run demo                       # tarefa de exemplo (Haiku), aprova permissões automaticamente
npm run demo -- --perguntar        # pergunta s/n a cada permissão
npm run demo -- --modelo sonnet --pasta ~/meu-projeto "sua tarefa"
```

## Servidor (o cérebro)

```bash
npm run cerebro                    # http://127.0.0.1:4317 ; APROVAR_TUDO=1 para não pedir permissão
curl -N http://127.0.0.1:4317/eventos
curl -X POST http://127.0.0.1:4317/sessoes -d '{"pasta":"/caminho","tarefa":"...","modelo":"haiku"}'
curl http://127.0.0.1:4317/sessoes                     # sessões e permissões pendentes
curl -X POST http://127.0.0.1:4317/permissoes/<id> -d '{"aprovar":true}'
```

## Eventos

| Evento | No jogo (futuro) |
| --- | --- |
| `sessao_iniciada`, `cli_pronta` | chega e liga o computador |
| `ferramenta_chamada` / `ferramenta_resultado` | digitando, lendo na estante, cafezinho (build/teste) |
| `permissao_pedida` / `permissao_respondida` | vai até a mesa do chefe |
| `cota` | almoço quando a janela de 5h estiver perto do limite |
| `compactacao` | banheiro ("já volto") |
| `tarefa_terminada` | entrega com evidência |
| `erro` | "meu PC travou" |

Logs: `logs/<sessao>.eventos.jsonl` (normalizados) e `logs/<sessao>.bruto.jsonl` (mensagens originais da CLI).
