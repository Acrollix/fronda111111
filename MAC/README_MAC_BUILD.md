# FRONDA macOS build

Эта ветка подготовлена для реальной сборки macOS-пакета (`.dmg` + `.zip`) из исходников FRONDA.

## Что уже подготовлено

- `package.json` настроен на `electron-builder --mac ... --universal`
- добавлены `hardenedRuntime`, entitlements и notarization через встроенную интеграцию electron-builder
- `PortableData` на macOS больше не пишется внутрь `.app`
- добавлен скрипт `prepare:mac`, который на Mac генерирует `build/icon.icns` из `build/icon.png`

## Что нужно на самом Mac

1. Установить Node.js и зависимости:

```bash
npm ci
```

2. Подготовить Apple signing + notarization.

Нужен один из вариантов:

- `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`
- или `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`
- или `APPLE_KEYCHAIN`, `APPLE_KEYCHAIN_PROFILE`

И нужен сертификат `Developer ID Application` в keychain или через `CSC_LINK` / `CSC_KEY_PASSWORD`.

3. Запустить сборку:

```bash
npm run package:mac
```

Дополнительно:

```bash
npm run package:mac:dir
npm run package:mac:zip
npm run package:mac:dmg
```

## Важная граница

Полностью доверенный билд “для любого Mac без предупреждений” возможен только после:

- подписи `Developer ID Application`
- успешной notarization в Apple
- stapling на macOS во время сборки

Без Apple Developer credentials эта ветка остается технически готовой, но не финально выпускаемой.
