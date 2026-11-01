# Escritório Pixel de IA: cérebro

O serviço local que inicia sessões do Claude Code em modo estruturado (Agent SDK), recebe os eventos e os mostra num log.

- Etapa 1: uma sessão, eventos e log.
- Etapa 2: vários funcionários ao mesmo tempo, cada um na sua mesa (git worktree e branch próprios).

Requisitos: Node >= 22.18 e o Claude Code logado na sua conta.

```bash
npm install
npm run demo                       # tarefa de exemplo (Haiku), aprova permissões automaticamente
npm run demo -- --perguntar        # pergunta s/n a cada permissão
npm run demo -- --modelo sonnet --pasta ~/meu-projeto "sua tarefa"
npm run demo:equipe                # 3 funcionários em paralelo + verificação no git
```

## Mesas

```
~/escritorio-projetos/meu-app            ← repositório principal (main), ninguém trabalha aqui
~/escritorio-projetos/meu-app.mesas/ana  ← worktree da Ana, branch mesa/ana
~/escritorio-projetos/meu-app.mesas/beto ← worktree do Beto, branch mesa/beto
```

A mesa é criada na primeira tarefa do funcionário e reaproveitada depois. Um funcionário faz uma tarefa por vez. O projeto pode ser uma pasta nova (vira repositório) ou a raiz de um repositório existente; pasta com arquivos que não é repositório é recusada.

## Servidor (o cérebro)

```bash
npm run cerebro                    # http://127.0.0.1:4317 ; APROVAR_TUDO=1 para não pedir permissão
curl -N http://127.0.0.1:4317/eventos
curl -X POST http://127.0.0.1:4317/sessoes -d '{"projeto":"/caminho","funcionario":"ana","tarefa":"...","modelo":"haiku"}'
curl -X POST http://127.0.0.1:4317/sessoes -d '{"pasta":"/caminho","tarefa":"..."}'   # sem mesa
curl "http://127.0.0.1:4317/mesas?projeto=/caminho"
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
