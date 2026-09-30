# Croqui — app nativo para iPad (Xcode)

O app nativo embute o mesmo app web (a pasta raiz do repositório é copiada para dentro do app a cada
build) e acrescenta o que o Safari não dá: vibração do Taptic Engine, a planilha de compartilhar do iOS
para PNG/PDF/JSON e a base para uma futura integração Bluetooth (trena Bosch GLM).

## Rodar no seu iPad

1. No Mac: `git clone https://github.com/Peedrohs/Croqui.git` (ou `git pull` se já tiver).
2. Abra `ios/Croqui.xcodeproj` no Xcode.
3. Clique no projeto **Croqui** → target **Croqui** → aba **Signing & Capabilities** → em **Team**,
   escolha a sua conta Apple (serve a conta gratuita). Se reclamar do Bundle Identifier, troque
   `com.pavingcrew.croqui` por algo único seu, ex. `com.seunome.croqui`.
4. Conecte o iPad no cabo (ou mesma rede Wi‑Fi, depois do 1º pareamento) e escolha ele no topo do Xcode.
5. ▶ Run (⌘R).
6. Primeira vez no iPad: **Ajustes → Privacidade e Segurança → Modo de Desenvolvedor → ligar** (reinicia),
   e **Ajustes → Geral → VPN e Gerenciamento de Dispositivo →** confiar no seu certificado.

Com a conta gratuita o app vence em 7 dias (é só rodar de novo pelo Xcode). Com Apple Developer Program
(pago) vale 1 ano e dá para mandar pelo TestFlight.

## Observações

- **Dados:** o app nativo tem armazenamento próprio, separado do PWA do Safari. Para levar seus croquis:
  no PWA, tela inicial → **Backup completo**; no app nativo → **Importar JSON**.
- **Atualizar:** `git pull` e ▶ Run de novo. A fase de build “Copiar app web” sempre leva a versão atual.
- **Depurar:** em Debug, o WebView aparece no Safari do Mac → Desenvolvedor → [seu iPad].
- Recriar o projeto (só se adicionar arquivos Swift): `python3 tools/gen-xcodeproj.py`.
