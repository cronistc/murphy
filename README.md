# Escritório Pixel de IA

Um escritório em pixel art onde funcionários de IA trabalham de verdade: por trás, sessões do Claude Code; na frente, personagens que andam, digitam, vão à estante, tomam café enquanto o teste roda e vão até a sua mesa pedir permissão.

![O escritório: Bruno foi até a mesa do chefe pedir permissão](docs/tela.png)

## Como usar

Precisa de: [Node.js](https://nodejs.org) 22.18 ou mais novo, git, e o [Claude Code](https://claude.com/claude-code) instalado e logado na sua conta (rode `claude` uma vez e faça login).

```bash
git clone https://github.com/cronistc/murphy.git
cd murphy
npm install
npm start
```

Abra **http://127.0.0.1:4317** no navegador. No painel da direita:

1. **Delegar tarefa:** escreva um nome (cada nome é um funcionário com mesa própria), escolha o cargo e descreva a tarefa. O projeto padrão é `~/escritorio-projetos/meu-escritorio`; pode ser qualquer pasta vazia ou um repositório git seu.
2. **Pedidos na sua mesa:** quando alguém quer criar arquivo ou rodar comando, ele anda até a sua mesa e o pedido aparece aqui. Ou marque "Aprovar pedidos automaticamente". Nada fora da pasta do projeto é permitido em nenhum caso.
3. **Clique num funcionário** para ver o que ele está fazendo e o log técnico completo (clique numa linha para ver o evento bruto).

O trabalho de cada funcionário fica na branch `mesa/<nome>` do projeto, com commits. Para levar para a `main`: `git merge mesa/<nome>` na pasta do projeto.

| No escritório | O que está acontecendo de verdade |
| --- | --- |
| Digitando na mesa | Escrevendo ou editando arquivos |
| Na estante com um livro | Lendo arquivos, buscando, pesquisando na web |
| Cafezinho | Esperando um comando rodar (teste, build, instalação) |
| Indo até a sua mesa com ✋ | Pedindo permissão |
| Indo até a sua mesa com um papel | Entregando a tarefa (fala a primeira frase do resultado real) |
| Banheiro ("já volto") | Compactando o contexto |
| Saindo pela porta | Cota no limite (almoço) |
| Tela azul + "meu PC travou" | Erro na sessão |

Cores da camisa: verde = Júnior (Haiku), azul = Pleno (Sonnet), roxo = Sênior (Opus).

## Para desenvolvedores

- Etapa 1: uma sessão, eventos e log.
- Etapa 2: vários funcionários ao mesmo tempo, cada um na sua mesa (git worktree e branch próprios).
- Etapa 3: a tela 2D (`web/`), servida pelo cérebro.

```bash
npm run checar                     # tsc --noEmit
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
npm start                          # http://127.0.0.1:4317 ; APROVAR_TUDO=1, PROJETO=..., PORTA=...
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
