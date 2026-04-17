import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, screen } from "electron";
import fs from "node:fs";
import path from "node:path";
import type { AppCommand } from "@shared/types";
import { registerIpcHandlers } from "./ipc";
import { FrondaAppService } from "./services/app-service";

let mainWindow: BrowserWindow | null = null;
let displayMetricsListenerRegistered = false;
let allowMainWindowClose = false;
let closeNoticeInProgress = false;
let ipcRegistered = false;

const ENTRY_NOTICE_TEXT =
  "Ребята, я захожу в программу реестра фронды, пожалуйста, не заходите пока не отпишусь.";
const EXIT_NOTICE_TEXT = "Ребят, я завершил(а) редактирование реестра, прога свободна.";
const isDev = !app.isPackaged;
const appService = new FrondaAppService();

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function computeAdaptiveZoom(window: BrowserWindow): number {
  const display = screen.getDisplayMatching(window.getBounds());
  const physicalWidth = display.size.width;
  const physicalHeight = display.size.height;

  if (physicalWidth < 3840 && physicalHeight < 2160) {
    return 1;
  }

  const logicalWidth = display.workAreaSize.width;
  const logicalHeight = display.workAreaSize.height;
  const fitRatio = Math.min(logicalWidth / 1920, logicalHeight / 1080);
  return Number(clamp(fitRatio * 0.96, 0.72, 1).toFixed(2));
}

function applyAdaptiveZoom(window: BrowserWindow): void {
  if (window.isDestroyed()) {
    return;
  }
  const nextZoom = computeAdaptiveZoom(window);
  if (Math.abs(window.webContents.getZoomFactor() - nextZoom) < 0.01) {
    return;
  }
  window.webContents.setZoomFactor(nextZoom);
}

function handleDisplayMetricsChanged(): void {
  if (mainWindow) {
    applyAdaptiveZoom(mainWindow);
  }
}

function resolveWindowIcon(): string | undefined {
  const executableDir = path.dirname(app.getPath("exe"));
  const prefersIco = process.platform === "win32";
  const prefersIcns = process.platform === "darwin";
  const devCandidates = prefersIco
    ? [path.join(process.cwd(), "build", "icon.ico"), path.join(process.cwd(), "build", "icon.png")]
    : prefersIcns
      ? [path.join(process.cwd(), "build", "icon.icns"), path.join(process.cwd(), "build", "icon.png"), path.join(process.cwd(), "build", "icon.ico")]
      : [path.join(process.cwd(), "build", "icon.png"), path.join(process.cwd(), "build", "icon.ico")];
  const packagedCandidates = prefersIco
    ? [
        path.join(executableDir, "icon.ico"),
        path.join(executableDir, "icon.png"),
        path.join(process.resourcesPath, "icon.ico"),
        path.join(process.resourcesPath, "icon.png")
      ]
    : prefersIcns
      ? [
          path.join(executableDir, "icon.icns"),
          path.join(executableDir, "icon.png"),
          path.join(executableDir, "icon.ico"),
          path.join(process.resourcesPath, "icon.icns"),
          path.join(process.resourcesPath, "icon.png"),
          path.join(process.resourcesPath, "icon.ico")
        ]
      : [
          path.join(executableDir, "icon.png"),
          path.join(executableDir, "icon.ico"),
          path.join(process.resourcesPath, "icon.png"),
          path.join(process.resourcesPath, "icon.ico")
        ];
  const candidates = isDev ? devCandidates : packagedCandidates;
  return candidates.find((candidate) => fs.existsSync(candidate));
}

