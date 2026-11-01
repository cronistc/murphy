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
- `src/demo.ts`: demo de ponta a ponta sem servidor.

## Convenções

- TypeScript rodado direto pelo Node (>= 22.18, type stripping): só sintaxe apagável (sem enum, sem namespace); imports com extensão `.ts`.
- `npm run checar` (tsc --noEmit) precisa passar.
- Pastas de projeto dos funcionários ficam FORA deste repositório (padrão: `~/escritorio-projetos`), senão herdam o package.json daqui.
- Segurança: nenhuma ferramenta age fora da pasta do projeto (`caminhoForaDaPasta` + `blockedPath` da CLI), mesmo com aprovação automática.
