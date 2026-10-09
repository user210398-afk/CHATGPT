# F05 — Ícones locais do hub legado

O hub legado (`index.html`, raiz) não executa mais `https://unpkg.com/@phosphor-icons/web` ou outra carga de JavaScript de ícones em tempo de execução. Seus **37 usos** de ícones (30 desenhos distintos, pesos `bold`, `duotone` e `fill`) são SVGs embutidos no próprio HTML, com `viewBox="0 0 256 256"`, `fill="currentColor"` e `aria-hidden="true"`. A aparência usa os tamanhos originais das classes e CSS local `.ph-local-svg`. A substituição cobre também os ícones usados em templates JavaScript do calendário e dos widgets.

## Origem e licença

- Projeto: [Phosphor Icons Core](https://github.com/phosphor-icons/core), autores Phosphor Icons.
- Versão **fixa do código-fonte dos SVGs**: [commit `2b75f3ad12b420c9504ef05df8d2564a28f8500e`](https://github.com/phosphor-icons/core/tree/2b75f3ad12b420c9504ef05df8d2564a28f8500e/assets).
- Origem de cada desenho: `assets/<weight>/<icon>-<weight>.svg` nesse commit. Somente os ícones presentes no hub foram usados; não foi incorporado o pacote completo de webfonts.
- Licença dos SVGs originais: **MIT**, reproduzida abaixo, com atribuição. A inserção das classes e atributos para integração no hub não muda o desenho dos paths SVG.
- Nenhuma dependência npm nova, nenhuma requisição de ícone a CDN e nenhum valor de SRI presumido.

## Licença MIT — Phosphor Icons Core

MIT License

Copyright (c) 2023 Phosphor Icons

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Validação e limites

`tests/legacy-icons.test.ts` testa a cobertura de todos os ícones, SVGs embutidos, os 30 nomes distintos e ausência de scripts externos para ícones. A revisão visual no acervo legado, em desktop e mobile, **é necessária antes da publicação**; um check automatizado do DOM não garante identidade visual pixel-a-pixel. A publicação do Pages continua manual e exige autorização específica.
