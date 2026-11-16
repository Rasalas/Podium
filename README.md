# Podium

Desktop-App für Slidev-Präsentationen. Du bearbeitest Folien wie in PowerPoint, die Dateien bleiben normales Slidev-Markdown. Deshalb können KI-Agenten und Entwickler am selben Deck arbeiten wie jemand, der nie ein Terminal öffnet.

## Was die App kann

- **Präsentieren mit Beamer.** Ein Knopf legt die Folien im Vollbild auf den zweiten Bildschirm und zeigt auf dem ersten Slidevs Referentenansicht mit Notizen, nächster Folie und Uhr. Das Bearbeitungsfenster blendet sich so lange aus. Esc beendet, im Menü "Präsentieren" lassen sich die Bildschirme tauschen.
- **Präsentieren in Zoom oder Teams.** "Im Fenster" zeigt die Folien in einem normalen Fenster mit festem Titel, das du in der Videokonferenz teilst. Die Referentenansicht steht daneben.
- **Handy als Fernbedienung.** Ein QR-Code öffnet Slidevs Referentenansicht auf dem Handy. Über Tailscale erreichen sie nur deine eigenen Geräte, im WLAN jedes Gerät im selben Netz.
- **Bearbeiten auf der Folie.** Text anklicken und tippen. Podium ändert genau die betroffene Zeile in der `slides.md`. Das gilt für jeden sichtbaren Text aus dem Vortrag, auch in HTML, in Tabellen, in der Zeile über dem Titel und in der Fußzeile.
- **Notizen.** Die Höhe lässt sich ziehen, ein Doppelklick auf den Rand zeigt alles. Klick-Marken (`[click]`) fügt ein Knopf oder Strg+Enter ein, sie erscheinen als nummerierte Marken.
- **Vorlagen und Layouts.** Eine Vorlage ist ein Slidev-Theme plus eine Beschreibung seiner Layouts. Daraus entstehen die Layout-Auswahl und die Eigenschaften. Die Vorlage "Klar" ist eingebaut und funktioniert ohne Internet.
- **Vorhandene Slidev-Vorträge.** Ein Ordner mit `slides.md` lässt sich direkt öffnen. Liegt die Vorlage im Vortragsordner selbst (als Workspace-Paket, etwa unter `packages/`), nimmt Podium sie von dort.
- **Pakete ohne Terminal.** Slidev liegt einmal im Benutzerordner, Decks brauchen kein `node_modules`. Nennt ein Deck ein Theme oder Addon, lädt Podium es nach. Pakete von der geprüften Liste installiert es still, bei allen anderen fragt es.
- **Arbeiten mit Agenten.** Jedes neue Deck bekommt eine `AGENTS.md`. Podium zeigt Änderungen von außen sofort an und nimmt sie in den Rückgängig-Verlauf auf. Solange ein Deck offen ist, läuft Slidevs MCP-Server.
- **Prüfen und Exportieren.** Die Prüfung meldet Folien, bei denen Inhalt über den Rand ragt. Export als PDF, PowerPoint mit Folien als Bildern, PNG, Webseite oder als einzelne `.podium`-Datei.

## Entwickeln

```
npm install
npm run dev            App mit Hot Reload
npm run typecheck
npm test               Unit-Tests
npm run build          baut nach out/
npm run test:bridge    Test der Brücke in die Slidev-Seite
npm run test:e2e       Tests in der echten App, braucht xvfb und einen Build
xvfb-run -a node tests/e2e/app/packaged-first-run.mjs    Erststart des gepackten Programms, nach npm run dist
```

Beim ersten Start richtet Podium die Slidev-Laufzeit ein. Das braucht einmal Internet und dauert etwa eine Minute. Mit `PODIUM_RUNTIME_DIR` zeigst du auf eine vorhandene Laufzeit, mit `PODIUM_USER_DATA` auf ein Wegwerf-Profil.

## Installer bauen

```
npm run dist           AppImage und deb unter Linux, dmg unter macOS, nsis unter Windows
                       Die macOS-App ist nur lokal signiert. Auf einem anderen Mac muss man sie beim ersten Start über Rechtsklick, Öffnen freigeben.
npm run seed           legt build/runtime-seed an, danach enthält der Installer Slidev schon
```

Ohne Seed ist der Installer klein und lädt Slidev beim ersten Start. Mit Seed ist er rund 600 MB größer und läuft sofort ohne Internet.

## Aufbau

Die Architektur, die Regeln für Beiträge und die Eigenheiten von Slidev 53 stehen in [AGENTS.md](AGENTS.md). Das Format für Vorlagen steht in [templates/README.md](templates/README.md).
