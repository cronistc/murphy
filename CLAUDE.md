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
- `src/terminal.ts`: o computador de verdade (bash num pty via `script`), usado quando o gestor senta numa mesa.
- `src/orquestrador.ts`: o escritório em si (expediente com diário e retomada, conversas com qualquer um, humor, férias, especialistas, T.I., Wi-Fi, almoço por cota, agenda do dia com notícias reais, cofre). Equipe, conversa com o chefe, contratação, tarefas, integração do trabalho na branch principal. O chefe (Opus) é uma sessão retomada (`resume`) com ferramentas do escritório (MCP in-process: `ver_equipe`, `delegar_tarefa`, `pedir_contratacao`); não edita arquivos nem roda comandos.
- `src/estado.ts`: o que o escritório lembra entre dias (`~/.local/share/escritorio-pixel/escritorio.json`, ou `PASTA_DADOS`).
- `src/candidatos.ts`: cargos (chefe/sênior/pleno/júnior → opus/sonnet/haiku) e candidatos para contratar.
- `src/servidor.ts`: o "cérebro" HTTP + SSE, só a porta de entrada do orquestrador. Interfaces só se conectam a ele.
- `src/escritorio.ts`: projeto (repo git) + mesas. Cada mesa é um git worktree em `<projeto>.mesas/<funcionario>`, branch `mesa/<funcionario>`.
- `src/demo.ts`: demo de uma sessão sem servidor.
- `web/`: a tela, JS puro sem build, servida pelo cérebro. `mapa.js` (mapa e caminhos), `comportamento.js` (a única tabela evento real → comportamento), `desenho.js` (pixel art), `jogo.js` (você andando, vida da equipe, painel, janelas, terminal). `xterm.js`/`addon-fit.js` são cópias do npm (@xterm/xterm 5.5, addon-fit 0.10).
- `src/conta.ts`: login na conta Claude pelo `claude auth login` oficial (embutido no SDK), rodado num pty (`script`) para aceitar o código colado na tela.
- `empacotar/`: pacote do Fedora. `escritorio-pixel` é a janela (Python + GTK4 + WebKitGTK 6) que liga o cérebro numa porta livre e o desliga ao fechar (inclusive se a janela morrer: PR_SET_PDEATHSIG). `construir-rpm.sh` gera `build/*.rpm` (`npm run rpm`).
- `src/persona.ts`: a parte rápida de cada pessoa (Haiku sempre ligado, streaming input, sem ferramentas de arquivo). Fala com o gestor e decide quando "pensar melhor" (sessão do modelo do cargo, só leitura) ou, no chefe, `planejar` (turno do Opus). No máximo 6 ligadas (LRU, o chefe nunca sai); desligam após 20 min paradas.
- Começo de jogo: abertura → conta → escritório (nome + área de `AREAS`) → fase `entrevista` (o chefe pergunta, `anotar_relatorio` grava ESCRITORIO.md no projeto, `recomendar_equipe`) → contratação → fase `operando`.
- `src/voz.ts`: vozes neurais pt-BR da Microsoft pelo Azure Speech oficial, com a chave do próprio usuário (Menu → Configurar vozes). Sem chave, sem voz.
- `web/retrato.js`: retrato 48×64 do diálogo, gerado do id (use `>>>`, nunca `>>`, ao tirar bits do hash). `web/index.html` é tela cheia só com o escritório e um HUD pixelado (fontes Pixelify Sans nos títulos e VT323 no texto, copiadas do @fontsource).
- O computador do jogo é uma área de trabalho (navegador, arquivos, editor, terminal, histórico). Sites externos abrem num WebView nativo sobreposto (handler `navegador` da janela GTK); a prévia do projeto vem de `/previa/<alvo>/...`, com `caminhoSeguro` (nada fora da pasta, nada em `.git`).
- `src/demo-equipe.ts`: três funcionários em paralelo, cada um na sua mesa, com verificação no git (é o teste de ponta a ponta da etapa 2).

## Experiência (não perder de vista)

- O usuário é o gestor. Ele NÃO cria funcionários digitando nomes: conversa com o chefe, que planeja, delega e pede contratações; o gestor aprova ou contrata pela janela de contratação (candidatos com cargo e personalidade).
- Primeira abertura: boas-vindas mostrando a conta Claude (mesmo já logada) → primeiro projeto → o chefe chega e cumprimenta.
- Automático por padrão, acessível se quiser: tarefa direta e log técnico ficam na ficha do funcionário / "Bastidores".

## Convenções

- TypeScript rodado direto pelo Node (>= 22.18, type stripping): só sintaxe apagável (sem enum, sem namespace); imports com extensão `.ts`.
- `npm run checar` (tsc --noEmit) precisa passar.
- `zod` fica fora do bundle (esbuild `--external:zod`) e vai nas dependências do pacote: as ferramentas MCP precisam da mesma cópia do zod que o SDK usa.
- Ferramentas do escritório usam `alwaysLoad: true` (constante `SEMPRE`): sem isso a CLI as deixa "sob demanda" e o modelo acha que não existem.
- Conversa com funcionário = sessão nova com memória injetada (diário + conversa recente). Não retome a sessão de conversa: conclusões erradas antigas travavam o funcionário.
- `allowedTools` desliga o `canUseTool` (e a regra da pasta) para essas ferramentas: só liste ferramentas do próprio escritório nele.
- Pastas de projeto dos funcionários ficam FORA deste repositório (padrão: `~/escritorio-projetos`), senão herdam o package.json daqui.
- Segurança: nenhuma ferramenta age fora da pasta do projeto (`caminhoForaDaPasta` + `blockedPath` da CLI), mesmo com aprovação automática.
- `Escritorio.abrir` nunca roda `git init` em pasta com arquivos, na home ou na raiz do sistema.
- O pacote não pode passar por `strip`: o Claude Code embutido é um executável único e quebra (o spec desliga isso).
- Falas de personagens não usam markdown (instrução + `semMarcacao`); só o chat técnico do gestor pode ter.
- Sessões de funcionários rodam com `ambienteLimpo()`: sem as variáveis de identidade de uma sessão do Claude Code que tenha iniciado o cérebro (senão todos herdam o session_id dela).
