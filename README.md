# Croqui — plantas baixas e croquis de medição (PWA para iPad)

App web instalável e 100% offline para desenhar croquis de campo (piscinas, calçadas, pátios, decks),
digitar as medidas reais e obter um desenho limpo, cotado, com área e perímetro. É para uso pessoal:
sem login, sem backend, e tudo fica salvo no aparelho (IndexedDB).

## Stack

**JavaScript puro (módulos ES) + SVG, sem dependências e sem build.**

- **SVG** em vez de Canvas: cada lado, cota e vértice é um elemento que pode ser tocado (hit-test grátis),
  o texto sai nítido em qualquer zoom e a exportação reaproveita o mesmo código de renderização.
- **Sem framework nem bundler**: o service worker faz cache de ~20 arquivos estáticos e o app abre offline
  na hora. Não tem `npm install` para quebrar daqui a dois anos. Hospeda em qualquer servidor estático.
- **PDF sem biblioteca**: um escritor mínimo de PDF (`js/export.js`) embute o JPEG renderizado em uma página Carta.
- Se o app crescer muito, dá para migrar para TypeScript + Vite mantendo `geometry`/`solver`/`model`,
  que são módulos puros e já têm testes.

## Instalar no iPad

1. Publique a pasta `croqui/` em qualquer hospedagem estática **com HTTPS** (GitHub Pages, Netlify Drop,
   Cloudflare Pages). O service worker exige HTTPS.
2. Abra a URL no **Safari** do iPad → Compartilhar → **Adicionar à Tela de Início**.
3. Abra uma vez com internet. A partir daí funciona offline. Atualizações chegam na abertura seguinte.

Para testar no computador: `cd croqui && npx http-server -p 8080` (ou `python3 -m http.server 8080`)
e abra `http://localhost:8080`. Testes do solver/unidades: `node tests/solver.test.mjs`.

## Como usar

| Ação | Como |
|---|---|
| Barra superior | Cápsulas no estilo Freeform. **Esquerda:** voltar e nome do croqui (renomear, duplicar, exportar, trocar de croqui). **Centro:** Desenho (paleta da Pencil), Ponto a ponto, Mão livre, Medida, Texto · Formas, Texturas, Anexo. **Direita:** desfazer, compartilhar, "…" (configurações, unidade, ajustar à tela, mostrar/ocultar anotações, refazer). |
| Ponto a ponto | Toque no ponto A, depois B, C… Tocar no 1º ponto fecha a forma. A barra de baixo alterna **Reta / Arco** para o próximo segmento. Encaixa em 0/45/90°, no perpendicular ao lado anterior e no alinhamento com o 1º ponto. |
| Arco | Arraste o losango no meio do arco, ou digite **corda + flecha**. "Inverter arco" troca o lado. |
| Mão livre | Desenhe o contorno com a Pencil. O app detecta cantos, retas e arcos, fecha a forma e endireita ângulos quase retos. |
| Formas | Retângulo, quadrado, círculo, piscina oval e forma em L, prontas para medir. |
| Medir | Ferramenta **Medida**: toque num lado ou numa cota → **teclado numérico grande** (pés + polegadas com ¼ ½ ¾, ou metros) → **Aplicar e próximo** pula para o próximo lado sem medida. Toque de novo no número para editar. |
| Ângulos | Toque num vértice: **Auto**, **90°**, **Fixo** (ângulo medido) ou **Livre**. |
| Texturas | Botão Texturas → arraste para dentro de uma área. No painel da área: padrão, cor, escala e rotação. |
| Anexo | Foto de referência (ex.: do local) por baixo do desenho, com opacidade ajustável, para traçar por cima. |
| Anotações | Botão **Desenho** abre a paleta vertical da Apple Pencil: caneta, lapiseira, marca-texto, giz, borracha, régua (linha/seta) e laço. Cores 2×3 + seletor; "…" tem espessura, opacidade, mais cores, mostrar/ocultar e apagar tudo. Arraste pela alça; o botão ⤡ recolhe. Fica numa camada separada: nunca vira segmento nem mexe em medidas. |
| Navegar | Dois dedos: mover e zoom. Com a Pencil detectada, só ela desenha e o dedo navega (Configurações → "Só a Apple Pencil desenha"). |
| Configurações | Tema Claro / Escuro / Automático, unidade padrão e rejeição de palma. |
| Exportar | Compartilhar → PNG, PDF ou JSON. PNG/PDF saem **sempre no tema claro**, com logo da Paving Crew, nome do projeto e data no rodapé. |