function sendAppCommand(command: AppCommand): void {
  mainWindow?.webContents.send("app:command", command);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function buildRendererLoadErrorPage(title: string, detail: string): string {
  return [
    "<!doctype html>",
    '<html lang="ru">',
    "<head>",
    '<meta charset="UTF-8" />',
    "<title>FRONDA</title>",
    "<style>",
    "html,body{margin:0;min-height:100%;background:#080809;color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;}",
    "body{display:grid;place-items:center;padding:32px;box-sizing:border-box;}",
    ".card{max-width:760px;border:1px solid rgba(239,68,68,.45);background:rgba(127,29,29,.22);border-radius:22px;padding:28px;box-shadow:0 24px 80px rgba(0,0,0,.45);}",
    ".brand{letter-spacing:.32em;color:#a1a1aa;text-transform:uppercase;font-size:12px;margin-bottom:12px;}",
    "h1{margin:0 0 12px;font-size:28px;line-height:1.2;}",
    "p{color:#d4d4d8;font-size:16px;line-height:1.6;margin:0 0 12px;}",
    "code{display:block;white-space:pre-wrap;word-break:break-word;background:#050507;border:1px solid rgba(255,255,255,.12);border-radius:14px;padding:14px;color:#fca5a5;}",
    "</style>",
    "</head>",
    "<body>",
    '<main class="card">',
    '<div class="brand">FRONDA</div>',
    `<h1>${escapeHtml(title)}</h1>`,
    "<p>Приложение запустилось, но интерфейс не смог загрузиться. Передайте этот экран разработчику, чтобы мы быстро поправили сборку.</p>",
    `<code>${escapeHtml(detail)}</code>`,
    "</main>",
    "</body>",
    "</html>"
  ].join("");
}

function resolvePackagedRendererPath(): string {
  const candidates = [
    path.join(__dirname, "..", "dist", "index.html"),
    path.join(app.getAppPath(), "dist", "index.html"),
    path.join(process.resourcesPath, "app.asar", "dist", "index.html")
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0];
}

async function loadRenderer(window: BrowserWindow): Promise<void> {
  if (isDev) {
    await window.loadURL("http://localhost:5173");
    return;
  }

  const rendererPath = resolvePackagedRendererPath();
  if (!fs.existsSync(rendererPath)) {
    await window.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(
        buildRendererLoadErrorPage("Интерфейс FRONDA не найден", `Ожидался файл renderer:\n${rendererPath}`)
      )}`
    );
    return;
  }

  try {
    await window.loadFile(rendererPath);
  } catch (error) {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    await window.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(
        buildRendererLoadErrorPage("Интерфейс FRONDA не загрузился", `Файл renderer:\n${rendererPath}\n\nОшибка:\n${message}`)
      )}`
    );
  }
}

function buildApplicationMenu(): Menu {
  return Menu.buildFromTemplate([
    {
      label: "Файл",
      submenu: [
        {
          label: "Сменить рабочую папку...",
          accelerator: "CommandOrControl+Shift+O",
          click: () => sendAppCommand({ type: "workspace:change" })
        },
        {
          label: "Обновить локальную копию",
          accelerator: "F5",
          click: () => sendAppCommand({ type: "workspace:refresh" })
        },
        { type: "separator" },
        { label: "Выход", role: "quit" }
      ]
    },
    {
      label: "Правка",
      submenu: [
        { label: "Отменить", role: "undo" },
        { label: "Повторить", role: "redo" },
        { type: "separator" },
        { label: "Вырезать", role: "cut" },
        { label: "Копировать", role: "copy" },
        { label: "Вставить", role: "paste" },
        { label: "Выделить все", role: "selectAll" }
      ]
    },
    {
      label: "Вид",
      submenu: [
        { label: "Главная", click: () => sendAppCommand({ type: "navigate", section: "dashboard" }) },
        { label: "Структура", click: () => sendAppCommand({ type: "navigate", section: "structure" }) },
        { label: "Состав", click: () => sendAppCommand({ type: "navigate", section: "composition" }) },
        { label: "Релизы", click: () => sendAppCommand({ type: "navigate", section: "releases" }) },
        { label: "Импорт", click: () => sendAppCommand({ type: "navigate", section: "imports" }) },
        { label: "Справочники", click: () => sendAppCommand({ type: "navigate", section: "directories" }) },
        { label: "Статистика", click: () => sendAppCommand({ type: "navigate", section: "statistics" }) },
        { label: "Система", click: () => sendAppCommand({ type: "navigate", section: "system" }) },
        { type: "separator" },
        {
          label: "Расширенный режим",
          accelerator: "CommandOrControl+Shift+D",
          click: () => sendAppCommand({ type: "view:toggleAdvanced" })
        },
        { type: "separator" },
        { label: "Во весь экран", role: "togglefullscreen" }
      ]
    },
    {
      label: "Настройки",
      submenu: [
        {
          label: "Сменить рабочую папку...",
          click: () => sendAppCommand({ type: "workspace:change" })
        },
        {
          label: "Открыть папку настроек",
          click: () => sendAppCommand({ type: "settings:openFolder" })
        }
      ]
    },
    {
      label: "Справка",
      submenu: [
        {
          label: "О FRONDA",
          click: () => {
            if (!mainWindow) return;
            void dialog.showMessageBox(mainWindow, {
              type: "info",
              title: "О FRONDA",
              message: "FRONDA",
              detail: "Внутреннее рабочее приложение реестра фронды."
            });
          }
        }
      ]
    }
  ]);
}

