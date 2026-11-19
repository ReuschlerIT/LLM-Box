# Hinweise zu Drittanbieter-Software

LLM Box selbst steht unter der **MIT-Lizenz** (siehe [`LICENSE`](LICENSE)). Die App nutzt die folgenden Open-Source-Bausteine, die jeweils ihre **eigene Lizenz** behalten. Diese Datei nennt sie, ihre Urheber und die Lizenztexte, wie es die Lizenzen verlangen. Sie ist keine Rechtsberatung.

## 1. Enthaltene Bausteine

| Baustein | Version | Lizenz | Projekt | Verwendung |
|---|---|---|---|---|
| marked | 18.1.3 | MIT | https://github.com/markedjs/marked | Markdown-Darstellung der Antworten (`renderer/vendor/marked.js`) |
| DOMPurify | 3.4.17 | Apache-2.0 oder MPL-2.0 (hier unter Apache-2.0 genutzt) | https://github.com/cure53/DOMPurify | Säubern des dargestellten HTML (`renderer/vendor/purify.js`) |
| highlight.js | 11.12.0 | BSD-3-Clause | https://github.com/highlightjs/highlight.js | Syntaxfärbung für Code (`renderer/vendor/highlight.js`, Farbschemata `hl-light.css`/`hl-dark.css` „GitHub“ aus dem Paket) |
| qrcode-generator (Kazuhiko Arase) | – | MIT | https://github.com/kazuhikoarase/qrcode-generator | QR-Codes für die Übertragung und die Live-Ansicht (`renderer/vendor/qrcode.js`) |
| fast-xml-parser | 4.5.7 | MIT | https://github.com/NaturalIntelligence/fast-xml-parser | Lesen von Office-Dokumenten (Word, Excel, PowerPoint) |
| JSZip | 3.10.2 | MIT oder GPL-3.0-or-later (hier unter MIT genutzt) | https://github.com/Stuk/jszip | Entpacken von Office-Dokumenten |
| pdf.js (`pdfjs-dist`) | 3.11.174 | Apache-2.0 | https://github.com/mozilla/pdf.js | Text aus PDF-Dateien lesen |
| Electron | 33.x | MIT | https://github.com/electron/electron | Laufzeit der Desktop-App (enthält Chromium und Node.js mit eigenen Lizenzen; die fertigen Programmdateien bringen `LICENSES.chromium.html` mit) |
| electron-builder | 25.1.8 | MIT | https://github.com/electron-userland/electron-builder | nur zum Bauen der Programmdatei, nicht Teil der App |

Die Android-Fassung (liegt nicht in diesem Ordner) nutzt zusätzlich **jsQR** (Apache-2.0, https://github.com/cozmo/jsQR) zum Lesen von QR-Codes.

`pdfjs-dist` bringt außerdem Zeichenzuordnungen von Adobe (BSD-Lizenz, `cmaps/LICENSE`) und die Schriften „Liberation“ (SIL Open Font License 1.1, `standard_fonts/LICENSE_LIBERATION`) mit. Die Lizenztexte liegen im jeweiligen Paket unter `node_modules/pdfjs-dist/`.

Weitere, indirekte Abhängigkeiten dieser Pakete stehen mit Version in `package-lock.json`; ihre Lizenztexte liegen in `node_modules/<Paket>/`.

## 2. Urheber und Lizenztexte

### MIT-Lizenz (marked, qrcode-generator, fast-xml-parser, JSZip, Electron, electron-builder)

Copyright (c) 2018-2026 MarkedJS · Copyright (c) 2011-2018 Christopher Jeffrey (marked)
Copyright (c) 2009 Kazuhiko Arase (qrcode-generator)
Copyright (c) 2017 Amit Kumar Gupta (fast-xml-parser)
Copyright (c) 2009-2016 Stuart Knightley, David Duponchel, Franz Buchinger, António Afonso (JSZip)
Copyright (c) Electron contributors / GitHub Inc. (Electron)
Copyright (c) 2015 Loopline Systems (electron-builder)

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

### BSD-3-Clause (highlight.js)

Copyright (c) 2006-2026, Josh Goebel and other contributors. All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.
3. Neither the name of the copyright holder nor the names of its contributors
   may be used to endorse or promote products derived from this software
   without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

### Apache License 2.0 (DOMPurify, pdf.js, jsQR)

DOMPurify: (c) Cure53 and other contributors. pdf.js: Copyright Mozilla Foundation and contributors. jsQR: Copyright Cosmo Wolfe.

Der vollständige Lizenztext steht unter https://www.apache.org/licenses/LICENSE-2.0 und in der Datei `LICENSE` der jeweiligen Pakete (`renderer/vendor/purify.js` verweist auf `github.com/cure53/DOMPurify/blob/3.4.17/LICENSE`; `node_modules/pdfjs-dist/LICENSE`). Die Bausteine wurden nicht verändert.

DOMPurify steht zusätzlich unter der Mozilla Public License 2.0 (https://www.mozilla.org/MPL/2.0/); LLM Box nutzt es unter Apache-2.0.

## 3. Andere Projekte, auf die sich die App bezieht (kein Quelltext enthalten)

Diese Projekte werden **nicht mitgeliefert**. Die App spricht sie nur über ihre Netzwerk-Schnittstelle an oder hat sich von ihnen anregen lassen. Es wurde kein Quelltext von ihnen übernommen.

| Projekt | Lizenz laut Projekt | Bezug |
|---|---|---|
| Strata, https://github.com/Niko1221/Strata | MIT | Lokaler Modell-Server; LLM Box ersetzt seine Chat-Oberfläche, bedient seine API und seinen Monitor und steuert ihn über „strata launch“ |
| llama.cpp, https://github.com/ggml-org/llama.cpp | MIT | Kompatible OpenAI-Schnittstelle (`/v1`, `/slots`) |
| Ollama, https://github.com/ollama/ollama | MIT | Native Schnittstelle (`/api/chat`, `/api/tags`) |
| LM Studio, https://lmstudio.ai | proprietär | Kompatible OpenAI-Schnittstelle |
| SearXNG, https://github.com/searxng/searxng | AGPL-3.0 | Optionale Websuche über einen **selbst betriebenen** Server per HTTP (JSON). Kein SearXNG-Code in LLM Box |
| Tavily (https://tavily.com), Serper (https://serper.dev), Brave Search API (https://brave.com/search/api/), Exa (https://exa.ai), DuckDuckGo (https://duckduckgo.com), Wikipedia/Wikimedia (https://www.wikipedia.org) | Dienste der Anbieter | Websuche ohne eigenen Server, mit eigenem Konto bzw. Schlüssel. Es gelten die Nutzungsbedingungen der Anbieter; Wikipedia-Inhalte stehen unter CC BY-SA |
| Open WebUI, https://github.com/open-webui/open-webui | eigene Lizenz mit Branding-Klausel | Vorbild für den Funktionsumfang (Prompts, Assistenten, Gedächtnis, Wissenssammlungen, Websuche, Live-Ansicht). **Kein Quelltext übernommen** |
| Anthropic- und OpenAI-APIs | Dienste der Anbieter | Optionale Cloud-Modelle mit eigenem Schlüssel |

Marken und Namen gehören ihren jeweiligen Inhabern.
