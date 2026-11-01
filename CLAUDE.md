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
- `src/voz.ts`: vozes neurais pt-BR da Microsoft pelo Azure Speech oficial, com a chave do próprio usuário. Deixadas de lado por enquanto: a tela não oferece nem toca vozes.
- `web/retrato.js`: retrato 48×64 do diálogo, gerado do id (use `>>>`, nunca `>>`, ao tirar bits do hash). `web/index.html` é tela cheia só com o escritório e um HUD pixelado (fontes Pixelify Sans nos títulos e VT323 no texto, copiadas do @fontsource).
- O computador do jogo é uma área de trabalho (navegador, arquivos, editor, terminal, histórico). Sites externos abrem num WebView nativo sobreposto (handler `navegador` da janela GTK), que segue a posição de `#navArea` e se esconde quando algo do jogo a cobre; a prévia do projeto vem de `/previa/<alvo>/...`, com `caminhoSeguro` (nada fora da pasta, nada em `.git`). Fora do app (navegador comum), sites externos aparecem em modo leitura (`GET /leitura`).
- Nada abre fora do jogo: um só componente de navegador (`#navegador`) vai para o computador, a janela "Navegador do escritório" ou o login (`abrirNoJogo`). A janela GTK manda links externos para `window.__abrirNoJogo`; o login roda o CLI com um `xdg-open` falso (`navegador-do-jogo/` nos dados) que só anota o endereço. Sem `alert/confirm/prompt`: use `perguntar`/`confirmar`/`avisar`.
- Recomeçar do zero (`POST /recomecar`): move o estado para `anteriores/<data>` e sai com 75; a janela religa o cérebro na mesma porta (rodando direto, ele se religa sozinho). Apagar arquivo vai para `lixeira/` nos dados (desfazer em `POST /arquivo/restaurar`).
- Autonomia: trabalho dentro da pasta do projeto não pede aprovação a ninguém (a `Sessao` sem `decidirPermissao` libera tudo o que fica dentro e nega o que sai). Mudança grande ou arriscada: `pedir_aval_do_chefe` (o chefe decide numa sessão só leitura do modelo dele; "LEVAR AO GESTOR" vira pedido de acesso). Só o que é do dono (login, senha, pagamento) chega ao gestor: `pedir_acesso`, trazido pelo chefe, respondido no cartão do HUD. Ferramentas que esperam o gestor usam `MCP_TOOL_TIMEOUT` de 15 min e desistem sozinhas em 10 (`esperar_resposta` volta a esperar); o conteúdo da resposta nunca vai para o diário.
- Drive da empresa (`<dados>/drive`, alvo `drive`): pastas simples para leigos (Para você, Relatórios, Documentos, Imagens) e um índice escondido (`.indice.json`: quem mandou, quando, recado). `compartilhar_com_gestor` põe uma cópia com nome claro (o projeto continua com a estrutura técnica certa); cada tarefa terminada gera um relatório `.md` em Relatórios. A tela abre `.md` formatado, imagens e PDFs no visualizador.
- Cada computador é independente: personalização em `estado.computadores[alvo]` e pasta pessoal do dono (`<dados>/pessoal/<id>`, alvo `pessoal-<id>`: Downloads, Imagens, Notas). Nos momentos livres a pessoa pode usar o computador para algo pessoal (FAZ: computador + NO PC): uma sessão Haiku pequena, só na pasta pessoal, uma por vez, no máximo a cada 30 min por pessoa; o que fez vai para a memória.
- Pastas: a CLI às vezes marca (`blockedPath`) caminhos que estão dentro da pasta; vale a nossa regra (`caminhoForaDaPasta`).
- Vida de verdade: a cada 75 s, alguém livre tem um [Momento livre] na persona (PENSA/DIZ/PARA/FAZ); o colega a quem falou responde uma vez. Fica em `estado.vida` e entra nos fatos. Ações no mundo (`fazer_no_escritorio`, ex.: buscar café para o gestor) viram o evento `vida`. A tela não inventa falas: nada de frases prontas.
- Tempo: os fatos dizem data e hora de agora, quando o expediente abriu e quando cada coisa aconteceu em termos relativos ("hoje às…", "ontem…"); o chefe também recebe as entregas da equipe.
- Balões: duram o tempo de ler, fila de 2 por pessoa, conversa à toa só se pouca gente fala; trabalho não vira balão.
- Computador: barra de tarefas com Iniciar, bandeja (Compartilhados) e relógio; tela inicial personalizável (papel de parede, ordem por arrastar, atalhos para sites), guardada em `estado.computador`.
- Conversa entre colegas: `falar_com_colega` (nas personas e nas tarefas) leva a fala à persona do outro (marcada [Colega]), com fatos e memória dele; os dois lembram; trava de ciclo (A esperando B e B chamando A).
- `web/explorador.js`: o explorador de arquivos (lugares: projeto do computador, pasta pessoal, Drive, Lixeira). Copiar/mover entre lugares em `POST /arquivo/copiar|mover`; lixeira persistente (`<dados>/lixeira/indice.json`, `GET /lixeira`, esvaziar). Seleção sem redesenhar a lista (o duplo clique precisa do mesmo elemento).
- `web/trabalho.js`: o trabalho visível. Eventos de uma sessão viram passos (📝 escreveu, ✏️ editou, 🧪 testes, 🔍 pesquisa…) e cada passo vira o visual do que foi feito (página em iframe da prévia, markdown formatado, imagem, código com as linhas novas destacadas, terminal com ✓/✗). A "tela" de quem trabalha e a janela de entrega (prévias dos arquivos mudados + relatório) usam isso.
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