async function createWindow(): Promise<void> {
  nativeTheme.themeSource = "dark";
  allowMainWindowClose = false;
  closeNoticeInProgress = false;

  mainWindow = new BrowserWindow({
    width: 1600,
    height: 980,
    minWidth: 1240,
    minHeight: 760,
    backgroundColor: "#080809",
    title: "FRONDA",
    icon: resolveWindowIcon(),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    console.error("FRONDA renderer load failed", { errorCode, errorDescription, validatedURL });
  });
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error("FRONDA renderer process gone", details);
  });
  mainWindow.webContents.on("preload-error", (_event, preloadPath, error) => {
    console.error("FRONDA preload failed", { preloadPath, error });
  });
  mainWindow.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    console.log("FRONDA renderer console", { level, message, line, sourceId });
  });

  await loadRenderer(mainWindow);

  mainWindow.webContents.setVisualZoomLevelLimits(1, 1);
  mainWindow.webContents.once("did-finish-load", () => {
    if (!mainWindow) return;
    applyAdaptiveZoom(mainWindow);
    sendAppCommand({
      type: "notice:show",
      notice: "entry",
      title: "Перед началом работы",
      message: "НАПИШИ В ЧАТ, ЧТО ОТКРЫЛ(А) РЕЕСТР И ЗАНИМАЕШЬСЯ РЕДАКТИРОВАНИЕМ.",
      copyText: ENTRY_NOTICE_TEXT
    });
  });

  const updateZoom = () => {
    if (mainWindow) {
      applyAdaptiveZoom(mainWindow);
    }
  };

  mainWindow.on("resize", updateZoom);
  mainWindow.on("move", updateZoom);
  mainWindow.on("close", (event) => {
    if (allowMainWindowClose || closeNoticeInProgress) {
      return;
    }
    event.preventDefault();
    closeNoticeInProgress = true;
    sendAppCommand({
      type: "notice:show",
      notice: "exit",
      title: "Перед закрытием",
      message: "НАПИШИ В ЧАТ, ЧТО ЗАВЕРШИЛ(А) РЕДАКТИРОВАНИЕ И ЗАКРЫВАЕШЬ ПРОГРАММУ.",
      copyText: EXIT_NOTICE_TEXT
    });
  });

  if (!displayMetricsListenerRegistered) {
    screen.on("display-metrics-changed", handleDisplayMetricsChanged);
    displayMetricsListenerRegistered = true;
  }

  Menu.setApplicationMenu(buildApplicationMenu());
}

app.whenReady().then(async () => {
  if (process.platform === "win32") {
    app.setAppUserModelId("studio.fronda.desktop");
  }

  if (!ipcRegistered) {
    registerIpcHandlers(appService);
    ipcMain.handle("app:continueClose", async (_event, userName?: string) => {
      closeNoticeInProgress = false;
      try {
        await appService.finalizeWorkspaceOnExit(userName ?? "Портативный пользователь");
      } catch (error) {
        console.error("Не удалось завершить финальную синхронизацию перед закрытием", error);
      }
      allowMainWindowClose = true;
      mainWindow?.close();
      return true;
    });
    ipcRegistered = true;
  }

  await createWindow();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
