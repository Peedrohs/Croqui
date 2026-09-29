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
| Ferramentas | Botão redondo flutuante (arraste para onde preferir). Toque para abrir o leque: anel interno = Medir, Pontos, Arco, Mão livre, Texto; anel externo = Caneta, Seta, Borracha, Texturas, Desfazer. Segure o dedo num ícone para ver o nome; toque fora para fechar. |
| Anotações | **Caneta** (sensível à pressão da Pencil), **Seta** (arraste do início à ponta) e **Borracha** (apaga só traços de anotação). Ficam numa camada separada: não viram segmentos e não mexem em medidas. Cor/espessura na paleta do topo; o olho oculta/mostra a camada (e decide se entra no PNG/PDF). |
| Ponto a ponto | Ferramenta **Pontos**: toque no ponto A, depois B, C… Tocar no 1º ponto fecha a forma. Encaixa em 0/45/90°, no perpendicular ao lado anterior e no alinhamento com o 1º ponto. Segure e arraste para posicionar antes de soltar. |
| Arco | Ligue **Arco** antes de marcar o próximo ponto (abaula para fora ao fechar). Ajuste arrastando o losango no meio do arco, ou digite **corda + flecha**. "Inverter arco" troca o lado. |
| Mão livre | Ferramenta **Mão livre**: desenhe o contorno com a Pencil. O app detecta cantos, retas e arcos, fecha a forma e endireita ângulos quase retos. |
| Medir | Toque em um lado ou numa cota → digite pés + polegadas (aceita `6 1/2`) ou metros → **Aplicar e próximo** pula para o próximo lado sem medida. |
| Editar medida | Toque de novo no número. O desenho inteiro se reajusta. |
| Ângulos | Toque num vértice: **Auto** (padrão), **90°**, **Fixo** (digite o ângulo medido) ou **Livre**. |
| Texturas | Botão de camadas (canto superior direito) → arraste a textura para dentro de uma área. No painel da área: padrão, cor, escala e rotação. |
| Texto | Ferramenta **Texto** → toque no croqui. Arraste para mover e use o quadrado azul para mudar a largura; A−/A+ mudam a fonte. |
| Navegar | Dois dedos: mover e zoom. Com a Apple Pencil detectada, **só a Pencil desenha** e o dedo navega (rejeição de palma). Isso pode ser trocado em Exportar/Opções. |
| Exportar | Botão compartilhar → PNG, PDF ou o projeto em JSON. Na tela inicial: importar JSON e backup completo. |

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
  js/fan.js        leque radial flutuante (molas, cascata)
  js/motion.js     mola física, toque instantâneo (pointerdown), háptico
  js/markup.js     camada de anotação (caneta, seta, borracha)
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