## Marca e tema

- Tokens da Paving Crew vêm do repositório **PC-Inventory** (`web/src/styles.css`, `PC Inventory/DesignSystem.swift`, `web/public/brand/`): preto `#0f0f10`, bronze `#b08d57`, creme `#f5f3ee`. Estão em `js/brand.js` e nas variáveis `--pc-*` de `css/app.css`.
- A marca é **acento**: tela inicial, botão primário, estado ativo, links, ícone, splash e exportação. Barra, paleta da Pencil e painéis ficam neutros (estilo Freeform).
- Contraste (WCAG AA): o bronze puro dá só 3,09:1 como texto sobre branco, então texto/links usam `#8d7146` (4,58:1) no claro e `#c0a479` (7,15:1) no escuro. Botão primário = bronze com texto preto (6,2:1).
- Ícones e telas de abertura do iPad (claro/escuro) são gerados por `node tools/gen-assets.mjs`.

## Medida externa (futuro)

O campo de medida é isolado em `js/measure.js`. Uma fonte externa — por exemplo, uma futura versão nativa com a trena Bosch GLM 165-27 CG, já que o Safari do iPadOS não tem Web Bluetooth — só precisa chamar `window.croquiMeasure(metros)`: a medida entra no lado selecionado e o app avança para o próximo.

## Como funciona a reescala (solver)

Os dois modos de desenho geram a mesma estrutura: `vertices[]` + `segments[]` (`line` | `arc` com `bulge`).
O formato completo está em `js/model.js`.

`js/solver.js` roda **Levenberg–Marquardt** sobre as coordenadas de todos os vértices, minimizando os resíduos
ponderados abaixo:

| Restrição | Peso | Origem |
|---|---|---|
| Comprimento medido (corda) | 100 (quase rígida) | valor digitado |
| Ângulo reto / 180° / 45° / 135° | 40 | detectado automaticamente (±9° do reto) ou fixado pelo usuário |
| Paralelismo entre lados retos | 15 | detectado (±5°) |
| Ângulo do esboço | 1,5 (fraca) | preserva a forma geral |
| Âncora na posição inicial | 0,03 | remove translação/rotação livres |

Antes de otimizar, a forma é reescalada pela média geométrica das razões medida/desenho. Na **primeira medida
do croqui**, o desenho todo (outras formas e textos) é reescalado junto, para manter as proporções entre elas.
Lados sem medida absorvem o erro. Se as medidas forem incompatíveis, o erro é distribuído por mínimos quadrados
e os lados ou cantos fora da tolerância (max(3 mm, 0,2%) / 0,5°) ficam **vermelhos**, com aviso no painel.

## Estrutura

```
croqui/
  index.html, manifest.webmanifest, sw.js, icons/
  css/app.css
  js/app.js        rotas, tela de pastas, import/export JSON
  js/editor.js     ferramentas, gestos (Pointer Events), painéis, desfazer/refazer, autosave
  js/palette.js    paleta vertical da Apple Pencil (instrumentos ilustrados)
  js/markup.js     camada de anotação (caneta, lapiseira, marca-texto, giz, régua/seta, laço)
  js/measure.js    teclado de medidas + canal para medidor externo
  js/motion.js     mola física, toque confiável, háptico
  js/theme.js      tema claro/escuro/automático + paletas do canvas
  js/settings.js   preferências e tela de Configurações
  js/brand.js      tokens e logos da Paving Crew
  js/model.js      estrutura de dados, estatísticas (área líquida descontando formas internas)
  js/geometry.js   vetores, arcos (bulge), área, point-in-polygon
  js/solver.js     solver de restrições
  js/freehand.js   reconhecimento de traço (ShortStraw + ajuste reta/arco)
  js/textures.js   texturas procedurais (água, concreto, grama, asfalto, brita, deck, 6 padrões de paver)
  js/render.js     SVG de tela e de exportação
  js/export.js     PNG e PDF
  js/db.js         IndexedDB
  tests/solver.test.mjs
```

## Próximos passos sugeridos

- Cotas de posição entre formas (ex.: distância da piscina até a casa) como restrição entre formas.
- Medir diagonais (triangulação), que é o jeito mais confiável de fixar quadriláteros no campo.
- Centro do padrão circular de paver arrastável.
- Recortar a forma interna da textura da forma externa sem precisar de preenchimento branco.
