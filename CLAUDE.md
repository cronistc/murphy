# Escritório Pixel de IA

Jogo 2D em que IAs reais (via CLIs oficiais) trabalham num escritório. A ideia completa está no documento da ideia; os princípios dele decidem qualquer dúvida de design.

## Regras de trabalho

- Nunca dizer que algo está resolvido sem verificar; mostrar como verificou (comando rodado e saída).
- Reproduzir o erro antes de consertar.
- Fazer uma etapa por vez e parar para revisão ao fim de cada uma.

## Arquitetura (até agora)

- `src/sessao.ts`: uma sessão de trabalho (Claude Code via `@anthropic-ai/claude-agent-sdk`) e a tradução das mensagens do SDK em `Evento`s.
- `src/eventos.ts`: o contrato de eventos. O jogo só reage a eles; todo comportamento de trabalho tem de vir de um evento real.
- `src/log.ts`: log no terminal e JSONL (eventos normalizados e mensagens brutas da CLI).
- `src/servidor.ts`: o "cérebro" HTTP + SSE. Interfaces só se conectam a ele.
- `src/escritorio.ts`: projeto (repo git) + mesas. Cada mesa é um git worktree em `<projeto>.mesas/<funcionario>`, branch `mesa/<funcionario>`.
- `src/demo.ts`: demo de uma sessão sem servidor.
- `web/`: a tela (canvas + painel), JS puro sem build, servida pelo cérebro. `web/comportamento.js` é a única tabela evento → comportamento (lógica pura, testável no Node); `web/jogo.js` desenha e cuida do painel.
- `src/conta.ts`: login na conta Claude pelo `claude auth login` oficial (embutido no SDK), rodado num pty (`script`) para aceitar o código colado na tela.
- `empacotar/`: pacote do Fedora. `escritorio-pixel` é a janela (Python + GTK4 + WebKitGTK 6) que liga o cérebro numa porta livre e o desliga ao fechar (inclusive se a janela morrer: PR_SET_PDEATHSIG). `construir-rpm.sh` gera `build/*.rpm` (`npm run rpm`).
- `src/demo-equipe.ts`: três funcionários em paralelo, cada um na sua mesa, com verificação no git (é o teste de ponta a ponta da etapa 2).

## Convenções

- TypeScript rodado direto pelo Node (>= 22.18, type stripping): só sintaxe apagável (sem enum, sem namespace); imports com extensão `.ts`.
- `npm run checar` (tsc --noEmit) precisa passar.
- Pastas de projeto dos funcionários ficam FORA deste repositório (padrão: `~/escritorio-projetos`), senão herdam o package.json daqui.
- Segurança: nenhuma ferramenta age fora da pasta do projeto (`caminhoForaDaPasta` + `blockedPath` da CLI), mesmo com aprovação automática.
- `Escritorio.abrir` nunca roda `git init` em pasta com arquivos, na home ou na raiz do sistema.
- O pacote não pode passar por `strip`: o Claude Code embutido é um executável único e quebra (o spec desliga isso).
- Sessões de funcionários rodam com `ambienteLimpo()`: sem as variáveis de identidade de uma sessão do Claude Code que tenha iniciado o cérebro (senão todos herdam o session_id dela).
